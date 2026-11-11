import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "../styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesignSystemPage } from "./DesignSystemPage.tsx";

// A page of its own, served by `pnpm dev:web` at /design-system.html and left out of builds, so
// Tailwind's preflight and the Indigo Calm base styles don't reach the review page until it moves
// over to them.

const root = document.getElementById("root");
if (root === null) throw new Error("design-system.html has no #root");

createRoot(root).render(
  <StrictMode>
    <DesignSystemPage />
  </StrictMode>,
);
