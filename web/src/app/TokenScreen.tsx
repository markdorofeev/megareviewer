/** Shown instead of the app when there's no usable session token. Calls no API. */
export const TokenScreen = ({ reason }: { readonly reason: "missing" | "ended" }) => (
  <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-12">
    <h1 className="text-title font-semibold tracking-[-0.01em]">
      Open megareviewer from your terminal
    </h1>
    {reason === "missing" ? (
      <p className="text-body">
        This page needs the link megareviewer printed when it started. It looks like{" "}
        <code className="rounded-sm bg-muted px-1 font-mono text-code-compact">
          http://127.0.0.1:4823/?token=…
        </code>
        . Copy it from your terminal and open it.
      </p>
    ) : (
      <p className="text-body">
        This page's session has ended, usually because megareviewer was restarted. Open the new link
        printed in your terminal.
      </p>
    )}
    <p className="text-muted-foreground">
      Not running? Start it with{" "}
      <code className="rounded-sm bg-muted px-1 font-mono text-code-compact">npx megareviewer</code>
      .
    </p>
  </main>
);
