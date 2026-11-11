import type { StatusResponse } from "../../../../contracts/index.ts";
import { cn } from "../../lib/utils.ts";
import { type SetupItem, setupItems } from "./setup.ts";

// Spelled out because Tailwind only generates the classes it finds whole in the source.
const STATE: Readonly<
  Record<SetupItem["state"], { readonly glyph: string; readonly text: string }>
> = {
  ok: { glyph: "✓", text: "text-review-approved" },
  missing: { glyph: "✕", text: "text-review-changes" },
  error: { glyph: "✕", text: "text-review-changes" },
  optional: { glyph: "○", text: "text-muted-foreground" },
};

export const SetupStatus = ({ status }: { readonly status: StatusResponse }) => (
  <section aria-label="Setup" className="rounded-lg border bg-card px-3 py-2">
    <dl className="flex flex-wrap gap-x-6 gap-y-1">
      {setupItems(status).map((item) => (
        <div key={item.name} data-state={item.state} className="flex items-baseline gap-1.5">
          <dt className="flex items-center gap-1.5 font-medium">
            <span aria-hidden="true" className={STATE[item.state].text}>
              {STATE[item.state].glyph}
            </span>
            {item.name}
          </dt>
          <dd
            className={cn(item.state === "ok" ? "text-muted-foreground" : STATE[item.state].text)}
          >
            {item.text}
          </dd>
        </div>
      ))}
    </dl>
  </section>
);
