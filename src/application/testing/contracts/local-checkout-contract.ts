import { beforeAll, describe, expect, it } from "vitest";
import { type LocalCheckout, MAX_CHECKOUT_FILE_BYTES } from "../../ports/index.ts";

/** The files every implementation is set up with, at one commit. */
export const CHECKOUT_CONTRACT_FILES: Readonly<Record<string, string>> = {
  "src/app.py": "from .routes import router\n\napp = create_app(router)\n",
  "src/routes/items.ts": 'export const items = () => "ünïcödé ✓";\n',
  "docs/a file with spaces.md": "# Spaces\n",
  "big.txt": "x".repeat(MAX_CHECKOUT_FILE_BYTES + 1),
};

export interface LocalCheckoutContractSetup {
  readonly checkout: LocalCheckout;
  /** The commit holding `CHECKOUT_CONTRACT_FILES`, and nothing else. */
  readonly sha: string;
}

const MISSING = "0123456789abcdef0123456789abcdef01234567";

export const describeLocalCheckoutContract = (
  name: string,
  setup: () => Promise<LocalCheckoutContractSetup>,
): void => {
  describe(`LocalCheckout contract: ${name}`, () => {
    let checkout: LocalCheckout;
    let sha: string;
    beforeAll(async () => {
      ({ checkout, sha } = await setup());
    });

    it("knows which commits it has", async () => {
      expect(await checkout.hasCommit(sha)).toBe(true);
      expect(await checkout.hasCommit(MISSING)).toBe(false);
    });

    it("lists every file at a commit, sorted", async () => {
      expect(await checkout.listFiles(sha)).toEqual({
        ok: true,
        value: Object.keys(CHECKOUT_CONTRACT_FILES).sort(),
      });
    });

    it("reads files in the order asked, skipping large and missing ones", async () => {
      const read = await checkout.readFiles(sha, [
        "src/routes/items.ts",
        "missing.ts",
        "big.txt",
        "docs/a file with spaces.md",
        "src/app.py",
      ]);
      expect(read).toEqual({
        ok: true,
        value: [
          { kind: "text", content: CHECKOUT_CONTRACT_FILES["src/routes/items.ts"] },
          { kind: "unreadable" },
          { kind: "too-large" },
          { kind: "text", content: CHECKOUT_CONTRACT_FILES["docs/a file with spaces.md"] },
          { kind: "text", content: CHECKOUT_CONTRACT_FILES["src/app.py"] },
        ],
      });
    });

    it("reads nothing when asked for nothing", async () => {
      expect(await checkout.readFiles(sha, [])).toEqual({ ok: true, value: [] });
    });

    it("fails on a commit it doesn't have", async () => {
      const listed = await checkout.listFiles(MISSING);
      const read = await checkout.readFiles(MISSING, ["src/app.py"]);
      for (const result of [listed, read]) {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.kind).toBe("missing-commit");
      }
    });
  });
};
