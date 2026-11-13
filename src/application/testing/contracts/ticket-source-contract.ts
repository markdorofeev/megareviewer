import { describe, expect, it } from "vitest";
import { Ticket } from "../../../domain/review/index.ts";
import type { TicketSource } from "../../ports/index.ts";

/** Each part is optional because some implementations are only ever one of the two. */
export interface TicketSourceContractSetup {
  configured?: {
    source(scenario: "ok" | "unauthorized"): TicketSource;
    existingKeys: readonly string[];
    missingKeys: readonly string[];
  };
  unconfigured?: () => TicketSource;
}

export const describeTicketSourceContract = (
  name: string,
  setup: TicketSourceContractSetup,
): void => {
  describe(`TicketSource contract: ${name}`, () => {
    const { configured, unconfigured } = setup;

    if (configured !== undefined) {
      it("says it is configured", () => {
        expect(configured.source("ok").configured).toBe(true);
      });

      it("returns found tickets in domain shape and the missing keys", async () => {
        const keys = [...configured.existingKeys, ...configured.missingKeys];
        const result = await configured.source("ok").getTickets(keys);
        if (!result.ok) throw new Error(`getTickets failed: ${result.error.message}`);

        for (const ticket of result.value.found) {
          expect(Ticket.parse(ticket)).toEqual(ticket);
        }
        expect(result.value.found.map((ticket) => ticket.key).sort()).toEqual(
          [...configured.existingKeys].sort(),
        );
        expect([...result.value.missing].sort()).toEqual([...configured.missingKeys].sort());
      });

      it("returns nothing for no keys", async () => {
        expect(await configured.source("ok").getTickets([])).toEqual({
          ok: true,
          value: { found: [], missing: [] },
        });
      });

      it("returns unauthorized when the credentials are rejected", async () => {
        const result = await configured.source("unauthorized").getTickets(configured.existingKeys);
        expect(!result.ok && result.error.kind).toBe("unauthorized");
      });
    }

    if (unconfigured !== undefined) {
      it("says it isn't configured and returns not-configured", async () => {
        const source = unconfigured();
        const result = await source.getTickets(["SHOP-1"]);

        expect(source.configured).toBe(false);
        expect(!result.ok && result.error.kind).toBe("not-configured");
      });
    }
  });
};
