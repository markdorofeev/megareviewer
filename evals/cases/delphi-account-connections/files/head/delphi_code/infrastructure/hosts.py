import base64
from functools import cached_property
import json
import os
import re
import ssl
import subprocess
import sys
from typing import Any, NamedTuple
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

if __package__:
    from ..domain.errors import Failure, FailureKind
    from ..domain.hosting_services import HostingService, Owner, Repository, TokenForm
    from .keychain import forget_secret, save_secret, saved_secret

PAGE_LENGTH = 100
REQUEST_TIMEOUT_SECONDS = 60
LISTING_TIMEOUT_SECONDS = 300
API_TOKEN_GIT_USERNAME = "x-bitbucket-api-token-auth"
SAVED_TOKEN_SOURCE = "token saved by Delphi Code"


class ApiCredentials(NamedTuple):
    authorization: str
    source: str


class SavedToken(NamedTuple):
    token: str
    username: str | None


class RepositoryHost:
    domain: str
    name: str
    owner_noun: str
    default_api_base: str
    credentials_hint: str
    rejected_credentials_hint = ""
    missing_permission_hint = ""
    token_page: str
    token_permissions: str
    token_username_label: str | None = None
    rejected_token_hint = "Check that it is current and not revoked"

    def __init__(self, api_authorization=None):
        self._given_api_authorization = api_authorization

    def web_url(self, owner, repository):
        return f"https://{self.domain}/{owner}/{repository}"

    def clone_url(self, owner, repository):
        base = os.environ.get(f"{self._variable_prefix}_GIT_BASE", f"https://{self.domain}").rstrip("/")
        return f"{base}/{owner}/{repository}.git"

    def permalink_template(self, owner, repository, commit):
        raise NotImplementedError

    def suggested_owner(self):
        return None

    def clone_credentials(self):
        raise NotImplementedError

    @property
    def token_form(self) -> "TokenForm":
        return TokenForm(self.token_page, self.token_permissions, self.token_username_label)

    def with_token(self, token: str, username: str | None = None) -> "RepositoryHost":
        return type(self)(self._authorization_for(token, username))

    @property
    def has_saved_token(self) -> bool:
        return self._saved_token() is not None

    def save_token(self, token: str, username: str | None = None):
        secret = json.dumps({"token": token, "username": username})
        save_secret(self.domain, f"Delphi Code token for {self.name}", secret)

    def forget_saved_token(self):
        forget_secret(self.domain)

    def has_api_credentials(self):
        return self._available_api_credentials is not None

    @property
    def credentials_source(self):
        credentials = self._available_api_credentials
        return credentials.source if credentials else None

    def account(self) -> str:
        return self._run_in_child_process("account")

    def description(self) -> "HostingService":
        return HostingService(self.domain, self.name, self.owner_noun, self.suggested_owner())

    def owners(self):
        return [Owner(**item) for item in self._run_in_child_process("owners")]

    def repositories(self, owner):
        return [Repository(**item) for item in self._run_in_child_process("repositories", owner)]

    def _find_api_credentials(self):
        raise NotImplementedError

    def _authorization_for(self, token, username):
        raise NotImplementedError

    def _saved_credentials(self):
        saved = self._saved_token()
        return ApiCredentials(self._authorization_for(*saved), SAVED_TOKEN_SOURCE) if saved else None

    def _saved_token(self):
        try:
            fields = json.loads(saved_secret(self.domain) or "null")
            return SavedToken(fields["token"], fields.get("username")) if fields else None
        except (ValueError, KeyError, TypeError, AttributeError):
            return None

    def _account_name(self):
        raise NotImplementedError

    def _list_owners(self):
        raise NotImplementedError

    def _list_repositories(self, owner):
        raise NotImplementedError

    def _next_page_url(self, page, link_header):
        raise NotImplementedError

    def _page_values(self, page):
        raise NotImplementedError

    @property
    def _variable_prefix(self):
        return f"DELPHI_CODE_{self.name.upper()}"

    @property
    def _api_base(self):
        return os.environ.get(f"{self._variable_prefix}_API_BASE", self.default_api_base).rstrip("/")

    @cached_property
    def _available_api_credentials(self):
        if self._given_api_authorization:
            return ApiCredentials(self._given_api_authorization, "given credentials")
        return self._find_api_credentials()

    @property
    def _api_credentials(self):
        credentials = self._available_api_credentials
        if credentials is None:
            raise Failure(
                "remote_auth_missing",
                f"Listing {self.name} repositories needs credentials: {self.credentials_hint}",
                FailureKind.PREREQUISITE_MISSING,
            )
        return credentials

    def _repository_fields_for(self, owner, slug, description, private) -> dict:
        return {
            "host": self.domain,
            "owner": owner,
            "slug": slug,
            "description": description or "",
            "private": bool(private),
        }

    def _fetch_pages(self, url):
        values = []
        while url:
            page, link_header = self._fetch_json(url)
            values.extend(self._page_values(page))
            url = self._next_page_url(page, link_header)
        return values

    def _fetch_json(self, url):
        headers = {
            "Authorization": self._given_api_authorization,
            "Accept": "application/json",
            "User-Agent": "delphi-code",
        }
        tls = _verified_tls() if url.startswith("https:") else None
        with urlopen(Request(url, headers=headers), timeout=REQUEST_TIMEOUT_SECONDS, context=tls) as response:
            return json.load(response), (response.headers.get("Link") if response.headers else None) or ""

    def _run_in_child_process(self, request, *arguments) -> Any:
        credentials = self._api_credentials
        environment = dict(os.environ, DELPHI_CODE_API_AUTHORIZATION=credentials.authorization)
        try:
            result = subprocess.run(
                [sys.executable, __file__, self.domain, request, *arguments],
                capture_output=True,
                text=True,
                timeout=LISTING_TIMEOUT_SECONDS,
                env=environment,
            )
        except subprocess.TimeoutExpired as exc:
            raise Failure(
                "remote_unavailable",
                f"{self.name} did not answer within {LISTING_TIMEOUT_SECONDS} seconds",
                FailureKind.REMOTE_FAILED,
            ) from exc
        payload: Any
        try:
            payload = json.loads(result.stdout)
        except ValueError:
            payload = {"error": {"status": None, "message": result.stderr.strip() or f"{self.name} API request failed"}}
        if result.returncode == 0:
            return payload
        error = payload.get("error", {})
        if error.get("status") == 401:
            raise Failure(
                "remote_auth_failed",
                f"{self.name} rejected the {credentials.source}: {error['message']}. "
                f"{self.rejected_credentials_hint or self.credentials_hint}",
                FailureKind.REMOTE_FAILED,
            )
        if error.get("status") == 403:
            raise Failure(
                "remote_permission_denied",
                f"{self.name} accepted the {credentials.source} but refused {error.get('path')}: {error['message']}. "
                f"{self.missing_permission_hint}",
                FailureKind.REMOTE_FAILED,
            )
        raise Failure(
            "remote_unavailable", f"{self.name} API request failed: {error.get('message')}", FailureKind.REMOTE_FAILED
        )


