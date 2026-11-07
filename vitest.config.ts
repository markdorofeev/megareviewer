import { defineConfig } from "vitest/config";

const setupFiles = ["scripts/vitest/no-network.ts"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "server",
          include: [
            "src/**/*.test.ts",
            "contracts/**/*.test.ts",
            "scripts/**/*.test.ts",
            // Not evals/cases/: their files/ hold other projects' code, tests included.
            "evals/*.test.ts",
          ],
          environment: "node",
          setupFiles,
        },
      },
      {
        test: {
          name: "web",
          include: ["web/{src,dev}/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: [...setupFiles, "web/src/testing/setup.ts"],
          // Vitest empties CSS imports, `?raw` ones too; the token contrast test reads stylesheets raw.
          css: { include: [/\.css\?raw$/] },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "contracts/**/*.ts", "web/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "src/application/testing/**"],
      thresholds: {
        "src/domain/**": { branches: 90, lines: 90 },
        "src/application/**": { branches: 90, lines: 90 },
      },
    },
  },
});
