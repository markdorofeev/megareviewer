import type { AnalysisInput, AnalysisInputFile } from "../../application/ports/index.ts";
import type { DiffLine, Hunk } from "../../domain/diff/index.ts";

/** Every tag the rendering uses. PR content can't open or close any of them. */
const TAGS = [
  "pull_request_data",
  "pull_request",
  "description",
  "commits",
  "commit",
  "tickets",
  "ticket",
  "ticket_description",
  "files",
  "file",
  "hunk",
  "mechanical_hunk",
  "file_content",
  "call_graph",
  "earlier_results",
  "intent",
  "risk",
  "decisions",
];
// Case-sensitive: the tags are lowercase, and code is full of "<Hunk>"-like generics.
const TAG_START = new RegExp(`<(/?)(?=(?:${TAGS.join("|")})\\b)`, "g");

/**
 * Untrusted text placed between tags. A "<" that would start one of our tags becomes "&lt;",
 * which the system prompt explains, so a PR can't close the data block or fake a hunk.
 */
export const escapeText = (text: string): string => text.replace(TAG_START, "&lt;$1");

/** Untrusted text placed in a double-quoted attribute: it can't end the attribute or open a tag. */
const escapeAttribute = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll("\n", " ");

const attributes = (values: Readonly<Record<string, string | number | null>>): string =>
  Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== null)
    .map(([name, value]) => ` ${name}="${escapeAttribute(String(value))}"`)
    .join("");

const PREFIX: Readonly<Record<DiffLine["kind"], string>> = { context: " ", add: "+", del: "-" };

/** "+ 14 | text": added, removed or context, then the new line number (old for removed lines). */
const renderHunk = (hunk: Hunk): string => {
  const numbers = hunk.lines.map((line) => String(line.newLine ?? line.oldLine ?? ""));
  const width = Math.max(0, ...numbers.map((number) => number.length));
  const body = hunk.lines.flatMap((line, index) => [
    `${PREFIX[line.kind]}${(numbers[index] ?? "").padStart(width)} | ${escapeText(line.text)}`,
    ...(line.noNewlineAtEnd ? ["\\ No newline at end of file"] : []),
  ]);
  const open = `<hunk${attributes({ id: hunk.id, file: hunk.path, heading: hunk.sectionHeading })}>`;
  return [open, ...body, "</hunk>"].join("\n");
};

const renderFile = (file: AnalysisInputFile): string => {
  const open = `<file${attributes({
    path: file.path,
    old_path: file.oldPath,
    status: file.status,
    language: file.language,
  })}>`;
  const mechanical = file.mechanicalHunks.map(
    ({ hunkId, proof, additions, deletions }) =>
      `<mechanical_hunk${attributes({ id: hunkId, proof: proof.kind })} /> +${additions} −${deletions}`,
  );
  const content =
    file.headContent === null
      ? []
      : [
          `<file_content${attributes({ path: file.path })}>`,
          escapeText(file.headContent),
          "</file_content>",
        ];
  return [open, ...file.hunks.map(renderHunk), ...mechanical, ...content, "</file>"].join("\n");
};

const block = (tag: string, lines: readonly string[]): string[] => [
  `<${tag}>`,
  ...lines,
  `</${tag}>`,
];

const byPath = (a: AnalysisInputFile, b: AnalysisInputFile): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/**
 * The PR as one text block, byte-identical for the same input so that every pass reads it from
 * the prompt cache. Hunks without a proof go in full; mechanical ones as stats only.
 */
export const renderInput = (input: AnalysisInput): string => {
  const { pullRequest, tickets, files, callGraph } = input;
  const lines = [
    "<pull_request_data>",
    ...block("pull_request", [
      `title: ${escapeText(pullRequest.title)}`,
      `url: ${escapeText(pullRequest.url)}`,
      `branch: ${escapeText(pullRequest.sourceBranch)} → ${escapeText(pullRequest.targetBranch)}`,
      ...block("description", [escapeText(pullRequest.description)]),
      ...block(
        "commits",
        pullRequest.commits.map(
          (commit) =>
            `<commit${attributes({ sha: commit.sha.slice(0, 12) })}>\n${escapeText(commit.message)}\n</commit>`,
        ),
      ),
    ]),
    ...block(
      "tickets",
      tickets.map((ticket) =>
        [
          `<ticket${attributes({ key: ticket.key, type: ticket.type, status: ticket.status })}>`,
          `summary: ${escapeText(ticket.summary)}`,
          ...block("ticket_description", [escapeText(ticket.description)]),
          "</ticket>",
        ].join("\n"),
      ),
    ),
    ...block("files", [...files].sort(byPath).map(renderFile)),
    ...block(
      "call_graph",
      callGraph.map(
        ({ fromPartId, toPartId, symbol }) => `${fromPartId} → ${toPartId} (${escapeText(symbol)})`,
      ),
    ),
    "</pull_request_data>",
  ];
  return lines.join("\n");
};
