import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGitattributes } from "../../domain/diff/index.ts";
import { followsLink, type Harness, type RepoRef } from "../../domain/review/index.ts";
import { FakeHarnessSource, InMemoryHarnessStore, RecordingLogger } from "../testing/index.ts";
import { loadHarness } from "./index.ts";

/** Recorded by `scripts/record-harness-trees.ts`, which says what a tree holds. */
interface Tree {
  readonly repository: string;
  readonly commit: string;
  readonly files: Readonly<Record<string, string>>;
}

const treeOf = (name: string): Tree =>
  JSON.parse(readFileSync(new URL(`harness-trees/${name}.json`, import.meta.url), "utf8"));

const harnessOf = async (tree: Tree): Promise<Harness> => {
  const [owner = "", repo = ""] = tree.repository.split("/");
  const ref: RepoRef = { host: "github", owner, repo };
  const source = new FakeHarnessSource({ lists: true, diffs: false });
  source.setFiles(ref, tree.commit, tree.files);
  const loaded = await loadHarness(
    {
      harnessSource: () => source,
      harnessStore: new InMemoryHarnessStore(),
      logger: new RecordingLogger(),
    },
    ref,
    tree.commit,
  );
  if (!loaded.ok || loaded.value === null) throw new Error(`${tree.repository}: no harness`);
  return loaded.value.harness;
};

const paths = (harness: Harness) => harness.files.map(({ path }) => path);

describe.each(["megareviewer", "graal", "pytorch"])("the harness of %s", (name) => {
  const tree = treeOf(name);

  it("follows no link but an import to what's never rules", async () => {
    const harness = await harnessOf(tree);
    const attributeFor = parseGitattributes(tree.files[".gitattributes"] ?? "");
    expect(
      harness.files.filter(
        ({ path, via }) => via !== "root" && !followsLink(path, via, attributeFor),
      ),
    ).toEqual([]);
  });

  it("is the files it was when recorded", async () => {
    const harness = await harnessOf(tree);
    expect(
      harness.files.map(({ path, via, linkedFrom }) => `${via} ${path} < ${linkedFrom ?? ""}`),
    ).toMatchSnapshot();
  });
});

describe("the harness of megareviewer", () => {
  it("is its guideline files, what they import and the plan, without the evals' copies", async () => {
    const harness = await harnessOf(treeOf("megareviewer"));
    expect(paths(harness)).toEqual(
      expect.arrayContaining([
        "CLAUDE.md",
        "MISSION.md",
        "DESIGN.md",
        "ARCHITECTURE.md",
        "ENGINEERING.md",
        "docs/plan/README.md",
        "docs/plan/75-harness-core.md",
      ]),
    );
    expect(
      paths(harness).filter((path) =>
        /^evals\/cases\/|\/fixtures\/|\/licenses\/|PROVENANCE\.md$|\.txt$/.test(path),
      ),
    ).toEqual([]);
  });
});

describe("the harness of graal", () => {
  it("has the docs AGENTS.md says documentation lives under", async () => {
    const harness = await harnessOf(treeOf("graal"));
    expect(harness.files.find(({ path }) => path.startsWith("docs/"))).toMatchObject({
      linkedFrom: "AGENTS.md",
    });
  });
});

describe("the harness of pytorch", () => {
  it("has the AGENTS.md CLAUDE.md names a folder for, and nothing vendored", async () => {
    const harness = await harnessOf(treeOf("pytorch"));
    expect(harness.files.find(({ path }) => path === "torch/distributed/AGENTS.md")).toMatchObject({
      linkedFrom: "CLAUDE.md",
    });
    expect(
      paths(harness).filter((path) =>
        /(?:^|\/)(?:_vendor|third_party)\/|CODE_OF_CONDUCT/.test(path),
      ),
    ).toEqual([]);
  });
});
