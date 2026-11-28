import { describe, expect, it } from "vitest";
import { ErrorResponse, routes, TOKEN_HEADER } from "../../../contracts/index.ts";
import { FakeCodeParser, RecordingLogger } from "../../application/testing/index.ts";
import { loadHarness } from "../../application/use-cases/index.ts";
import { createFakeApp } from "./fake-app.ts";
import { receiptsHarness } from "./receipts-harness.ts";

const PORT = 4825;
const TOKEN = "fake-token";
const { ref, baseSha, url } = receiptsHarness.pullRequest;

const setup = async () => {
  const fake = await createFakeApp({
    parser: new FakeCodeParser(),
    logger: new RecordingLogger(),
    version: "1.2.3-fake",
    staticDir: null,
    sessionToken: TOKEN,
  });
  const app = fake.app(PORT);
  const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await app.request(path, {
      method: init.method ?? "GET",
      headers: { host: `127.0.0.1:${PORT}`, [TOKEN_HEADER]: TOKEN },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });
    return response.json();
  };
  const started = routes.startAnalysis.response.parse(
    await call("/api/analyses", { method: "POST", body: { url } }),
  );
  /** Joins the load the analysis started. */
  const loaded = () =>
    loadHarness(
      {
        harnessSource: () => fake.harnessSources.github,
        harnessStore: fake.harnessStore,
        logger: new RecordingLogger(),
      },
      ref.repo,
      baseSha,
    );
  const section = async () => {
    const view = routes.getPreferences.response.parse(await call("/api/preferences"));
    const [repository] = view.repositories;
    if (repository === undefined) throw new Error("the analyzed repository is listed");
    return repository;
  };
  const use = async () =>
    routes.getHarness.response.parse(await call(`/api/analyses/${started.analysisId}/harness`));
  const put = (path: string, enabled: boolean) =>
    call("/api/preferences/guidelines", { method: "PUT", body: { repo: ref.repo, path, enabled } });
  const switchFile = async (path: string, enabled: boolean) =>
    routes.setGuidelineSwitch.response.parse(await put(path, enabled));
  return { fake, loaded, section, use, put, switchFile };
};

type Section = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>["section"]>>;

const roots = ({ guidelineFiles }: Section) =>
  (guidelineFiles ?? []).map(({ path, enabled, use }) => [path, enabled, use]);

const linked = ({ guidelineFiles }: Section, root: string) =>
  (guidelineFiles?.find(({ path }) => path === root)?.linked ?? []).map(
    ({ path, linkedFrom, via, enabled, use }) => [path, linkedFrom, via, enabled, use],
  );

const ARCHITECTURE = "docs/architecture.md";

