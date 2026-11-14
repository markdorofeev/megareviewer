import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from fakes import FakeHost, application, use_fake_model
from fastapi.testclient import TestClient

from delphi_code.domain.errors import Failure, FailureKind
from delphi_code.domain.hosting_services import Owner, Repository
from delphi_code.domain.indexing_outcomes import SyncReport
from delphi_code.http_api.app import create_app
from delphi_code.http_api.failures import HTTP_STATUS_BY_FAILURE_KIND
from delphi_code.http_api.progress_stream import NDJSON
from delphi_code.http_api.settings import ApiSettings
from delphi_code.http_api.web_ui_files import PAGE_SECURITY_HEADERS
from delphi_code.infrastructure.registry import Entry, Registry
from delphi_code.services.application import DelphiCode

TOKEN = "http-api-test-token"
ACME = [Repository("bitbucket.org", "acme", "api", "Public API", False)]
AUTHORIZED = {"Authorization": f"Bearer {TOKEN}"}
REPOSITORY = Path(__file__).resolve().parent.parent
COMMITTED_OPENAPI_SCHEMA = REPOSITORY / "web" / "openapi.json"


class HttpApi(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.enterContext(
            patch.dict(
                os.environ,
                {
                    "DELPHI_CODE_INDEX_ROOT": str(self.root / "indexes"),
                    "DELPHI_CODE_REGISTRY": str(self.root / "repos.toml"),
                },
            )
        )
        use_fake_model(self, self.root / "model")
        self.project = self.root / "project"
        self.project.mkdir()
        api = create_app(application(str(self.root / "model")), ApiSettings(TOKEN))
        self.client = TestClient(api, base_url="http://127.0.0.1")

    def test_every_request_needs_the_token(self):
        for headers in ({}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN}):
            with self.subTest(headers=headers):
                response = self.client.get("/api/projects", headers=headers)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()["error"]["code"], "unauthorized")
        self.assertEqual(self.client.get("/api/projects", headers=AUTHORIZED).status_code, 200)

    def test_only_loopback_host_names_are_served(self):
        rebound = TestClient(self.client.app, base_url="http://attacker.example")
        self.assertEqual(rebound.get("/api/projects", headers=AUTHORIZED).status_code, 400)
        local = TestClient(self.client.app, base_url="http://localhost:8123")
        self.assertEqual(local.get("/api/projects", headers=AUTHORIZED).status_code, 200)

    def test_failures_map_to_http_statuses_with_their_code(self):
        missing = self.client.get(
            "/api/projects/status", params={"project": str(self.root / "gone")}, headers=AUTHORIZED
        )
        self.assertEqual((missing.status_code, missing.json()["error"]["code"]), (404, "project_missing"))
        not_indexed = self.client.get("/api/projects/status", params={"project": str(self.project)}, headers=AUTHORIZED)
        self.assertEqual((not_indexed.status_code, not_indexed.json()["error"]["code"]), (409, "index_missing"))
        self.assertEqual(set(HTTP_STATUS_BY_FAILURE_KIND), set(FailureKind))

    def test_invalid_parameters_are_usage_errors(self):
        for parameters in ({}, {"query": "q", "limit": 0}):
            with self.subTest(parameters=parameters):
                response = self.client.get("/api/search", params=parameters, headers=AUTHORIZED)
                self.assertEqual((response.status_code, response.json()["error"]["code"]), (400, "usage"))

    def test_openapi_describes_each_response(self):
        schemas = self.client.get("/openapi.json").json()["components"]["schemas"]
        for name in ("ProjectSearchHitsResponse", "CrossProjectSearchHitsResponse", "ProjectListingResponse"):
            with self.subTest(schema=name):
                self.assertIn(name, schemas)

    def test_the_web_ui_was_generated_from_the_current_schema(self):
        exported = subprocess.run(
            [sys.executable, str(REPOSITORY / "scripts" / "export_openapi.py")],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(
            json.loads(exported.stdout),
            json.loads(COMMITTED_OPENAPI_SCHEMA.read_text()),
            "The API changed: run `corepack pnpm api:generate` in web/ and commit the result",
        )

    def test_openapi_describes_what_each_stream_ends_with(self):
        paths = self.client.get("/openapi.json").json()["paths"]
        for path, method, result in (
            ("/api/projects/index", "post", "IndexingOutcomeResponse"),
            ("/api/projects/sync", "post", "SyncReportResponse"),
            ("/api/projects", "post", "TrackingReportResponse"),
            ("/api/projects/picked", "post", "TrackingReportResponse"),
            ("/api/setup", "post", "ModelSetupResponse"),
        ):
            with self.subTest(path=path):
                content = paths[path][method]["responses"]["200"]["content"]
                self.assertEqual(list(content), [NDJSON])
                self.assertEqual(content[NDJSON]["schema"]["$ref"], f"#/components/schemas/{result}")

    def test_no_page_loads_scripts_from_a_cdn(self):
        for path in ("/", "/docs", "/redoc"):
            with self.subTest(path=path):
                page = self.client.get(path).text
                self.assertNotIn("swagger", page.lower())
                for script in re.findall(r"<script[^>]*\bsrc=\"([^\"]+)\"", page):
                    self.assertTrue(script.startswith("/") and not script.startswith("//"), script)

    def stream_lines(self, response) -> list[dict]:
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.headers["content-type"].startswith(NDJSON))
        return [json.loads(line) for line in response.text.splitlines()]

    def test_index_streams_progress_then_the_outcome(self):
        (self.project / "auth.py").write_text("def check_password(user, password):\n    return False\n")
        response = self.client.post("/api/projects/index", json={"project": str(self.project)}, headers=AUTHORIZED)
        lines = self.stream_lines(response)
        events = [line["event"] for line in lines[:-1]]
        self.assertEqual(events[0], "repository_started")
        self.assertIn("files_embedded", events)
        self.assertEqual(events[-1], "repository_finished")
        self.assertEqual(lines[-1]["done"]["files"], 1)

    def test_a_partly_failed_sync_is_a_done_report(self):
        with Registry().edit() as entries:
            entries[:] = [Entry(str(self.root / "gone")), Entry(str(self.project))]
        lines = self.stream_lines(self.client.post("/api/projects/sync", headers=AUTHORIZED))
        repos = lines[-1]["done"]["repos"]
        self.assertEqual(
            [(repo["ok"], repo.get("error", {}).get("code")) for repo in repos],
            [(False, "project_missing"), (True, None)],
        )

    def test_a_failure_after_progress_began_ends_the_stream(self):
        def fail_after_starting(self, project, selection, progress):
            progress.repository_started(project, 1, 1)
            raise Failure("index_busy", "Another command is updating this project", FailureKind.BUSY)

        with patch.object(DelphiCode, "index", fail_after_starting):
            response = self.client.post("/api/projects/index", json={"project": "p"}, headers=AUTHORIZED)
        self.assertEqual(
            self.stream_lines(response)[-1],
            {"failed": {"code": "index_busy", "message": "Another command is updating this project"}},
        )

    def test_one_write_at_a_time(self):
        started, release = threading.Event(), threading.Event()

        def slow_sync(self, projects, progress):
            progress.repository_started("p", 1, 1)
            started.set()
            release.wait(10)
            return SyncReport("/repos.toml", [])

        with patch.object(DelphiCode, "sync", slow_sync):
            first = threading.Thread(
                target=self.client.post, args=("/api/projects/sync",), kwargs={"headers": AUTHORIZED}
            )
            first.start()
            started.wait(10)
            busy = self.client.post("/api/projects/sync", headers=AUTHORIZED)
            reading = self.client.get("/api/projects", headers=AUTHORIZED)
            release.set()
            first.join(10)
        self.assertEqual((busy.status_code, busy.json()["error"]["code"]), (409, "busy"))
        self.assertEqual(reading.status_code, 200)
        self.assertEqual(self.client.post("/api/projects/sync", headers=AUTHORIZED).status_code, 200)

    def test_changes_from_another_origin_are_refused(self):
        foreign = self.client.post("/api/projects/sync", headers={**AUTHORIZED, "Origin": "http://attacker.example"})
        self.assertEqual((foreign.status_code, foreign.json()["error"]["code"]), (403, "forbidden_origin"))
        own = self.client.post("/api/projects/sync", headers={**AUTHORIZED, "Origin": "http://127.0.0.1"})
        self.assertEqual(own.status_code, 200)

    def test_lists_hosting_services_and_rereads_credentials(self):
        configured = [FakeHost([Owner("acme", "Acme")], ACME)]
        client = self.client_with_hosts(configured)
        listed = client.get("/api/hosting-services", headers=AUTHORIZED).json()["hosting_services"]
        self.assertEqual([service["name"] for service in listed], ["Bitbucket"])
        configured.append(FakeHost([], [], name="GitHub"))
        listed = client.get("/api/hosting-services", headers=AUTHORIZED).json()["hosting_services"]
        self.assertEqual([service["name"] for service in listed], ["Bitbucket", "GitHub"])

    def test_account_connections_name_the_account_or_the_problem(self):
        rejected = Failure("remote_auth_failed", "GitHub rejected the token", FailureKind.REMOTE_FAILED)
        client = self.client_with_hosts(
            [
                FakeHost([], [], account="acme-bot"),
                FakeHost([], [], name="GitHub", account=rejected),
                FakeHost([], [], name="Gitea", credentials_source=None),
            ]
        )
        connections = client.get("/api/account-connections", headers=AUTHORIZED).json()["connections"]
        self.assertEqual(
            [(row["name"], row["state"], row["account"], row["problem"]) for row in connections],
            [
                ("Bitbucket", "connected", "acme-bot", None),
                ("GitHub", "failed", None, "GitHub rejected the token"),
                ("Gitea", "not_connected", None, None),
            ],
        )
        self.assertEqual(connections[0]["credentials_source"], "FAKE_TOKEN from the environment")
        self.assertEqual(connections[2]["how_to_connect"], "set FAKE_TOKEN")

    def test_a_verified_token_is_saved_and_can_be_forgotten(self):
        github = FakeHost([], [], name="GitHub", credentials_source=None, account="octo")
        client = self.client_with_hosts([github])
        url = "/api/account-connections/github.example/token"
        rejected = client.put(url, json={"token": "revoked"}, headers=AUTHORIZED)
        self.assertEqual((rejected.status_code, rejected.json()["error"]["code"]), (502, "remote_auth_failed"))
        self.assertIn("GitHub rejected this token", rejected.json()["error"]["message"])
        self.assertIsNone(github.saved_token)
        saved = client.put(url, json={"token": " valid-token "}, headers=AUTHORIZED).json()
        self.assertEqual((saved["state"], saved["account"], saved["saved_token"]), ("connected", "octo", True))
        self.assertEqual(github.saved_token, ("valid-token", None))
        forgotten = client.delete(url, headers=AUTHORIZED).json()
        self.assertEqual((forgotten["state"], forgotten["saved_token"]), ("not_connected", False))

    def test_saving_a_token_checks_the_request(self):
        bitbucket = FakeHost([], [], credentials_source=None, username_label="Atlassian account email")
        client = self.client_with_hosts([bitbucket])
        cases = [
            ("bitbucket.example", {"token": "valid-token"}, 400, "usage"),
            ("bitbucket.example", {"token": "   ", "username": "me@example.com"}, 400, "usage"),
            ("gitea.example", {"token": "valid-token"}, 404, "not_found"),
        ]
        for domain, body, status, code in cases:
            with self.subTest(domain=domain, body=body):
                response = client.put(f"/api/account-connections/{domain}/token", json=body, headers=AUTHORIZED)
                self.assertEqual((response.status_code, response.json()["error"]["code"]), (status, code))
        foreign = client.put(
            "/api/account-connections/bitbucket.example/token",
            json={"token": "valid-token", "username": "me@example.com"},
            headers={**AUTHORIZED, "Origin": "http://attacker.example"},
        )
        self.assertEqual(foreign.status_code, 403)
        self.assertIsNone(bitbucket.saved_token)

    def test_lists_owners_and_their_repositories(self):
        client = self.client_with_hosts([FakeHost([Owner("acme", "Acme")], ACME)])
        owners = client.get("/api/hosting-services/bitbucket.example/owners", headers=AUTHORIZED).json()
        self.assertEqual(owners, {"owners": [{"slug": "acme", "name": "Acme"}]})
        listed = client.get("/api/hosting-services/bitbucket.example/owners/acme/repositories", headers=AUTHORIZED)
        self.assertEqual(
            [repository["key"] for repository in listed.json()["repositories"]], ["bitbucket.org/acme/api"]
        )

    def test_owners_are_null_when_they_must_be_typed(self):
        forbidden = Failure("remote_permission_denied", "lacks read:workspace", FailureKind.REMOTE_FAILED)
        client = self.client_with_hosts([FakeHost(forbidden, ACME)])
        owners = client.get("/api/hosting-services/bitbucket.example/owners", headers=AUTHORIZED).json()
        self.assertEqual(owners, {"owners": None})

    def test_hosting_services_without_credentials_are_missing_prerequisites(self):
        for client in (self.client_with_hosts([]), self.client_with_hosts([FakeHost([], [])])):
            response = client.get("/api/hosting-services/github.example/owners", headers=AUTHORIZED)
            self.assertEqual((response.status_code, response.json()["error"]["code"]), (503, "remote_auth_missing"))

    def test_applies_picked_changes(self):
        body = {"added": ["bitbucket.org/acme/api"], "no_sync": True}
        lines = self.stream_lines(self.client.post("/api/projects/picked", json=body, headers=AUTHORIZED))
        self.assertEqual(
            lines[-1]["done"]["repos"], [{"source": "bitbucket.org/acme/api", "key": "bitbucket.org/acme/api"}]
        )
        self.assertEqual((lines[-1]["done"]["removed"], lines[-1]["done"]["cancelled"]), ([], False))
        self.assertEqual([entry.source for entry in Registry().entries()], ["bitbucket.org/acme/api"])

    def test_picked_changes_accept_only_repository_keys(self):
        for key in (str(self.project), "bitbucket.org/acme", "Bitbucket.org/Acme/API"):
            with self.subTest(key=key):
                response = self.client.post("/api/projects/picked", json={"removed": [key]}, headers=AUTHORIZED)
                self.assertEqual((response.status_code, response.json()["error"]["code"]), (400, "usage"))
        self.assertEqual(Registry().entries(), [])

    def client_with_hosts(self, hosts) -> TestClient:
        api = create_app(application(str(self.root / "model"), repository_hosts=hosts), ApiSettings(TOKEN))
        return TestClient(api, base_url="http://127.0.0.1")