class Bitbucket(RepositoryHost):
    domain = "bitbucket.org"
    name = "Bitbucket"
    owner_noun = "workspace"
    default_api_base = "https://api.bitbucket.org/2.0"
    credentials_hint = "set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD, or store git credentials for bitbucket.org"
    rejected_credentials_hint = "With an API token, set BITBUCKET_EMAIL to your Atlassian account email"
    missing_permission_hint = (
        "Listing needs an API token with the scopes read:user:bitbucket, read:workspace:bitbucket and "
        "read:repository:bitbucket, or an app password with Account, Workspace membership and Repositories read access"
    )
    token_page = "https://id.atlassian.com/manage-profile/security/api-tokens"
    token_permissions = (
        "Choose Create API token with scopes, not Create API token: Bitbucket refuses tokens without scopes. "
        "Pick the Bitbucket app and grant read:user:bitbucket, read:workspace:bitbucket and read:repository:bitbucket"
    )
    token_username_label = "Atlassian account email"
    rejected_token_hint = (
        "Bitbucket accepts only tokens made with Create API token with scopes for the Bitbucket app, "
        "and the email must be the one your Atlassian account signs in with"
    )
    _repository_fields = "next,values.slug,values.description,values.is_private"

    def permalink_template(self, owner, repository, commit):
        return f"{self.web_url(owner, repository)}/src/{commit}/{{path}}#lines-{{start}}:{{end}}"

    def suggested_owner(self):
        return os.environ.get("BITBUCKET_WORKSPACE")

    def clone_credentials(self):
        username, password = os.environ.get("BITBUCKET_USERNAME"), os.environ.get("BITBUCKET_APP_PASSWORD")
        if not password:
            saved = self._saved_token()
            return (API_TOKEN_GIT_USERNAME, saved.token) if saved else None
        if username and "@" not in username:
            return username, password
        if username or os.environ.get("BITBUCKET_EMAIL"):
            return API_TOKEN_GIT_USERNAME, password
        return None

    def _find_api_credentials(self):
        username_variable = "BITBUCKET_EMAIL" if os.environ.get("BITBUCKET_EMAIL") else "BITBUCKET_USERNAME"
        username, password = os.environ.get(username_variable), os.environ.get("BITBUCKET_APP_PASSWORD")
        if username and password:
            source = f"{username_variable} and BITBUCKET_APP_PASSWORD from the environment"
        elif saved := self._saved_credentials():
            return saved
        else:
            stored = _git_stored_credentials(self.domain)
            if stored is None:
                return None
            (username, password), source = stored, f"git credentials stored for {self.domain}"
        return ApiCredentials(self._authorization_for(password, username), source)

    def _authorization_for(self, token, username):
        return "Basic " + base64.b64encode(f"{username}:{token}".encode()).decode()

    def _account_name(self):
        user, _ = self._fetch_json(f"{self._api_base}/user")
        return user.get("username") or user.get("nickname") or user["display_name"]

    def _workspaces_url(self):
        return f"{self._api_base}/user/workspaces?pagelen={PAGE_LENGTH}"

    def _repositories_url(self, workspace):
        query = urlencode({"role": "member", "pagelen": PAGE_LENGTH, "sort": "slug", "fields": self._repository_fields})
        return f"{self._api_base}/repositories/{quote(workspace)}?{query}"

    def _list_owners(self):
        memberships = self._fetch_pages(self._workspaces_url())
        names_by_slug = {}
        for membership in memberships:
            workspace = membership.get("workspace", membership)
            names_by_slug[workspace["slug"]] = workspace.get("name") or workspace["slug"]
        return [{"slug": slug, "name": name} for slug, name in sorted(names_by_slug.items())]

    def _list_repositories(self, workspace):
        return [
            self._repository_fields_for(workspace, item["slug"], item.get("description"), item.get("is_private"))
            for item in self._fetch_pages(self._repositories_url(workspace))
        ]

    def _next_page_url(self, page, link_header):
        return page.get("next")

    def _page_values(self, page):
        return page.get("values", [])


