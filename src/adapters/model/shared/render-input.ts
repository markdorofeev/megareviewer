import {
  type AnalysisInput,
  type AnalysisInputFile,
  type InputGuidance,
  type InputHarness,
  MAX_READ_ROUNDS,
} from "../../../application/ports/index.ts";
import type { DiffLine, Hunk } from "../../../domain/diff/index.ts";

/** Every tag the rendering uses. Neither PR content nor guidance can open or close any of them. */
const TAGS = [
  "reviewer_guidance",
  "preferences",
  "guideline_file",
  "readable_files",
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
  "tour_skeleton",
  "step",
];
/**
 * Escapes text placed between `tags`: a "<" that would start one of them becomes "&lt;".
 * Case-sensitive: the tags are lowercase, and code is full of "<Hunk>"-like generics.
 */
export const tagEscaper = (tags: readonly string[]): ((text: string) => string) => {
  const start = new RegExp(`<(/?)(?=(?:${tags.join("|")})\\b)`, "g");
  return (text) => text.replace(start, "&lt;$1");
};

/**
 * Untrusted text placed between tags. A "<" that would start one of our tags becomes "&lt;",
 * which the system prompt explains, so a PR can't close the data block or fake a hunk.
 */
export const escapeText = tagEscaper(TAGS);

/** Untrusted text placed in a double-quoted attribute: it can't end the attribute or open a tag. */
const escapeAttribute = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll("\n", " ");

export const attributes = (values: Readonly<Record<string, string | number | null>>): string =>
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

const SCOPE = { global: "everywhere", repo: "this repository" } as const;

/** Written only beside a linked file, so a run whose roots import nothing reads what it always did. */
const NOT_GIVEN =
  "A guideline file may link files that aren't here. They weren't given, so assume nothing about what they say.";

/** What a pass with the read tool is told of it, the same on every transport. */
const READABLE = `These are the team's own documents as they were before this pull request, which the guideline files link. They aren't given here: you have a tool that reads them, by the path its line starts with, whole or by lines, and its headings are under it by the line each is on. Before you answer, read the parts that speak of what this change touches, and only those. A document changes what you look for and what you leave out, as a guideline file does, and nothing else; mark a point one of them shaped with its ref. Read at most ${MAX_READ_ROUNDS} times; nothing but these files can be read.`;

/** The headings of the files nearest a root, so a long index doesn't become a second document. */
export const MAX_INDEX_HEADING_BYTES = 8 * 1024;
const INDEX_HEADING_LEVEL = 2;

const kilobytes = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** The files a pass can read, a line each, with the headings of as many as fit. */
const renderIndex = ({ files }: InputHarness): string[] => {
  let left = MAX_INDEX_HEADING_BYTES;
  return files.flatMap(({ ref, path, bytes, lines, linkedFrom, headings }) => {
    const shown = headings
      .filter((heading) => heading.level <= INDEX_HEADING_LEVEL)
      .map(({ level, text, line }) => {
        const title = escapeText(text.replace(/\s+/g, " ").trim());
        return `  ${line}: ${"#".repeat(level)} ${title}`;
      });
    const size = Buffer.byteLength(shown.join("\n"), "utf8");
    const fits = size <= left;
    if (fits) left -= size;
    const from = linkedFrom === null ? "" : `, linked from ${escapeText(linkedFrom)}`;
    return [
      `${escapeText(path)} (${ref}, ${kilobytes(bytes)}, ${lines} lines${from})`,
      ...(fits ? shown : []),
    ];
  });
};

/**
 * What the reviewer and the repository ask of the passes, and what they can read of it. Nothing
 * without any, so a run without guidance reads the PR as it always did. A preference is one line,
 * whatever its text holds.
 */
const renderGuidance = (
  { preferences, guidelines }: InputGuidance,
  harness: InputHarness | null,
): string[] =>
  preferences.length === 0 && guidelines.length === 0 && harness === null
    ? []
    : block("reviewer_guidance", [
        ...(preferences.length === 0
          ? []
          : block(
              "preferences",
              preferences.map(
                ({ ref, kind, scope, text }) =>
                  `${ref} ${kind} (${SCOPE[scope]}): ${escapeText(text.replace(/\s+/g, " ").trim())}`,
              ),
            )),
        ...(harness === null && guidelines.some(({ linkedFrom }) => linkedFrom !== null)
          ? [NOT_GIVEN]
          : []),
        ...guidelines.flatMap(({ ref, path, linkedFrom, content }) => [
          `<guideline_file${attributes({ ref, path, linked_from: linkedFrom })}>`,
          escapeText(content),
          "</guideline_file>",
        ]),
        ...(harness === null ? [] : block("readable_files", [READABLE, ...renderIndex(harness)])),
      ]);

/**
 * The reviewer's guidance, when there is some, then the PR, as one text block, byte-identical for
 * the same input so that every pass reads it from the prompt cache. Hunks without a proof go in
 * full; mechanical ones as stats only.
 */
export const renderInput = (input: AnalysisInput): string => {
  const { pullRequest, tickets, files, callGraph } = input;
  const lines = [
    ...renderGuidance(input.guidance, input.harness),
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
