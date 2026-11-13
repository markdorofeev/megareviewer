import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  risk: {
    h_0384e19c85c385b3: "contract", // date-fns 2.30.0 → 4.1.0
    h_62de5a549f8dae78: "contract", // exported formatPrice gains a required currency
    h_2f6c23234800af18: "logic", // caller passes the order's currency
  },
  findings: [],
  decisions: [
    {
      description: "Why upgrade date-fns across two major versions, from 2.30.0 to 4.1.0",
      mustHave: true,
    },
    {
      description:
        "Why the exported formatPrice now requires a currency, breaking callers of this package: prices are formatted in the order's own currency (SHOP-210)",
      mustHave: true,
    },
    {
      description:
        "Why format prices with Intl.NumberFormat and an en-US default locale, which changes the output format (e.g. negative amounts, separators)",
      mustHave: false,
    },
    {
      description: "Why parseISO goes: date-fns 4 accepts ISO strings directly",
      mustHave: false,
    },
  ],
  mismatches: [],
};