class GitHub(RepositoryHost):
    domain = "github.com"
    name = "GitHub"
    owner_noun = "account"
    default_api_base = "https://api.github.com"
    credentials_hint = "set GITHUB_TOKEN, sign in with gh auth login, or store git credentials for github.com"
    missing_permission_hint = (
        "Listing needs a classic token with the repo scope, or a fine-grained token with Metadata read access"
    )
    token_page = "https://github.com/settings/tokens/new?scopes=repo&description=Delphi%20Code"
    token_permissions = "Create a classic token with the repo scope"
    _next_link = re.compile(r'<([^>]+)>;\s*rel="next"')

    def permalink_template(self, owner, repository, commit):
        return f"{self.web_url(owner, repository)}/blob/{commit}/{{path}}#L{{start}}-L{{end}}"

    def clone_credentials(self):
        token = _github_environment_token() or self._saved_bare_token()
        return ("x-access-token", token) if token else None

    def _find_api_credentials(self):
        for source, find_token in (
            ("GITHUB_TOKEN or GH_TOKEN from the environment", _github_environment_token),
            (SAVED_TOKEN_SOURCE, self._saved_bare_token),
            ("token from gh auth token", lambda: _gh_token(self.domain)),
            (f"token stored in git credentials for {self.domain}", lambda: _git_stored_token(self.domain)),
        ):
            token = find_token()
            if token:
                return ApiCredentials(self._authorization_for(token, None), source)
        return None

    def _authorization_for(self, token, username):
        return f"Bearer {token}"

    def _saved_bare_token(self):
        saved = self._saved_token()
        return saved.token if saved else None

    def owners(self):
        owners = sorted({repository.owner for repository in self._accessible_repositories}, key=str.lower)
        return [Owner(owner, owner) for owner in owners]

    def repositories(self, owner):
        return [repository for repository in self._accessible_repositories if repository.owner == owner]

    @cached_property
    def _accessible_repositories(self):
        return [Repository(**item) for item in self._run_in_child_process("repositories")]

    def _account_name(self):
        user, _ = self._fetch_json(f"{self._api_base}/user")
        return user["login"]

    def _repositories_url(self):
        query = urlencode(
            {"per_page": PAGE_LENGTH, "sort": "full_name", "affiliation": "owner,collaborator,organization_member"}
        )
        return f"{self._api_base}/user/repos?{query}"

    def _list_repositories(self, owner=None):
        repositories = [
            self._repository_fields_for(
                item["owner"]["login"], item["name"], item.get("description"), item.get("private")
            )
            for item in self._fetch_pages(self._repositories_url())
        ]
        return [repository for repository in repositories if owner in (None, repository["owner"])]

    def _next_page_url(self, page, link_header):
        match = self._next_link.search(link_header)
        return match.group(1) if match else None

    def _page_values(self, page):
        return page


