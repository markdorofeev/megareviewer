import { useMemo, useState } from "react";
import {
  type Api,
  ApiContext,
  createApiClient,
  type EventStream,
  subscribeToAnalysis,
} from "../api/index.ts";
import { PageDisplayProvider } from "../lib/page-display.tsx";
import { cn } from "../lib/utils.ts";
import { OpenPullRequestPage, PickerPage } from "../pages/picker/index.ts";
import { ReviewPage } from "../pages/review/index.ts";
import { Toaster } from "../ui/sonner.tsx";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { ConnectionsProvider } from "./connections-context.tsx";
import { Header } from "./Header.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { matchRoute, pullRequestPath, usePathname } from "./router.ts";
import { TokenScreen } from "./TokenScreen.tsx";
import type { SessionToken } from "./token.ts";

export interface AppProps {
  readonly token: SessionToken;
  readonly fetch: typeof fetch;
  readonly openEventStream?: (url: string) => EventStream;
}

export const App = ({ token, fetch, openEventStream }: AppProps) => {
  const [ended, setEnded] = useState(false);
  const [value, setValue] = useState(token.value);
  const api = useMemo((): Api | null => {
    if (value === null) return null;
    const client = createApiClient({
      fetch,
      token: value,
      onUnauthorized: () => {
        const replacement = token.reject(value);
        if (replacement === null) setEnded(true);
        else setValue(replacement);
      },
    });
    return {
      client,
      subscribe: (id, onEvent) => subscribeToAnalysis(id, value, onEvent, openEventStream),
    };
  }, [fetch, openEventStream, token, value]);

  if (ended) return <TokenScreen reason="ended" />;
  if (api === null) return <TokenScreen reason="missing" />;
  return (
    <ApiContext.Provider value={api}>
      {/* A new token starts every page over, so nothing keeps what the old one failed to read. */}
      <Shell key={value} />
    </ApiContext.Provider>
  );
};

const Shell = () => {
  const route = matchRoute(usePathname());
  return (
    <TooltipProvider>
      <PageDisplayProvider>
        <ConnectionsProvider>
          <Header />
          <main
            className={cn(
              "px-4 py-5 sm:px-6",
              route.page === "picker" && "min-h-[calc(100dvh-3rem)] bg-surface-subtle",
            )}
          >
            {route.page === "picker" ? (
              <PickerPage />
            ) : route.page === "review" ? (
              <ReviewPage analysisId={route.analysisId} />
            ) : route.page === "open" ? (
              <OpenPullRequestPage key={pullRequestPath(route.ref)} pullRequest={route.ref} />
            ) : (
              <NotFoundPage />
            )}
          </main>
          <Toaster />
        </ConnectionsProvider>
      </PageDisplayProvider>
    </TooltipProvider>
  );
};
