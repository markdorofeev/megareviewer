import { Component, type ReactNode } from "react";
import { Button } from "../ui/button.tsx";

/** A bug in a page shows what broke instead of a blank window. */
export class ErrorBoundary extends Component<
  { readonly children: ReactNode; readonly onReload?: () => void },
  { readonly error: Error | null }
> {
  override state: { readonly error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const reload = this.props.onReload ?? (() => window.location.reload());
    return (
      <main className="mx-auto flex max-w-2xl flex-col items-start gap-3 px-4 py-12" role="alert">
        <h1 className="text-title font-semibold tracking-[-0.01em]">Something went wrong</h1>
        <p className="text-body">megareviewer hit a bug while showing this page.</p>
        <pre className="w-full overflow-x-auto rounded-md border bg-muted p-3 font-mono text-code-compact whitespace-pre-wrap">
          {String(error)}
        </pre>
        <Button onClick={reload}>Reload</Button>
      </main>
    );
  }
}
