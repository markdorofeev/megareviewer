import { ImageIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { BodyBlock, Span, TableAlign } from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { languageOf } from "../diff/languages.ts";
import { CodeLine, useCodeTokens } from "./code-lines.tsx";
import { ImageViewer } from "./image-viewer.tsx";

/** A fenced block's language as a grammar name: `ts`, `py` and the like read as extensions. */
const fenceLanguage = (info: string | null): string | null =>
  info === null ? null : languageOf({ path: `code.${info}`, language: info });

const CodeBlock = ({
  text,
  language,
}: {
  readonly text: string;
  readonly language: string | null;
}) => {
  const grammar = fenceLanguage(language);
  const tokens = useCodeTokens(text, grammar);
  const lines = text.split("\n");
  return (
    <pre
      data-slot="thread-code"
      className="overflow-x-auto rounded-md border bg-surface-subtle px-2.5 py-1.5 font-mono text-code-compact"
    >
      <code>
        {lines.map((line, at) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a line's place is its identity.
          <span key={at} className="block min-h-[1lh] whitespace-pre">
            <CodeLine text={line} tokens={tokens?.[at]} />
          </span>
        ))}
      </code>
    </pre>
  );
};

/**
 * An image or video from the host's own attachments, loaded through the local server; when it
 * can't be, it's named instead.
 */
const Media = ({
  kind,
  alt,
  src,
  size,
}: {
  readonly kind: "image" | "video";
  readonly alt: string;
  readonly src: string;
  readonly size?: { readonly width: number; readonly height: number } | undefined;
}) => {
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false);
  if (failed) {
    return (
      <span
        data-slot="thread-image"
        className="inline-flex items-center gap-1 rounded-sm border bg-muted px-1 text-caption text-muted-foreground"
      >
        <ImageIcon aria-hidden="true" className="size-3" />
        {kind === "image" ? "Image" : "Video"}
        {alt === "" ? "" : `: ${alt}`} couldn't be loaded
      </span>
    );
  }
  const className = "block max-h-[28rem] max-w-full rounded-md border bg-muted";
  const label = alt === "" ? "Image from the comment" : alt;
  return kind === "image" ? (
    <>
      <button
        type="button"
        aria-label={`Open ${label} full screen`}
        onClick={() => setFull(true)}
        className="block max-w-full cursor-zoom-in rounded-md"
      >
        <img
          data-slot="thread-media"
          src={src}
          alt={label}
          // With its size, the image keeps its place while it loads, so the page doesn't jump.
          {...(size === undefined ? {} : { width: size.width, height: size.height })}
          loading="lazy"
          onError={() => setFailed(true)}
          className={cn(className, "h-auto w-auto")}
        />
      </button>
      {full && <ImageViewer src={src} alt={label} onClose={() => setFull(false)} />}
    </>
  ) : (
    // biome-ignore lint/a11y/useMediaCaption: a reviewer's screen recording has no captions to give.
    <video
      data-slot="thread-media"
      src={src}
      controls
      preload="metadata"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};

type MediaUrl = ((url: string) => string) | undefined;

/**
 * One run of a paragraph. An image or video the host keeps loads through the local server; one
 * from anywhere else is only named, so a PR's author can't learn who's reviewing. A link opens
 * only when the reviewer follows it, and only to http(s).
 */
const SpanView = ({ span, mediaUrl }: { readonly span: Span; readonly mediaUrl: MediaUrl }) => {
  switch (span.kind) {
    case "text":
      return <>{span.text}</>;
    case "code":
      return (
        <code className="rounded-sm bg-muted px-1 font-mono text-code-compact">{span.text}</code>
      );
    case "strong":
      return (
        <strong className="font-semibold">
          <Spans spans={span.spans} mediaUrl={mediaUrl} />
        </strong>
      );
    case "emphasis":
      return (
        <em>
          <Spans spans={span.spans} mediaUrl={mediaUrl} />
        </em>
      );
    case "strike":
      return (
        <del>
          <Spans spans={span.spans} mediaUrl={mediaUrl} />
        </del>
      );
    case "link":
      return span.url === null ? (
        <Spans spans={span.spans} mediaUrl={mediaUrl} />
      ) : (
        // Underlined, so it doesn't read as a link by its color alone.
        <a
          href={span.url}
          title={span.url}
          target="_blank"
          rel="noreferrer noopener nofollow"
          className="underline"
        >
          <Spans spans={span.spans} mediaUrl={mediaUrl} />
        </a>
      );
    case "image":
    case "video": {
      if (span.url !== null && mediaUrl) {
        return <Media kind={span.kind} alt={span.text} src={mediaUrl(span.url)} size={span.size} />;
      }
      const what = span.kind === "image" ? "Image" : "Video";
      return (
        <span
          data-slot="thread-image"
          className="inline-flex items-center gap-1 rounded-sm border bg-muted px-1 text-caption text-muted-foreground"
        >
          <ImageIcon aria-hidden="true" className="size-3" />
          {span.text === "" ? what : `${what}: ${span.text}`}
          <span className="sr-only">, not loaded: it isn't in the host's own attachments</span>
        </span>
      );
    }
  }
};

