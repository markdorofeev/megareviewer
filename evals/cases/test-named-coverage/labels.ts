import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "Lets the support role download the customer export too, though SHOP-310 says only admins may: it holds personal data",
      at: [{ hunkId: "h_32b4390529725014", side: "new", lines: [20, 20] }],
      mismatch: 0,
      mustHave: true,
    },
    {
      description:
        "The test named for rejecting non-admin users sends only an admin's request, so nothing checks that anyone is rejected",
      at: [{ hunkId: "h_919a7c7975684236", side: "new", lines: [6, 10] }],
      mustHave: false,
    },
  ],
  mismatches: [
    {
      kind: "contradicts",
      description:
        "The export is open to the support role as well as admins, though only admins may download it",
    },
  ],
};
