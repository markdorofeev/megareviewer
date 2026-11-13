import { useMemo, useState } from "react";
import {
  type Api,
  ApiContext,
  createApiClient,
  type EventStream,
  subscribeToAnalysis,
  useStatus,
} from "../api/index.ts";
import { PageDisplayProvider } from "../lib/page-display.tsx";
import { PickerPage } from "../pages/picker/index.ts";
import { ReviewPage } from "../pages/review/index.ts";
import { Toaster } from "../ui/sonner.tsx";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { Header } from "./Header.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { matchRoute, usePathname } from "./router.ts";
import { TokenScreen } from "./TokenScreen.tsx";
import type { SessionToken } from "./token.ts";

export interface AppProps {
  readonly token: SessionToken;
  readonly fetch: typeof fetch;
  readonly openEventStream?: (url: string) => EventStream;
}

export const App = ({ token, fetch, openEventStream }: AppProps) => {
  const [ended, setEnded] = useState(false);
  const value = token.value;
  const api = useMemo((): Api | null => {
    if (value === null) return null;
    const client = createApiClient({
      fetch,
      token: value,
      onUnauthorized: () => {
        token.clear();
        setEnded(true);
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
      <Shell />
    </ApiContext.Provider>
  );
};

const Shell = () => {
  const route = matchRoute(usePathname());
  const status = useStatus();
  return (
    <TooltipProvider>
      <PageDisplayProvider>
        <Header status={status.status} error={status.error} />
        <main className="px-4 py-5 sm:px-6">
          {route.page === "picker" ? (
            <PickerPage status={status.status} />
          ) : route.page === "review" ? (
            <ReviewPage analysisId={route.analysisId} />
          ) : (
            <NotFoundPage />
          )}
        </main>
        <Toaster />
      </PageDisplayProvider>
    </TooltipProvider>
  );
};
