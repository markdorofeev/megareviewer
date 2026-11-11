import { ImageIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { BodyBlock, Span } from "../../../../src/domain/review/index.ts";
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

/**
 * One run of a paragraph. An image or video the host keeps loads through the local server; one
 * from anywhere else is only named, so a PR's author can't learn who's reviewing.
 */
const SpanView = ({
  span,
  mediaUrl,
}: {
  readonly span: Span;
  readonly mediaUrl: ((url: string) => string) | undefined;
}) => {
  if ((span.kind === "image" || span.kind === "video") && span.url !== null && mediaUrl) {
    return <Media kind={span.kind} alt={span.text} src={mediaUrl(span.url)} size={span.size} />;
  }
  if (span.kind === "code") {
    return (
      <code className="rounded-sm bg-muted px-1 font-mono text-code-compact">{span.text}</code>
    );
  }
  if (span.kind === "image" || span.kind === "video") {
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
  return <span>{span.text}</span>;
};

/**
 * A comment's blocks as text: paragraphs with code spans, and code blocks colored like the diff.
 * Nothing in a body becomes HTML, a link or an image. `suggestion` draws a suggestion block.
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
    {blocks.map((block, at) => {
      // Blocks and spans have no identity but their place, and a body never reorders.
      const key = `${block.kind}:${at}`;
      if (block.kind === "suggestion") return <div key={key}>{suggestion(block.lines)}</div>;
      if (block.kind === "code") {
        return <CodeBlock key={key} text={block.text} language={block.language} />;
      }
      return (
        <p key={key} className="whitespace-pre-wrap">
          {block.spans.map((span, index) => (
            <SpanView
              // biome-ignore lint/suspicious/noArrayIndexKey: spans have no identity but their place.
              key={`${span.kind}:${index}`}
              span={span}
              mediaUrl={mediaUrl}
            />
          ))}
        </p>
      );
    })}
  </div>
);
