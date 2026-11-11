import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { StatusResponse } from "../../../../contracts/index.ts";
import { errorMessage, useApi, useMutation, usePullRequests } from "../../api/index.ts";
import { navigate, reviewPath } from "../../app/router.ts";
import { cn } from "../../lib/utils.ts";
import { DANGER } from "../../review/index.ts";
import { Button } from "../../ui/button.tsx";
import { HOST_NAMES, PullRequestList } from "./PullRequestList.tsx";
import { SetupStatus } from "./SetupStatus.tsx";
import { UrlForm } from "./UrlForm.tsx";

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const BANNER = cn(DANGER, "lg:col-span-2");

/** Where an analysis was started from: the URL form, or a row, by its PR's URL. */
type StartSource = { readonly from: "form" } | { readonly from: "row"; readonly url: string };

export const PickerPage = ({
  status,
  now = Date.now,
}: {
  readonly status: StatusResponse | null;
  readonly now?: () => number;
}) => {
  const { client } = useApi();
  const { pullRequests, error, loading, refresh } = usePullRequests();
  const start = useMutation(client.startAnalysis);
  const [source, setSource] = useState<StartSource | null>(null);
  const urlField = useRef<HTMLInputElement>(null);
  const lists = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusUrlField = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextField(event.target)) return;
      event.preventDefault();
      urlField.current?.focus();
    };
    document.addEventListener("keydown", focusUrlField);
    return () => document.removeEventListener("keydown", focusUrlField);
  }, []);

  const open = async (url: string, from: StartSource) => {
    if (start.pending) return;
    setSource(from);
    const result = await start.run({ url });
    if (result.ok) navigate(reviewPath(result.value.analysisId));
  };

  const moveFocus = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...(lists.current?.querySelectorAll<HTMLElement>("[data-pr-row]") ?? [])];
    const index = event.target instanceof HTMLElement ? rows.indexOf(event.target) : -1;
    if (index === -1) return;
    event.preventDefault();
    rows[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  };

  const items = pullRequests?.items ?? null;
  const startingUrl = start.pending && source?.from === "row" ? source.url : null;
  const nowMs = now();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <section aria-labelledby="analyze-heading" className="flex flex-col gap-3">
        <h1 id="analyze-heading" className="text-title font-semibold tracking-[-0.01em]">
          Review a pull request
        </h1>
        <UrlForm
          inputRef={urlField}
          pending={start.pending && source?.from === "form"}
          error={source?.from === "form" ? start.error : null}
          onSubmit={(url) => void open(url, { from: "form" })}
        />
      </section>

      {status !== null && <SetupStatus status={status} />}

      {/* Arrow keys move between rows; the handler only reacts to keys from row buttons. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the rows inside are buttons. */}
      <div className="grid gap-6 lg:grid-cols-2" ref={lists} onKeyDown={moveFocus}>
        {error !== null && (
          <p className={BANNER} role="alert">
            Couldn't list pull requests. {errorMessage(error)}
          </p>
        )}
        {pullRequests?.errors.map((failure) => (
          <p key={failure.host} className={BANNER} role="alert">
            Couldn't list {HOST_NAMES[failure.host]} pull requests: {failure.message}
          </p>
        ))}
        {source?.from === "row" && start.error !== null && (
          <p className={BANNER} role="alert">
            Couldn't start the analysis. {errorMessage(start.error)}
          </p>
        )}
        <PullRequestList
          title="Waiting for your review"
          empty="Nothing is waiting for your review."
          action={
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          }
          items={items?.filter((item) => item.role === "reviewer") ?? null}
          nowMs={nowMs}
          startingUrl={startingUrl}
          onOpen={(url) => void open(url, { from: "row", url })}
        />
        <PullRequestList
          title="Your pull requests"
          empty="You have no open pull requests."
          items={items?.filter((item) => item.role === "author") ?? null}
          nowMs={nowMs}
          startingUrl={startingUrl}
          onOpen={(url) => void open(url, { from: "row", url })}
        />
      </div>
    </div>
  );
};
