import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiServer, ndjson } from "@/test/apiServer";
import { renderAppAt, TEST_API_ORIGIN } from "@/test/renderAppAt";

const DIAGNOSTICS = {
  version: "0.2.15",
  project: null,
  key: "local:/work",
  index_directory: null,
  model: "/models/all-MiniLM-L6-v2",
  model_sha256: "0123456789abcdef0123456789abcdef",
  dimensions: 384,
  self_distance: 0,
  device: "cpu",
  cocoindex_storage: "ok",
  offline: true,
  network_guard: "python_audit",
  sqlite: "3.50.0",
  dependencies: { torch: "2.14.0" },
};

function answerProjects() {
  apiServer.use(
    http.get(`${TEST_API_ORIGIN}/api/projects`, () => HttpResponse.json({ registry: "/repos.toml", repos: [] })),
    http.get(`${TEST_API_ORIGIN}/api/account-connections`, () => HttpResponse.json({ connections: [] })),
  );
}

const NO_CONNECTION = {
  account: null,
  credentials_source: null,
  problem: null,
  how_to_connect: "set GITHUB_TOKEN",
  token_page: "https://github.com/settings/tokens/new",
  token_permissions: "Create a classic token with the repo scope",
  username_label: null,
  saved_token: false,
};
const BITBUCKET_NOT_CONNECTED = {
  ...NO_CONNECTION,
  domain: "bitbucket.org",
  name: "Bitbucket",
  state: "not_connected",
  username_label: "Atlassian account email",
};

