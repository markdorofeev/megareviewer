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
  );
}

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
