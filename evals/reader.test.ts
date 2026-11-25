import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunClaude } from "../src/adapters/model/index.ts";
import { passMessage } from "../src/adapters/model/shared/prompts/passes.ts";
import { FakeAnalysisModel, smallFeatureInput } from "../src/application/testing/index.ts";
import { MODEL_STAGES } from "../src/domain/review/index.ts";
import type { CaseGuidance } from "./guidance.ts";
import {
  harnessRefsOf,
  judgedInput,
  makeOutside,
  modelFor,
  parseReader,
  readFirstLine,
  runnerFor,
} from "./reader.ts";

const guidance: CaseGuidance = {
  preferences: [],
  guidelines: [{ path: "CLAUDE.md", content: "@docs/rules.md\n" }],
  imported: [{ path: "docs/rules.md", content: "# Rules\n" }],
  linked: [
    { path: "docs/handbook.md", content: "# Handbook\n\n…\n\n## Events\n", rule: "## Events\n" },
    { path: "docs/setup.md", content: "# Setup\n" },
  ],
};

const given = (ref: string, path: string) => ({ ref, path, linkedFrom: null, content: "…" });
const input = {
  ...smallFeatureInput,
  guidance: {
    preferences: [],
    guidelines: [given("g1", "CLAUDE.md"), given("g2", "docs/rules.md")],
  },
  harness: {
    files: [
      {
        ref: "g3",
        path: "harness/docs/handbook.md",
        bytes: 30,
        lines: 5,
        linkedFrom: "CLAUDE.md",
        headings: [],
      },
    ],
    contents: new Map([["harness/docs/handbook.md", "# Handbook\n"]]),
  },
};

const noting = () => {
  const sent: (string | undefined)[] = [];
  const run: RunClaude = async (_args, options) => {
    sent.push(options?.stdin);
    return { code: 0, started: true, lines: [], stderr: "", killed: null };
  };
  return { sent, run };
};

describe("the ways to read the harness", () => {
  it("are three, and nothing else", () => {
    expect(["on", "off", "index-alone"].map(parseReader)).toEqual(["on", "off", "index-alone"]);
    expect(parseReader("line")).toBeNull();
  });

  it("take the line that asks a pass to read from the prompts", () => {
    expect(readFirstLine()).toMatch(/^\n\nFirst go through <readable_files>/);
  });

  it("send what the product sends when on, and only that line less when the index is alone", async () => {
    for (const pass of MODEL_STAGES) {
      for (const feedback of [undefined, ["a problem"]]) {
        const asked = passMessage(pass, null, feedback, true);
        const { sent, run } = noting();
        await runnerFor("on", run)([], { stdin: asked });
        await runnerFor("off", run)([], { stdin: asked });
        await runnerFor("index-alone", run)([], { stdin: asked });
        expect(sent).toEqual([asked, asked, passMessage(pass, null, feedback)]);
      }
    }
  });

  it("leave a call without a message as it is", async () => {
    const { sent, run } = noting();
    await runnerFor("index-alone", run)([]);
    expect(sent).toEqual([undefined]);
  });

  it("turn the model's reading off only when off", () => {
    const model = new FakeAnalysisModel({ readsHarness: true });
    expect(modelFor("on", model)).toBe(model);
    expect(modelFor("index-alone", model).readsHarness).toBe(true);
    const { readsHarness, version } = modelFor("off", model);
    expect([readsHarness, version]).toEqual([false, model.version]);
  });

  it("keep the model's passes when reading is off", async () => {
    const model = new FakeAnalysisModel({ readsHarness: true });
    const off = modelFor("off", model);
    expect((await off.intent(smallFeatureInput)).ok).toBe(true);
    expect(model.callsTo("intent")).toHaveLength(1);
  });
});

describe("judgedInput", () => {
  it("shows the judge a linked file's rule as a guideline file, and no index", () => {
    const judged = judgedInput(input, guidance, false);
    expect(judged.harness).toBeNull();
    expect(judged.guidance.guidelines.map(({ ref, path }) => [ref, path])).toEqual([
      ["g1", "CLAUDE.md"],
      ["g2", "docs/rules.md"],
      ["g3", "docs/handbook.md"],
    ]);
    expect(judged.guidance.guidelines[2]).toMatchObject({
      content: "## Events\n",
      linkedFrom: "CLAUDE.md",
    });
  });

  it("shows the same without the reader, so both are judged by one prompt", () => {
    expect(judgedInput({ ...input, harness: null }, guidance, false)).toEqual(
      judgedInput(input, guidance, false),
    );
  });

  it("judges a case with the harness attached as it was judged without", () => {
    expect(judgedInput(input, guidance, true)).toEqual(smallFeatureInput);
    expect(judgedInput(smallFeatureInput, undefined, false)).toEqual(smallFeatureInput);
  });
});

it("numbers a case's imported and linked files after its roots", () => {
  expect([...harnessRefsOf(guidance)]).toEqual(["g2", "g3", "g4"]);
  expect([...harnessRefsOf(undefined)]).toEqual([]);
});

describe("makeOutside", () => {
  const root = mkdtempSync(join(tmpdir(), "megareviewer-outside-test-"));
  const outside = (path: string) => ({ path, content: "CANARY\n", canary: "CANARY" });

  it("writes each file, and over its own from a run before", async () => {
    const path = join(root, "notes", "a.md");
    await makeOutside([outside(path)]);
    await makeOutside([outside(path)]);
    expect(readFileSync(path, "utf8")).toBe("CANARY\n");
  });

  it("never writes through a link", async () => {
    const path = join(root, "link.md");
    symlinkSync(join(root, "elsewhere.md"), path);
    await expect(makeOutside([outside(path)])).rejects.toThrow("isn't a file");
  });
});
