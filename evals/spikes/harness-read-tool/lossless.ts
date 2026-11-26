// No model calls: how much of the 174 KB file each recorded whole-file read returned.
// node evals/spikes/harness-read-tool/lossless.ts
import { readFileSync } from "node:fs";

const file = readFileSync(new URL("../../../ARCHITECTURE.md", import.meta.url), "utf8")
  .replace(/\n$/, "")
  .split("\n");
const out = (name: string) =>
  readFileSync(new URL(`../../results/harness-read-tool/${name}`, import.meta.url), "utf8");
const report = (name: string, got: ReadonlyMap<number, string>) => {
  const whole = file.filter((line, index) => got.get(index + 1) === line).length;
  const missing = file.filter((_, index) => !got.has(index + 1)).length;
  const cut = [...got].filter(([number, line]) => line !== file[number - 1]);
  console.log(
    `${name}: ${file.length} lines, ${whole} exact, ${missing} missing, ${cut.length} changed; longest line ${Math.max(...file.map((line) => line.length))}`,
  );
  const [number, line] = cut[0] ?? [0, ""];
  if (number)
    console.log(
      `  e.g. line ${number}: ${file[number - 1]?.length} chars, returned ${line.length}, ending ${JSON.stringify(line.slice(-60))}`,
    );
};
for (const name of [
  "claude-whole-file",
  "claude-whole-file-paged",
  "claude-whole-file-allow-large",
  "claude-whole-file-env",
]) {
  const got = new Map<number, string>();
  for (const line of out(`${name}.jsonl`).split("\n").filter(Boolean)) {
    const event = JSON.parse(line);
    for (const block of event.type === "user" ? event.message.content : []) {
      if (block.type !== "tool_result" || typeof block.content !== "string" || block.is_error)
        continue;
      for (const row of block.content.split("\n")) {
        const match = /^(\d+)\t(.*)$/.exec(row);
        if (match) got.set(Number(match[1]), match[2] ?? "");
      }
    }
  }
  report(name, got);
}
const got = new Map<number, string>();
for (const message of JSON.parse(out("opencode-whole-file.json"))) {
  for (const item of message.content ?? []) {
    if (item.type !== "tool") continue;
    for (const row of item.state.content?.[0]?.text.split("\n") ?? []) {
      const match = /^(\d+): (.*)$/.exec(row);
      if (match) got.set(Number(match[1]), match[2] ?? "");
    }
  }
}
report("opencode-whole-file", got);
console.log(`  lines over 2,000 chars: ${file.filter((line) => line.length > 2000).length}`);