const Spans = ({
  spans,
  mediaUrl,
}: {
  readonly spans: readonly Span[];
  readonly mediaUrl: MediaUrl;
}) =>
  spans.map((span, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: spans have no identity but their place.
    <SpanView key={`${span.kind}:${index}`} span={span} mediaUrl={mediaUrl} />
  ));

/** A heading's weight by its level: a comment's headings aren't the page's, so they're text. */
const HEADING: Record<number, string> = {
  1: "text-heading font-semibold",
  2: "text-heading font-semibold",
  3: "text-body font-semibold",
};

const ALIGN: Record<Exclude<TableAlign, null>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

interface BlocksProps {
  readonly suggestion: (lines: readonly string[]) => ReactNode;
  readonly mediaUrl: MediaUrl;
}

const Blocks = ({ blocks, ...props }: BlocksProps & { readonly blocks: readonly BodyBlock[] }) =>
  blocks.map((block, at) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no identity but their place.
    <BlockView key={`${block.kind}:${at}`} block={block} {...props} />
  ));

const BlockView = ({
  block,
  suggestion,
  mediaUrl,
}: BlocksProps & { readonly block: BodyBlock }) => {
  switch (block.kind) {
    case "suggestion":
      return <div>{suggestion(block.lines)}</div>;
    case "code":
      return <CodeBlock text={block.text} language={block.language} />;
    case "paragraph":
      return (
        <p className="whitespace-pre-wrap">
          <Spans spans={block.spans} mediaUrl={mediaUrl} />
        </p>
      );
    case "heading":
      return (
        <p
          data-slot="thread-heading"
          className={cn("whitespace-pre-wrap", HEADING[block.level] ?? "font-semibold")}
        >
          <Spans spans={block.spans} mediaUrl={mediaUrl} />
        </p>
      );
    case "quote":
      return (
        <blockquote className="flex flex-col gap-2 border-l-2 border-border pl-3 text-muted-foreground">
          <Blocks blocks={block.blocks} suggestion={suggestion} mediaUrl={mediaUrl} />
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items have no identity but their place.
        <li key={index} className={cn("pl-1", item.checked !== null && "list-none -ml-5 pl-0")}>
          <div className="flex items-baseline gap-1.5">
            {item.checked !== null && (
              <span aria-hidden="true" className="w-4 shrink-0 text-center">
                {item.checked ? "☑" : "☐"}
              </span>
            )}
            {item.checked !== null && (
              <span className="sr-only">{item.checked ? "Done: " : "Not done: "}</span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Blocks blocks={item.blocks} suggestion={suggestion} mediaUrl={mediaUrl} />
            </div>
          </div>
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start} className="flex list-decimal flex-col gap-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5">{items}</ul>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="border-collapse text-ui">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns have no identity but their place.
                    key={index}
                    className={cn(
                      "border bg-muted px-2 py-1 font-semibold",
                      ALIGN[block.align[index] ?? "left"],
                    )}
                  >
                    <Spans spans={cell} mediaUrl={mediaUrl} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowAt) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity but their place.
                <tr key={rowAt}>
                  {row.map((cell, index) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns have no identity but their place.
                      key={index}
                      className={cn("border px-2 py-1", ALIGN[block.align[index] ?? "left"])}
                    >
                      <Spans spans={cell} mediaUrl={mediaUrl} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr className="border-border" />;
  }
};

/**
 * A comment's blocks as elements built from its text: paragraphs, headings, quotes, lists and
 * tables with their emphasis, code spans and links, and code blocks colored like the diff.
 * Nothing in a body becomes HTML. `suggestion` draws a suggestion block.
 */
export const ThreadBody = ({
  blocks,
  suggestion,
  mediaUrl,
}: {
  readonly blocks: readonly BodyBlock[];
  readonly suggestion: (lines: readonly string[]) => ReactNode;
  /** Where an attachment loads from; without it, attachments are only named. */
  readonly mediaUrl?: (url: string) => string;
}) => (
  <div data-slot="thread-body" className="flex flex-col gap-2 text-body break-words">
    <Blocks blocks={blocks} suggestion={suggestion} mediaUrl={mediaUrl} />
  </div>
);
