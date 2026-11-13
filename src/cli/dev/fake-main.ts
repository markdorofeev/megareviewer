import "../warnings.ts";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import packageJson from "../../../package.json" with { type: "json" };
import { createTreeSitterCodeParser } from "../../adapters/treesitter/index.ts";
import { createLogger } from "../logger.ts";
import { serve } from "../serve.ts";
import { createFakeApp } from "./fake-app.ts";

// Fake mode, for UI development and end-to-end tests: no credentials, no network, nothing on disk.
// Never bundled.
const { values } = parseArgs({
  options: {
    port: { type: "string", default: "0" },
    token: { type: "string" },
    static: { type: "string" },
    "no-ai": { type: "boolean" },
  },
});

const logger = createLogger({ level: "info" });
const fake = await createFakeApp({
  parser: await createTreeSitterCodeParser({
    grammarsDir: fileURLToPath(new URL("../../adapters/treesitter/grammars", import.meta.url)),
  }),
  logger,
  version: `${packageJson.version}-fake`,
  staticDir: values.static ?? null,
  modelAvailable: values["no-ai"] !== true,
  ...(values.token !== undefined && { sessionToken: values.token }),
});
const server = await serve(fake.app, Number(values.port));

console.log(`megareviewer fake mode, serving fixtures
Token ${fake.composition.sessionToken}
Open http://127.0.0.1:${server.port}/?token=${fake.composition.sessionToken}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
