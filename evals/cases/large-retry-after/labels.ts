import type { CaseLabels } from "../../labels.ts";

// Only hunks whose class is clear are labeled; the README and doc-comment hunks could go either
// way and are left out.
export const labels: CaseLabels = {
  risk: {
    h_8f79287251c0d953: "contract", // how retry delays follow server headers (Ky.ts)
    h_dd4ac0e00d4c0f89: "contract", // new retry-timing.ts: parsing of server headers
    h_73f7b1dee1846492: "contract", // RetryOptions docs: afterStatusCodes must be in statusCodes
    h_ff37c00f0766e386: "logic", // readonly #input
    h_c7677fa833235aeb: "logic", // comments around shouldRetry
    h_e28283d7711e3382: "logic", // test imports
    h_dcdac188b08b35ea: "logic", // timeout tests
    h_2be7f8b0d1fd2f45: "logic", // Retry-After tests
  },
  findings: [],
  decisions: [
    {
      description:
        "Why a numeric Retry-After is now always read as a delay in seconds, while only reset-style headers (RateLimit-Reset, X-RateLimit-Reset) may be epoch timestamps",
      mustHave: true,
    },
    {
      description:
        "Why reading a response body (json(), text() and the other shortcuts) now counts against totalTimeout and can throw a TimeoutError, which is not retried",
      mustHave: true,
    },
    {
      description:
        "Why a malformed retry timing header falls back to the normal retry delay, no longer capped by maxRetryAfter",
      mustHave: false,
    },
    {
      description:
        "Why Retry-After wins when present, with rate-limit headers consulted only when it's missing",
      mustHave: false,
    },
    {
      description:
        "Why only the three HTTP-date formats are parsed, any other date-like value falling back to the normal retry delay",
      mustHave: false,
    },
  ],
  mismatches: [
    {
      kind: "unrequested",
      description:
        "Beyond Retry-After handling, response body reads are now subject to totalTimeout",
    },
  ],
};
