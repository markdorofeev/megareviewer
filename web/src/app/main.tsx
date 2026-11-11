import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "../styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { bootstrapSessionToken } from "./token.ts";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App token={bootstrapSessionToken(window)} fetch={window.fetch.bind(window)} />
    </ErrorBoundary>
  </StrictMode>,
);