describe("the setup page", () => {
  it("runs the installation checks in the folder the server started in unless a project is picked", async () => {
    answerProjects();
    let checkedProject: string | null = null;
    apiServer.use(
      http.get(`${TEST_API_ORIGIN}/api/doctor`, ({ request }) => {
        checkedProject = new URL(request.url).searchParams.get("project");
        return HttpResponse.json(DIAGNOSTICS);
      }),
    );
    renderAppAt("/setup");

    fireEvent.click(await screen.findByRole("button", { name: "Run checks" }));

    expect(await screen.findByText("384 dimensions, self-distance 0.0000")).toBeTruthy();
    expect(screen.getByText("yes (python_audit)")).toBeTruthy();
    expect(checkedProject).toBe(".");
  });

  it("shows which Bitbucket and GitHub accounts are connected and checks them again on request", async () => {
    answerProjects();
    let checks = 0;
    apiServer.use(
      http.get(`${TEST_API_ORIGIN}/api/account-connections`, () => {
        checks += 1;
        return HttpResponse.json({
          connections: [
            {
              ...NO_CONNECTION,
              domain: "bitbucket.org",
              name: "Bitbucket",
              state: "connected",
              account: "acme-bot",
              credentials_source: "git credentials stored for bitbucket.org",
            },
            checks === 1
              ? { ...NO_CONNECTION, domain: "github.com", name: "GitHub", state: "not_connected" }
              : {
                  ...NO_CONNECTION,
                  domain: "github.com",
                  name: "GitHub",
                  state: "failed",
                  credentials_source: "token from gh auth token",
                  problem: "GitHub rejected the token from gh auth token",
                },
          ],
        });
      }),
    );
    renderAppAt("/setup");

    const bitbucket = await screen.findByRole("listitem", { name: "Bitbucket" });
    expect(within(bitbucket).getByText("Connected as acme-bot")).toBeTruthy();
    expect(within(bitbucket).getByText("Using the git credentials stored for bitbucket.org.")).toBeTruthy();
    expect(within(bitbucket).getByRole("link", { name: "Pick repositories" }).getAttribute("href")).toBe(
      "/projects/from-account?service=bitbucket.org",
    );
    const github = screen.getByRole("listitem", { name: "GitHub" });
    expect(within(github).getByText("Not connected")).toBeTruthy();
    expect(within(github).getByText("Connect with a token here, or set GITHUB_TOKEN.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(await screen.findByText("GitHub rejected the token from gh auth token")).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "GitHub" })).getByText("Not working")).toBeTruthy();
  });

  it("checks a pasted token, saves it, and can forget it again", async () => {
    answerProjects();
    const sentBodies: unknown[] = [];
    apiServer.use(
      http.get(`${TEST_API_ORIGIN}/api/account-connections`, () =>
        HttpResponse.json({ connections: [BITBUCKET_NOT_CONNECTED] }),
      ),
      http.put(`${TEST_API_ORIGIN}/api/account-connections/bitbucket.org/token`, async ({ request }) => {
        const body = (await request.json()) as { token: string };
        sentBodies.push(body);
        return body.token === "valid"
          ? HttpResponse.json({
              ...BITBUCKET_NOT_CONNECTED,
              state: "connected",
              account: "acme-bot",
              credentials_source: "token saved by Delphi Code",
              saved_token: true,
            })
          : HttpResponse.json(
              { error: { code: "remote_auth_failed", message: "Bitbucket rejected this token" } },
              { status: 502 },
            );
      }),
      http.delete(`${TEST_API_ORIGIN}/api/account-connections/bitbucket.org/token`, () =>
        HttpResponse.json(BITBUCKET_NOT_CONNECTED),
      ),
    );
    renderAppAt("/setup");

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    const form = screen.getByRole("form", { name: "Bitbucket token" });
    expect(within(form).getByRole("link", { name: "Create a Bitbucket token" }).getAttribute("target")).toBe("_blank");
    fireEvent.change(within(form).getByLabelText("Atlassian account email"), { target: { value: "me@example.com" } });
    fireEvent.change(within(form).getByLabelText("Token"), { target: { value: "revoked" } });
    fireEvent.click(within(form).getByRole("button", { name: "Check and save" }));
    expect(await within(form).findByText("Bitbucket rejected this token")).toBeTruthy();

    fireEvent.change(within(form).getByLabelText("Token"), { target: { value: "valid" } });
    fireEvent.click(within(form).getByRole("button", { name: "Check and save" }));

    expect(await screen.findByText("Connected as acme-bot")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Bitbucket token" })).toBeNull();
    expect(sentBodies.at(-1)).toEqual({ token: "valid", username: "me@example.com" });

    fireEvent.click(screen.getByRole("button", { name: "Forget saved token" }));

    expect(await screen.findByText("Not connected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Forget saved token" })).toBeNull();
  });

  it("imports a prepared model and reports it in the activity panel", async () => {
    answerProjects();
    let sentBody: unknown;
    apiServer.use(
      http.post("/api/setup", async ({ request }) => {
        sentBody = await request.json();
        return ndjson([
          { event: "model_setup_started", destination: "/models/all-MiniLM-L6-v2" },
          { event: "stage_started", stage: "verifying model" },
          {
            done: {
              model: "/models/all-MiniLM-L6-v2",
              index_root: "/indexes",
              reused: false,
              diagnostics: DIAGNOSTICS,
            },
          },
        ]);
      }),
    );
    renderAppAt("/setup");

    fireEvent.change(await screen.findByLabelText(/import a prepared model folder/), {
      target: { value: " /prepared/model " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    const activity = await screen.findByRole("region", { name: "Activity" });
    expect(
      await within(activity).findByText("Installed the model at /models/all-MiniLM-L6-v2 and checked it."),
    ).toBeTruthy();
    await waitFor(() => expect(sentBody).toEqual({ from: "/prepared/model" }));
  });
});

describe("failures that setup fixes", () => {
  it("link to the setup page from wherever they appear", async () => {
    answerProjects();
    apiServer.use(
      http.get(`${TEST_API_ORIGIN}/api/search`, () =>
        HttpResponse.json(
          { error: { code: "model_missing", message: "Set DELPHI_CODE_MODEL to a local model directory" } },
          { status: 503 },
        ),
      ),
    );
    const router = renderAppAt("/?q=passwords");

    fireEvent.click(await screen.findByRole("link", { name: "Set up the model" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/setup"));
  });
});