HOSTS = (Bitbucket, GitHub)
HOSTS_BY_DOMAIN = {host.domain: host for host in HOSTS}


def known_hosts():
    return [host_type() for host_type in HOSTS]


def _github_environment_token():
    return os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")


def _verified_tls():
    import certifi

    return ssl.create_default_context(cafile=certifi.where())


def _gh_token(domain):
    try:
        result = subprocess.run(
            ["gh", "auth", "token", "--hostname", domain], capture_output=True, text=True, timeout=10
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() if result.returncode == 0 and result.stdout.strip() else None


def _git_stored_token(domain):
    stored = _git_stored_credentials(domain)
    return stored[1] if stored else None


def _git_stored_credentials(domain):
    environment = {name: value for name, value in os.environ.items() if name not in {"GIT_ASKPASS", "SSH_ASKPASS"}}
    environment["GIT_TERMINAL_PROMPT"] = "0"
    try:
        result = subprocess.run(
            ["git", "credential", "fill"],
            input=f"protocol=https\nhost={domain}\n\n",
            capture_output=True,
            text=True,
            timeout=30,
            env=environment,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    fields = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    if result.returncode or not fields.get("username") or not fields.get("password"):
        return None
    return fields["username"], fields["password"]


def _error_body(exc):
    try:
        return exc.read()
    except (OSError, ValueError):
        return b""
    finally:
        exc.close()


def _service_error_message(body):
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    bitbucket_error = payload.get("error")
    if not isinstance(bitbucket_error, dict):
        return payload.get("message")
    message, detail = bitbucket_error.get("message"), bitbucket_error.get("detail")
    if isinstance(detail, dict):
        detail = "; ".join(f"{name}: {_listed(value)}" for name, value in detail.items())
    return f"{message} ({detail})" if message and detail else message or detail


def _listed(value):
    return ", ".join(map(str, value)) if isinstance(value, list) else str(value)


def main(arguments):
    domain, request, *request_arguments = arguments
    host = HOSTS_BY_DOMAIN[domain](os.environ["DELPHI_CODE_API_AUTHORIZATION"])
    answers = {"account": host._account_name, "owners": host._list_owners, "repositories": host._list_repositories}
    try:
        answer = answers[request](*request_arguments)
    except HTTPError as exc:
        reason = _service_error_message(_error_body(exc)) or exc.reason
        path = urlsplit(exc.url).path if exc.url else None
        print(json.dumps({"error": {"status": exc.code, "path": path, "message": f"HTTP {exc.code} {reason}"}}))
        return 1
    except (URLError, OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"error": {"status": None, "message": str(exc)}}))
        return 1
    print(json.dumps(answer))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
