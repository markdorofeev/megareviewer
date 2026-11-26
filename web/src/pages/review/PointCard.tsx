import {
  ChevronDownIcon,
  EyeOffIcon,
  FileTextIcon,
  FlagOffIcon,
  FlaskConicalIcon,
  PencilIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { memo, type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  type IntentMismatchKind,
  type Point,
  type PointId,
  type PointState,
  parseBody,
  type Severity,
} from "../../../../src/domain/review/index.ts";
import { Link } from "../../app/Link.tsx";
import { PREFERENCES_PATH } from "../../app/router.ts";
import { POINT_ICON, POINT_STATUS } from "../../lib/status.ts";
import { cn, cssVars } from "../../lib/utils.ts";
import { type CallPayload, type CallPeekHandle, CallTrigger } from "../../review/index.ts";
import { CHIP, lineRef, RefChip, SuggestionDiff, ThreadBody } from "../../review/thread/index.ts";
import { Button } from "../../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu.tsx";
import { PreferenceForm, type RuleFields } from "../preferences/PreferenceForm.tsx";
import type { ScopeOption } from "../preferences/rule.tsx";
import { GuardrailLine } from "./Guardrail.tsx";

export const pointAnchor = (id: PointId): string => `point-${id}`;

const MISMATCH_LABEL: Readonly<Record<IntentMismatchKind, string>> = {
  contradicts: "Contradicts what was asked",
  missing: "Asked for, not done",
  unrequested: "Done, not asked for",
};

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const KIND_TEXT: Readonly<Record<Point["kind"], string>> = {
  finding: "text-review-changes",
  risk: "text-risk-contract",
  decision: "text-muted-foreground",
};

/** What every point's actions need. */
export interface PointActions {
  readonly state: PointState;
  readonly saving: boolean;
  /** After publishing, and before the analysis is complete, a point can't be acted on. */
  readonly readOnly: boolean;
  /** The point the list or Next is on. */
  readonly current: boolean;
  /**
   * Comments on the point's lines: `add` saves its text as a draft that posts with the review;
   * otherwise the comment box opens on it first.
   */
  readonly onRaise: (point: Point, add: boolean) => void;
  readonly onState: (id: PointId, state: PointState) => void;
  /**
   * A point a preference says not to flag, folded to one line until the reviewer shows it or has
   * acted on it.
   */
  readonly leftOut: boolean;
  readonly onShow: (id: PointId) => void;
  /** Where a rule saved from the point can apply: its repository, then everywhere. */
  readonly ruleScopes: readonly ScopeOption[];
  /**
   * Saves "Don't flag things like this" as a preference and dismisses the point; answers why it
   * failed, or null.
   */
  readonly onRule: (point: Point, rule: RuleFields) => Promise<string | null>;
}

const Kind = ({ kind }: { readonly kind: Point["kind"] }) => {
  const Icon = POINT_ICON[kind];
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", KIND_TEXT[kind])}>
      <Icon aria-hidden="true" className="size-3.5" />
      {POINT_STATUS[kind].label}
    </span>
  );
};

/**
 * A point folded to one line with a way back: dismissed, already in the review, or left out by a
 * preference.
 */