describe("receipts-harness over HTTP", () => {
  it("lists each guideline file with what it links, how a review would use it, and what was left out", async () => {
    const { loaded, section } = await setup();
    await loaded();

    const listed = await section();

    expect(roots(listed)).toEqual([
      ["REVIEW.md", true, "prompt"],
      ["CLAUDE.md", true, "prompt"],
    ]);
    // REVIEW.md only mentions the house rules, which are under CLAUDE.md since it imports them.
    expect(linked(listed, "REVIEW.md")).toEqual([]);
    expect(listed.guidelineFiles?.[0]?.listedElsewhere).toEqual([{ path: "CLAUDE.md", files: 2 }]);
    expect(linked(listed, "CLAUDE.md")).toEqual([
      ["docs/house-rules.md", "CLAUDE.md", "import", true, "prompt"],
      [ARCHITECTURE, "CLAUDE.md", "import", true, "on-request"],
      ["docs/testing.md", "CLAUDE.md", "mention", true, "on-request"],
      ["docs/runbooks/README.md", "CLAUDE.md", "link", true, "on-request"],
      ["docs/naming.md", "docs/house-rules.md", "import", true, "prompt"],
      ["docs/runbooks/refunds.md", "docs/runbooks/README.md", "link", true, "on-request"],
      ["docs/runbooks/stock.md", "docs/runbooks/README.md", "link", true, "on-request"],
    ]);
    expect(listed).toMatchObject({
      guidelineNote: null,
      harnessCut: null,
      harnessSkipped: [{ path: "docs/decision-log.md", reason: "too-large" }],
      harnessNote: null,
    });
  });

  it("switches a root and its linked files, and answers how every file is used then", async () => {
    const { loaded, section, switchFile, use } = await setup();
    await loaded();
    const all = {
      status: "ready",
      inPrompt: ["REVIEW.md", "CLAUDE.md", "docs/house-rules.md", "docs/naming.md"],
      onRequest: 5,
    };
    expect(await use()).toEqual(all);

    const claudeOff = await switchFile("CLAUDE.md", false);
    expect(roots(claudeOff)).toEqual([
      ["REVIEW.md", true, "prompt"],
      ["CLAUDE.md", false, null],
    ]);
    // REVIEW.md only mentions the house rules, so without CLAUDE.md nothing is always loaded.
    const claude = claudeOff.guidelineFiles?.find(({ path }) => path === "CLAUDE.md");
    expect(
      claude?.linked
        .filter(({ path }) => path === "docs/house-rules.md" || path === "docs/naming.md")
        .map(({ path, use, currentUse }) => [path, use, currentUse]),
    ).toEqual([
      ["docs/house-rules.md", "prompt", "on-request"],
      ["docs/naming.md", "prompt", "on-request"],
    ]);
    expect(await use()).toEqual({ status: "ready", inPrompt: ["REVIEW.md"], onRequest: 2 });

    await switchFile("CLAUDE.md", true);
    expect(await use()).toEqual(all);

    const off = await switchFile("docs/runbooks/README.md", false);
    expect(
      linked(off, "CLAUDE.md")
        .filter(([path]) => String(path).startsWith("docs/runbooks/"))
        .map(([path, , , enabled, used]) => [path, enabled, used]),
    ).toEqual([
      ["docs/runbooks/README.md", false, null],
      // On themselves, and reached only through the one that's off.
      ["docs/runbooks/refunds.md", true, null],
      ["docs/runbooks/stock.md", true, null],
    ]);
    expect((await use()).onRequest).toBe(2);
    expect(await section()).toEqual(off);
  });

  it("switches any file of the latest harness, and refuses another", async () => {
    const { fake, loaded, put, switchFile } = await setup();
    await loaded();
    await switchFile("docs/naming.md", false);

    for (const path of ["docs/STYLE.md", "docs/decision-log.md"]) {
      expect(ErrorResponse.parse(await put(path, true)).error).toEqual({
        code: "bad-request",
        message: `${path} isn't a guideline file megareviewer reads: REVIEW.md, AGENTS.md, CLAUDE.md, CONTRIBUTING.md, .github/copilot-instructions.md`,
      });
    }
    expect(await fake.preferences.getGuidelineSwitches(ref.repo)).toEqual(
      new Map([["docs/naming.md", false]]),
    );
  });

  it("keeps the switch of a root over what a prompt holds, whose imports are used with it", async () => {
    const { fake, section, switchFile } = await setup();
    fake.harnessSources.github.setFiles(ref.repo, "d".repeat(40), {
      "CLAUDE.md": `@rules.md\n${"x".repeat(70_000)}`,
      "rules.md": "- Name the test.\n",
    });
    await loadHarness(
      {
        harnessSource: () => fake.harnessSources.github,
        harnessStore: fake.harnessStore,
        logger: new RecordingLogger(),
      },
      ref.repo,
      "d".repeat(40),
    );

    const on = await switchFile("CLAUDE.md", true);

    expect(roots(on)).toEqual([["CLAUDE.md", true, "on-request"]]);
    expect(linked(on, "CLAUDE.md")).toEqual([["rules.md", "CLAUDE.md", "import", true, "prompt"]]);
    expect(await section()).toEqual(on);
  });
});