if __name__ == "__main__":
    unittest.main()


class WebUiPage(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.web_ui = self.root / "web"
        (self.web_ui / "assets").mkdir(parents=True)
        (self.web_ui / "index.html").write_text("<!doctype html><title>Delphi Code</title>")
        (self.web_ui / "assets" / "app-1a2b3c.js").write_text("console.log('app')")
        (self.web_ui / "favicon.svg").write_text("<svg/>")
        self.client = self.client_serving(self.web_ui)

    def client_serving(self, web_ui: Path) -> TestClient:
        settings = ApiSettings(TOKEN, web_ui_directory=web_ui)
        return TestClient(create_app(application(str(self.root / "model")), settings), base_url="http://127.0.0.1")

    def test_the_page_and_its_files_load_without_the_token(self):
        for path in ("/", "/assets/app-1a2b3c.js", "/favicon.svg"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)
        self.assertEqual(self.client.get("/api/projects").status_code, 401)

    def test_client_routes_get_the_page(self):
        for path in ("/projects", "/search?q=retry"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIn("<title>Delphi Code</title>", response.text)

    def test_unknown_api_paths_stay_json_errors(self):
        unknown = self.client.get("/api/nothing-here", headers=AUTHORIZED)
        self.assertEqual((unknown.status_code, unknown.json()["error"]["code"]), (404, "not_found"))
        wrong_method = self.client.get("/api/projects/sync", headers=AUTHORIZED)
        self.assertEqual((wrong_method.status_code, wrong_method.json()["error"]["code"]), (405, "method_not_allowed"))
        self.assertEqual(self.client.post("/projects").status_code, 405)

    def test_openapi_is_still_served_by_the_api(self):
        self.assertIn("paths", self.client.get("/openapi.json").json())

    def test_page_responses_carry_security_headers(self):
        for path in ("/", "/projects", "/assets/app-1a2b3c.js"):
            with self.subTest(path=path):
                headers = self.client.get(path).headers
                for name, value in PAGE_SECURITY_HEADERS.items():
                    self.assertEqual(headers[name], value)

    def test_only_fingerprinted_assets_are_cached(self):
        self.assertEqual(self.client.get("/").headers["cache-control"], "no-store")
        self.assertEqual(self.client.get("/projects").headers["cache-control"], "no-store")
        self.assertIn("immutable", self.client.get("/assets/app-1a2b3c.js").headers["cache-control"])

    def test_foreign_host_names_get_no_page(self):
        rebound = TestClient(self.client.app, base_url="http://attacker.example")
        self.assertEqual(rebound.get("/").status_code, 400)

    def test_an_unbuilt_web_ui_says_how_to_build_it(self):
        response = self.client_serving(self.root / "not-built").get("/")
        self.assertEqual(response.status_code, 503)
        self.assertIn("pnpm --dir web build", response.text)
