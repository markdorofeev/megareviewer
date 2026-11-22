import { CheckIcon, ShieldCheckIcon, ShieldQuestionIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  GUARDRAIL_KIND_NAMES,
  GUARDRAIL_TOOL_NAMES,
  type Guardrail,
  type GuardrailKind,
} from "../../../../src/domain/review/index.ts";
import { cn } from "../../lib/utils.ts";
import { Button } from "../../ui/button.tsx";

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className="font-mono text-code-compact text-foreground">{children}</code>
);

/** "an architecture rule", "a lint rule". */
export const kindPhrase = (kind: GuardrailKind): string => {
  const name = GUARDRAIL_KIND_NAMES[kind];
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
};

/** The sentence a comment gains from Add to comment, in Markdown. */
export const guardrailSentence = (guardrail: Guardrail): string => {
  switch (guardrail.is) {
    case "rule":
      return `A check could catch this next time: \`${guardrail.rule}\` in ${GUARDRAIL_TOOL_NAMES[guardrail.tool]}.`;
    case "suggested":
      return `A check could catch this next time: ${kindPhrase(guardrail.kind)} in ${guardrail.engine}. ${guardrail.does}`;
  }
};

const LINE = "flex items-start gap-1.5 text-caption text-muted-foreground";

/**
 * A check that could catch a finding's or a risk's kind: a rule megareviewer verified against the
 * repository's config, or the model's suggestion, said as such. Model output, so text.
 */
export const GuardrailLine = ({
  guardrail,
  family,
  className,
  children,
}: {
  readonly guardrail: Guardrail;
  /** Who suggested it, "Claude", as the bar names the run's model. */
  readonly family: string;
  readonly className?: string;
  /** After the sentence, e.g. Add to comment. */
  readonly children?: ReactNode;
}) => {
  switch (guardrail.is) {
    case "rule":
      return (
        <p data-slot="guardrail" data-guardrail="rule" className={cn(LINE, className)}>
          <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">
            <span className="font-medium text-foreground">A check could catch this:</span>{" "}
            <Code>{guardrail.rule}</Code> in {GUARDRAIL_TOOL_NAMES[guardrail.tool]}, which{" "}
            <Code>{guardrail.configPath}</Code> doesn't turn on.
            {children}
          </span>
        </p>
      );
    case "suggested":
      return (
        <p data-slot="guardrail" data-guardrail="suggested" className={cn(LINE, className)}>
          <ShieldQuestionIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">
            <span className="font-medium text-foreground">This looks checkable:</span>{" "}
            {kindPhrase(guardrail.kind)} in {guardrail.engine}. {guardrail.does}{" "}
            <span className="italic">Suggested by {family}, not checked.</span>
            {children}
          </span>
        </p>
      );
  }
};

/**
 * Under a saved draft made from a point with a guardrail: the point's line, with Add to comment,
 * which appends the check's sentence to the draft, once.
 */
export const DraftGuardrail = ({
  guardrail,
  family,
  body,
  onEdit,
}: {
  readonly guardrail: Guardrail;
  readonly family: string;
  /** The draft's text. */
  readonly body: string;
  /** Replaces the draft's text. */
  readonly onEdit: (body: string) => void;
}) => {
  const sentence = guardrailSentence(guardrail);
  return (
    <div data-slot="draft-guardrail" className="border-t pt-2">
      <GuardrailLine guardrail={guardrail} family={family}>
        {body.includes(sentence) ? (
          <span className="ml-1 inline-flex items-center gap-1 text-foreground">
            <CheckIcon aria-hidden="true" className="size-3.5" />
            Added to the comment
          </span>
        ) : (
          <>
            {" "}
            <Button
              variant="outline"
              size="sm"
              className="ml-1"
              onClick={() => onEdit(`${body.trimEnd()}\n\n${sentence}`)}
            >
              Add to comment
            </Button>
          </>
        )}
      </GuardrailLine>
    </div>
  );
};
