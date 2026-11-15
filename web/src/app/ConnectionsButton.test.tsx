import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { StatusResponse } from "../../../contracts/index.ts";
import { fixtureStatus } from "../../dev/fixtures/index.ts";
import { testApi } from "../testing/api.tsx";
import { fakeFetch, jsonResponse } from "../testing/fetch.ts";
import { ConnectionsButton } from "./ConnectionsButton.tsx";
import { ConnectionsProvider } from "./connections-context.tsx";

const NOW = Date.parse("2026-10-21T10:00:00Z");

const renderButton = (answer: () => Response | Promise<Response>) => {
  const { fetch, requests } = fakeFetch(answer);
  const { wrapper: Api } = testApi({ fetch });
  render(
    <Api>
      <ConnectionsProvider now={() => NOW}>
        <ConnectionsButton now={() => NOW} />
      </ConnectionsProvider>
    </Api>,
  );
  return { requests };
};

const withStatus = (status: StatusResponse) => () => jsonResponse(200, status);
const button = () => screen.getByRole("button", { name: /^Connections:/ });
/** The first read is in and every connection's fine. */
const settled = () => waitFor(() => expect(button().dataset.tone).toBe("ok"));

describe("ConnectionsButton", () => {
  it("checks, then says what's connected", async () => {
    renderButton(withStatus(fixtureStatus));
    expect(button().textContent).toBe("Checking…");
    expect(button().dataset.tone).toBe("checking");
    await settled();
    // Who the reviewer is, with nothing about the connections while they're fine.
    expect(button().textContent).toBe("LPLee Park");
    expect(button().getAttribute("aria-label")).toBe(
      "Connections: 3 working · 3 optional. Open for details. Signed in as Lee Park on GitHub.",
    );
  });

  it("says only Not connected on Request AI review's tools, which are all optional", async () => {
    renderButton(withStatus(fixtureStatus));
    await settled();
    await userEvent.click(button());
    const rows = within(await screen.findByRole("list")).getAllByRole("listitem");
    const label = (name: string) =>
      rows.find((row) => row.textContent?.startsWith(name))?.textContent ?? "";
    expect(label("Codex")).toMatch(/^CodexNot connectedAdds/);
    expect(label("opencode")).toMatch(/^opencodeNot connectedAdds/);
    expect(label("Bitbucket")).toMatch(/^BitbucketNot connected · Optional/);
  });

  it("is red with a failing host, and lists it first", async () => {
    const failing = { configured: true, user: null, error: "Bad credentials" };
    renderButton(
      withStatus({ ...fixtureStatus, hosts: { ...fixtureStatus.hosts, github: failing } }),
    );
    await screen.findByText("1 issue");
    expect(button().dataset.tone).toBe("danger");
    // GitHub failed, so no one is known: the button says only what's wrong.
    expect(button().textContent).toBe("1 issue");
    await userEvent.click(button());
    const rows = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.dataset.state)).toEqual([
      "failing",
      "optional",
      "working",
      "optional",
      "optional",
      "working",
    ]);
    expect(rows[0]?.textContent).toMatch(/^GitHubFailingBad credentials/);
  });

  it("is disconnected when the server doesn't answer", async () => {
    renderButton(() => Promise.reject(new TypeError("Failed to fetch")));
    await screen.findByText("Disconnected");
    await userEvent.click(button());
    expect(await screen.findByText("megareviewer's server isn't answering")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("opens with the keyboard, closes on Esc back to the button, and checks again", async () => {
    const { requests } = renderButton(withStatus(fixtureStatus));
    await settled();
    button().focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("megareviewer 0.0.0-mock")).toBeTruthy();
    expect(screen.getByText("3 working · 3 optional · checked just now")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(requests.filter((request) => request.url === "/api/status")).toHaveLength(2),
    );
    await settled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("megareviewer 0.0.0-mock")).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("says who the reviewer is on each host at the top of the popover", async () => {
    renderButton(withStatus(fixtureStatus));
    await settled();
    await userEvent.click(button());
    const signedIn = await screen.findByText(/^Signed in as/);
    expect(signedIn.textContent).toBe("Signed in as Lee Park on GitHub");
  });

  it("announces a change of its label after the first read", async () => {
    renderButton(withStatus(fixtureStatus));
    await settled();
    const live = document.querySelector("[aria-live=polite]");
    expect(live?.textContent).toBe("");
  });
});