const Folded = ({
  point,
  state,
  current,
  note,
  action,
  className,
  leftOut = false,
}: {
  readonly point: Point;
  readonly state: PointState;
  readonly current: boolean;
  readonly note: ReactNode;
  readonly action: ReactNode;
  readonly className?: string;
  readonly leftOut?: boolean;
}) => {
  const Icon = POINT_ICON[point.kind];
  return (
    <article
      id={pointAnchor(point.id)}
      data-slot="point"
      data-kind={point.kind}
      data-state={state}
      data-left-out={leftOut || undefined}
      data-current={current || undefined}
      aria-label={point.title}
      className={cn(
        "flex scroll-mt-24 flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground",
        className,
        current && RING,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">{POINT_STATUS[point.kind].label}: </span>
      <span
        className={cn("min-w-0 flex-1 basis-40 truncate", state === "dismissed" && "line-through")}
      >
        {point.title}
      </span>
      <span className="max-w-full min-w-0 truncate text-caption">{note}</span>
      {action}
    </article>
  );
};

/** What a guidance mark says before the preference's text or the guideline file's path. */
const guidanceWords = ({ effect, preferenceId }: NonNullable<Point["guidance"]>): string => {
  const mine = preferenceId === null ? "" : " your preference:";
  return effect === "raised" ? `From${mine}` : `Left out by${mine}`;
};

/**
 * The preference or guideline file that shaped a point, as the run had it: its text or its path,
 * a link to the preferences. Model output and the reviewer's own words, so text.
 */
const GuidanceLine = ({
  guidance,
  className,
}: {
  readonly guidance: NonNullable<Point["guidance"]>;
  readonly className?: string;
}) => {
  const Icon = guidance.preferenceId === null ? FileTextIcon : SlidersHorizontalIcon;
  return (
    <p
      data-slot="point-guidance"
      data-effect={guidance.effect}
      className={cn("flex items-start gap-1.5 text-caption text-muted-foreground", className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">
        {guidanceWords(guidance)}{" "}
        <Link
          to={PREFERENCES_PATH}
          className={cn(
            "underline",
            guidance.preferenceId === null && "font-mono text-code-compact",
          )}
        >
          {guidance.label}
        </Link>
      </span>
    </p>
  );
};

/** A point a preference left out, folded where its card would be, with Show. */
const LeftOut = ({
  point,
  guidance,
  state,
  current,
  onShow,
}: {
  readonly point: Point;
  readonly guidance: NonNullable<Point["guidance"]>;
  readonly state: PointState;
  readonly current: boolean;
  readonly onShow: () => void;
}) => (
  <Folded
    point={point}
    state={state}
    current={current}
    leftOut
    note={`${guidanceWords(guidance)} ${guidance.label}`}
    className={FOLDED}
    action={
      <Button variant="ghost" size="xs" aria-label={`Show: ${point.title}`} onClick={onShow}>
        Show
      </Button>
    }
  />
);

/**
 * The card takes the focus once the reviewer shows a left-out point: the Show button that had it
 * went with the folded line.
 */
const useShown = (leftOut: boolean, onShow: (id: PointId) => void, id: PointId) => {
  const card = useRef<HTMLElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (leftOut || !asked.current) return;
    asked.current = false;
    card.current?.focus();
  }, [leftOut]);
  const show = () => {
    asked.current = true;
    onShow(id);
  };
  return { card, show };
};

/**
 * Dismiss, and beside it the menu with the other way to: "Don't flag things like this…", which
 * opens the rule's form on the card.
 */
const Dismiss = ({
  point,
  size,
  disabled,
  onDismiss,
  onRule,
}: {
  readonly point: Point;
  readonly size: "xs" | "sm";
  readonly disabled: boolean;
  readonly onDismiss: () => void;
  readonly onRule: () => void;
}) => (
  <span className="flex items-center">
    <Button
      variant="ghost"
      size={size}
      disabled={disabled}
      aria-label={`Dismiss: ${point.title}`}
      className="rounded-r-none"
      onClick={onDismiss}
    >
      {size === "sm" && <XIcon aria-hidden="true" />}
      Dismiss
    </Button>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={size}
            data-slot="dismiss-menu"
            disabled={disabled}
            aria-label={`More ways to dismiss: ${point.title}`}
            className="w-6 rounded-l-none px-0"
          />
        }
      >
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={onRule}>
          <FlagOffIcon aria-hidden="true" />
          Don't flag things like this…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </span>
);

/**
 * A rule drafted from a point, for the reviewer to word: Don't flag, the point's title, and this
 * repository unless they choose everywhere. No model call.
 */
const RuleForm = ({
  point,
  scopes,
  onSave,
  onCancel,
}: {
  readonly point: Point;
  readonly scopes: readonly ScopeOption[];
  readonly onSave: (rule: RuleFields) => Promise<string | null>;
  readonly onCancel: () => void;
}) => {
  const [first] = scopes;
  if (first === undefined) return null;
  return (
    <div data-slot="point-rule" className="flex flex-col gap-2 rounded-md border bg-card p-3">
      <p className="text-caption text-muted-foreground">
        Word it as a rule. It's saved to your preferences, and AI reviews leave out what it
        describes, folded to a line you can open.
      </p>
      <PreferenceForm
        legend={`Don't flag things like: ${point.title}`}
        initial={{ kind: "dont-flag", text: point.title, scope: first.scope }}
        scopes={scopes}
        kindFixed
        submit="Save and dismiss"
        submitting="Saving…"
        focus
        onCancel={onCancel}
        onSubmit={onSave}
      />
    </div>
  );
};

/** The rule's form on a card: whether it's open, and whether a rule was saved from the point. */
const useRule = (point: Point, onRule: PointActions["onRule"]) => {
  const [writing, setWriting] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = async (fields: RuleFields): Promise<string | null> => {
    const failed = await onRule(point, fields);
    if (failed === null) {
      setSaved(true);
      setWriting(false);
    }
    return failed;
  };
  return { writing, setWriting, saved, save };
};

/** What a dismissed point's line says, with the rule when one was saved from it. */
const dismissedNote = (ruleSaved: boolean): ReactNode =>
  ruleSaved ? (
    <>
      Dismissed, and saved to your{" "}
      <Link to={PREFERENCES_PATH} className="underline">
        preferences
      </Link>
    </>
  ) : (
    "Dismissed"
  );

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const SEVERITY: Readonly<Record<Severity, { readonly glyph: string; readonly className: string }>> =
  {
    blocking: {
      glyph: "■",
      className: "text-severity-blocker bg-review-changes-bg border-severity-blocker/25",
    },
    major: {
      glyph: "▲",
      className: "text-severity-major bg-severity-major-bg border-severity-major/25",
    },
    minor: {
      glyph: "●",
      className: "text-severity-minor bg-review-pending-bg border-severity-minor/25",
    },
  };

/** How much Claude thinks a finding matters, while it's Claude's. */
const SeverityChip = ({ severity }: { readonly severity: Severity }) => (
  <span data-slot="severity" className={cn(CHIP, SEVERITY[severity].className)}>
    <span aria-hidden="true">{SEVERITY[severity].glyph}</span>
    {severity}
  </span>
);

const MOTION = "animate-in duration-(--duration-slow) fade-in-0 slide-in-from-top-1";
const RING = "shadow-[inset_0_0_0_2px_var(--ring)]";
/** The card a finding and a risk share, in the code's column. */
const SHELL = "relative max-w-3xl rounded-lg border bg-thread-bg";
/** Going to a card keeps the lines it rests on, above it, in view. */
const SCROLL_UNDER_LINES =
  "scroll-mt-[calc(6rem+var(--lines-above)*var(--text-code--line-height))] -outline-offset-2";
/** A card folded to one line. */
const FOLDED = cn(SHELL, "px-3 py-1.5");

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const KIND_BAR: Readonly<Record<"finding" | "risk", string>> = {
  finding: "bg-review-changes",
  risk: "bg-risk-contract-solid",
};

/** The kind's bar inside a card's left edge. */
const KindBar = ({ kind }: { readonly kind: "finding" | "risk" }) => (
  <span
    aria-hidden="true"
    className={cn("absolute top-2 bottom-2 left-1.5 w-[3px] rounded-full", KIND_BAR[kind])}
  />
);

/**
 * A finding: what looks wrong, as a draft comment under the line it rests on, with its severity
 * and suggested change. Add to review saves it as the reviewer's draft on its lines; Edit opens
 * the comment box on it first; Dismiss folds it. Saying nothing means it's fine.
 */
export const FindingCard = memo(function FindingCard({
  point,
  state,
  saving,
  readOnly,
  current,
  onRaise,
  onState,
  leftOut,
  onShow,
  ruleScopes,
  onRule,
  inReview,
  removed,
  language,
  linesAbove = 0,
  family = "Claude",
}: PointActions & {
  readonly point: Point;
  /** Who suggests a guardrail, as the bar names the run's model. */
  readonly family?: string;
  /** The lines of code above the card that it rests on, which going to it keeps in view. */
  readonly linesAbove?: number;
  /** A draft on its lines holds it now, so it folds to a line above the draft. */
  readonly inReview: boolean;
  /** The lines its suggestion replaces, as the diff shows them. */
  readonly removed: readonly string[] | null;
  readonly language: string | null;
}) {
  const id = useId();
  const { card, show } = useShown(leftOut, onShow, point.id);
  const rule = useRule(point, onRule);
  if (state === "dismissed") {
    return (
      <Folded
        point={point}
        state={state}
        current={current}
        note={dismissedNote(rule.saved)}
        className={FOLDED}
        action={
          <Button
            variant="ghost"
            size="xs"
            disabled={readOnly}
            onClick={() => onState(point.id, "open")}
          >
            Undo
          </Button>
        }
      />
    );
  }
  if (state === "raised" && inReview) {
    return (
      <Folded
        point={point}
        state={state}
        current={current}
        note="In your review, below"
        className="max-w-3xl px-1"
        action={<span aria-hidden="true">✓</span>}
      />
    );
  }
  if (leftOut && point.guidance !== undefined) {
    return (
      <LeftOut
        point={point}
        guidance={point.guidance}
        state={state}
        current={current}
        onShow={show}
      />
    );
  }
  const disabled = readOnly || saving;
  return (
    <article
      ref={card}
      id={pointAnchor(point.id)}
      data-slot="point"
      data-kind="finding"
      data-state={state}
      data-current={current || undefined}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      style={cssVars({ "--lines-above": linesAbove })}
      className={cn(
        SHELL,
        SCROLL_UNDER_LINES,
        "flex flex-col gap-2 py-2.5 pr-4 pl-5",
        current && RING,
      )}
    >
      <KindBar kind="finding" />
      <header className="flex flex-wrap items-center gap-2">
        <Kind kind="finding" />
        {point.severity !== null && <SeverityChip severity={point.severity} />}
        <span
          className={cn(CHIP, "border-review-pending/25 bg-review-pending-bg text-review-pending")}
        >
          Draft
        </span>
        {point.lines !== null && (
          <span className="flex items-center gap-1 text-caption text-muted-foreground">
            on{" "}
            <RefChip>{lineRef(point.lines.side, point.lines.startLine, point.lines.line)}</RefChip>
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-caption text-muted-foreground">
          <EyeOffIcon aria-hidden="true" className="size-3.5" />
          Only you see this
        </span>
      </header>
      <h3 id={`${id}-title`} className="font-semibold">
        {point.title}
      </h3>
      {point.explanation !== "" && (
        <ThreadBody blocks={parseBody(point.explanation).blocks} suggestion={() => null} />
      )}
      {point.mismatch !== null && (
        <p className="text-caption text-muted-foreground">
          <span className="font-medium text-foreground">
            {MISMATCH_LABEL[point.mismatch.kind]}:
          </span>{" "}
          {point.mismatch.description}
        </p>
      )}
      {point.guidance !== undefined && <GuidanceLine guidance={point.guidance} />}
      {point.guardrail !== undefined && (
        <GuardrailLine guardrail={point.guardrail} family={family} />
      )}
      {point.suggestion !== null && (
        <SuggestionDiff
          title="Suggested change"
          removed={removed}
          added={point.suggestion}
          language={language}
        />
      )}
      {rule.writing ? (
        <RuleForm
          point={point}
          scopes={ruleScopes}
          onSave={rule.save}
          onCancel={() => {
            rule.setWriting(false);
            card.current?.focus();
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Dismiss
            point={point}
            size="sm"
            disabled={disabled}
            onDismiss={() => onState(point.id, "dismissed")}
            onRule={() => rule.setWriting(true)}
          />
          {point.lines !== null && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                aria-label={`Edit: ${point.title}`}
                onClick={() => onRaise(point, false)}
              >
                <PencilIcon aria-hidden="true" />
                Edit
              </Button>
              <Button
                size="sm"
                disabled={disabled}
                aria-label={`Add to review: ${point.title}`}
                onClick={() => onRaise(point, true)}
              >
                Add to review
              </Button>
            </>
          )}
        </div>
      )}
    </article>
  );
});

/** What a checking test's name opens: its code, in the card a call opens. */
export interface TestPeek {
  readonly handle: CallPeekHandle;
  readonly payload: CallPayload;
}

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * The test that checks a risk, by its name and what it asserts: what was found, never a promise
 * that the risk is safe. Resting on or focusing the name opens the test's code where the reviewer
 * is, as a call opens the code it runs.
 */
const CheckedBy = ({
  checkedBy,
  peek,
  id,
}: {
  readonly checkedBy: NonNullable<Point["checkedBy"]>;
  readonly peek: TestPeek | null;
  readonly id: string;
}) => {
  const name = <span className="font-code text-code-compact">{checkedBy.test}</span>;
  return (
    <p data-slot="checked-by" className="flex items-start gap-1.5 pb-0.5 text-muted-foreground">
      <FlaskConicalIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">
        <span className="font-medium text-foreground">Checked by</span>{" "}
        {peek === null ? (
          name
        ) : (
          <CallTrigger
            handle={peek.handle}
            payload={peek.payload}
            id={id}
            render={<button type="button" className="text-left text-foreground" />}
          >
            {name}
          </CallTrigger>
        )}{" "}
        in {fileName(checkedBy.path)}, which asserts: {checkedBy.checks}
      </span>
    </p>
  );
};

/**
 * A risk: code worth reading closely, as a note under the last of its lines, with what could
 * break outside the PR and the test that checks it, if one does. Comment opens the comment box on
 * it; Dismiss folds it. A checked risk is a step like any other: a test reading doesn't replace
 * the reviewer's.
 */
export const RiskNote = memo(function RiskNote({
  point,
  state,
  saving,
  readOnly,
  current,
  onRaise,
  onState,
  leftOut,
  onShow,
  ruleScopes,
  onRule,
  linesAbove = 0,
  test = null,
  family = "Claude",
}: PointActions & {
  readonly point: Point;
  /** Who suggests a guardrail, as the bar names the run's model. */
  readonly family?: string;
  /** The lines of code above the note that it's about, which going to it keeps in view. */
  readonly linesAbove?: number;
  /** Where the checking test's name opens its code; null shows the name alone. */
  readonly test?: TestPeek | null;
}) {
  const id = useId();
  const { card, show } = useShown(leftOut, onShow, point.id);
  const rule = useRule(point, onRule);
  if (state === "dismissed") {
    return (
      <Folded
        point={point}
        state={state}
        current={current}
        note={dismissedNote(rule.saved)}
        className={FOLDED}
        action={
          <Button
            variant="ghost"
            size="xs"
            disabled={readOnly}
            onClick={() => onState(point.id, "open")}
          >
            Undo
          </Button>
        }
      />
    );
  }
  if (leftOut && point.guidance !== undefined) {
    return (
      <LeftOut
        point={point}
        guidance={point.guidance}
        state={state}
        current={current}
        onShow={show}
      />
    );
  }
  const disabled = readOnly || saving;
  return (
    <article
      ref={card}
      id={pointAnchor(point.id)}
      data-slot="point"
      data-kind="risk"
      data-state={state}
      data-current={current || undefined}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      style={cssVars({ "--lines-above": linesAbove })}
      className={cn(
        SHELL,
        SCROLL_UNDER_LINES,
        "flex flex-col gap-0.5 py-1.5 pr-2 pl-5",
        current && RING,
      )}
    >
      <KindBar kind="risk" />
      <header className="flex flex-wrap items-center gap-2">
        <Kind kind="risk" />
        {point.lines !== null && (
          <RefChip>{lineRef(point.lines.side, point.lines.startLine, point.lines.line)}</RefChip>
        )}
        {state === "raised" && (
          <span className="text-caption text-muted-foreground">
            <span aria-hidden="true">✓ </span>Commented
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled || point.lines === null}
            aria-label={`Comment: ${point.title}`}
            onClick={() => onRaise(point, false)}
          >
            Comment
          </Button>
          <Dismiss
            point={point}
            size="xs"
            disabled={disabled}
            onDismiss={() => onState(point.id, "dismissed")}
            onRule={() => rule.setWriting(true)}
          />
        </span>
      </header>
      <h3 id={`${id}-title`} className="pb-0.5 font-normal">
        {point.title}
      </h3>
      {point.checkedBy !== undefined && (
        <CheckedBy checkedBy={point.checkedBy} peek={test} id={`${pointAnchor(point.id)}-test`} />
      )}
      {point.guidance !== undefined && (
        <GuidanceLine guidance={point.guidance} className="pb-0.5" />
      )}
      {point.guardrail !== undefined && (
        <GuardrailLine guardrail={point.guardrail} family={family} className="pb-0.5" />
      )}
      {rule.writing && (
        <div className="py-1.5 pr-2">
          <RuleForm
            point={point}
            scopes={ruleScopes}
            onSave={rule.save}
            onCancel={() => {
              rule.setWriting(false);
              card.current?.focus();
            }}
          />
        </div>
      )}
    </article>
  );
});

/**
 * A decision's chip at the end of the line that makes the choice: the question it answers, which
 * opens its footnote.
 */
export const DecisionChip = ({
  point,
  state,
  open,
  current,
  onToggle,
}: {
  readonly point: Point;
  readonly state: PointState;
  readonly open: boolean;
  readonly current: boolean;
  readonly onToggle: (id: PointId) => void;
}) => {
  const Icon = POINT_ICON.decision;
  return (
    <button
      type="button"
      id={pointAnchor(point.id)}
      data-slot="decision-chip"
      // As tall as its line of code: WCAG 2.5.8's inline exception, as for the line number.
      data-inline-target
      data-state={state}
      data-current={current || undefined}
      aria-expanded={open}
      aria-label={`Decision: ${point.title}`}
      className={cn(
        // From the line's top with a pixel over it: the middle of a 22px line of code sits above
        // the chip's own, and aligned to it the chip made its line a fraction taller.
        "mt-px ml-3 inline-flex min-h-5 scroll-mt-24 items-center gap-1 rounded-full border bg-background px-2 align-top font-sans text-caption text-muted-foreground hover:text-foreground",
        state === "dismissed" && "line-through",
        current && RING,
      )}
      onClick={() => onToggle(point.id)}
    >
      <Icon aria-hidden="true" className="size-3" />
      {point.title}
    </button>
  );
};

/** A decision's footnote under its line: the answer, muted, with a way to comment or hide it. */
export const DecisionNote = ({
  point,
  state,
  saving,
  readOnly,
  onRaise,
  onState,
}: Omit<PointActions, "current"> & { readonly point: Point }) => {
  const disabled = readOnly || saving;
  return (
    <article
      data-slot="decision-note"
      data-state={state}
      aria-label={point.title}
      className={cn(
        "flex max-w-3xl flex-wrap items-baseline gap-x-2 border-l pl-3 text-caption",
        MOTION,
      )}
    >
      <p className="min-w-0 flex-1 basis-80 text-muted-foreground">
        <span className="font-medium text-foreground">{point.title}.</span> {point.explanation}
      </p>
      <span className="flex items-center gap-1">
        {state === "dismissed" ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={readOnly}
            onClick={() => onState(point.id, "open")}
          >
            Show again
          </Button>
        ) : (
          <>
            {state === "raised" && (
              <span className="text-muted-foreground">
                <span aria-hidden="true">✓ </span>Commented
              </span>
            )}
            <Button
              variant="ghost"
              size="xs"
              disabled={disabled || point.lines === null}
              aria-label={`Comment: ${point.title}`}
              onClick={() => onRaise(point, false)}
            >
              Comment
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={disabled}
              aria-label={`Hide: ${point.title}`}
              onClick={() => onState(point.id, "dismissed")}
            >
              Hide
            </Button>
          </>
        )}
      </span>
    </article>
  );
};

/** On another hunk a point rests on: one line back to it. */
export const PointMention = ({
  point,
  onGo,
}: {
  readonly point: Point;
  readonly onGo: (id: PointId) => void;
}) => {
  const Icon = POINT_ICON[point.kind];
  return (
    <p data-slot="point-mention" className="flex items-center gap-1.5 text-muted-foreground">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {POINT_STATUS[point.kind].label}:{" "}
      <button
        type="button"
        className="min-h-6 rounded-sm text-left whitespace-pre-line text-primary underline-offset-2 hover:underline"
        onClick={() => onGo(point.id)}
      >
        {point.title}
      </button>
    </p>
  );
};

/**
 * Where point cards unfold when they land: in height from nothing, under the lines they rest on
 * (globals.css). `fresh` cards take no room while the page finds which are in view; `at` is an
 * in-view card's place in the code's order, and only those unfold.
 */
export const PointFold = ({
  pointId,
  fresh,
  at,
  row = false,
  className,
  bodyClassName,
  children,
}: {
  /** The first point in the fold, which the page measures it by. */
  readonly pointId: PointId;
  readonly fresh: boolean;
  readonly at: number | undefined;
  /** A row of a part's lines, under the line it follows. */
  readonly row?: boolean;
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly children: ReactNode;
}) => (
  <div
    role={row ? "row" : undefined}
    data-slot="point-fold"
    data-point-id={pointId}
    data-fresh={fresh || undefined}
    data-unfold={at === undefined ? undefined : true}
    style={at === undefined ? undefined : cssVars({ "--landing-i": at })}
    className={className}
  >
    <div role={row ? "cell" : undefined}>
      <div className={bodyClassName}>{children}</div>
    </div>
  </div>
);
