import type { CaseLabels } from "../../labels.ts";

// Ky is a library, so its users are the callers outside the PR. The README and doc comments
// describe behavior and can't break it: they're logic.
export const labels: CaseLabels = {
  risk: {
    h_b8a04576dedaf4b3: "logic", // README: retry timing headers
    h_5d35f3e27123c4d3: "logic", // README: jitter and retryOnTimeout
    h_e001aeb830147ebd: "logic", // README: example status code
    h_dccdcfd9ae73f09c: "logic", // README: timeout
    h_8814a26c2c990f89: "logic", // README: HTTPError data
    h_70917d3a16034965: "logic", // README: data property
    h_5747e2c545e1e3c5: "logic", // import of retry-timing
    h_743fb10d0d78a7ed: "logic", // private ErrorDataTimeout type
    h_fabe6cea38e044a1: "logic", // beforeError handling moved into #throwProcessedError
    // json(), text() and the other shortcuts now race totalTimeout and can throw TimeoutError.
    h_193ead7430db59ff: "contract",
    h_ff37c00f0766e386: "logic", // readonly #input
    h_c7677fa833235aeb: "logic", // comments around shouldRetry
    h_8f79287251c0d953: "contract", // how retry delays follow server headers (Ky.ts)
    // Reading an error body past totalTimeout now throws TimeoutError instead of an HTTPError,
    // a change callers catching HTTPError would see; it reads as a refactor around it.
    h_c3ce4ac3781b08ad: "either",
    h_4e6dcb154464c3df: "either", // the same for parsing an error body
    // The private helpers that time body reads; the shortcut methods' hunk carries the change.
    h_e5b8f0108cd99bd7: "either",
    h_dd4ac0e00d4c0f89: "contract", // new retry-timing.ts: parsing of server headers
    h_b4df6291c1398fb7: "logic", // HTTPError doc comment
    h_6e0d7432a99849bc: "logic", // beforeError doc comment
    h_77e90bf7a82bd97d: "logic", // options doc comment: retry timing headers
    h_8de16dc9fea68fdf: "logic", // options doc comment: example status code
    h_1658f811e48da7dd: "logic", // options doc comment: timeout
    // Was contract. A doc comment can't break a caller, but it states a new requirement of the
    // public option (afterStatusCodes must also be in statusCodes), which Ky.ts decides.
    h_73f7b1dee1846492: "either",
    h_4196845f61768ab6: "logic", // retry doc comment: jitter
    h_90db801889117b95: "logic", // retry doc comment: retryOnTimeout
    h_dcdac188b08b35ea: "logic", // timeout tests
    h_e28283d7711e3382: "logic", // test imports
    h_86315211aaa19d46: "logic", // tests
    h_2be7f8b0d1fd2f45: "logic", // Retry-After tests
    h_94cf7c9b9ad88471: "logic", // tests
    h_3653a8c7bda36c85: "logic", // tests
    h_a7f8e98f6e99d0a8: "logic", // tests
    h_abbcdf53f30602f0: "logic", // tests
    h_d024dccb40f54b54: "logic", // tests
    h_a53fb32766ab6125: "logic", // tests
    h_7b2be88c98c158e6: "logic", // tests
    h_f55f5dc1102b70a1: "logic", // tests
    h_34d22c4a5f5026e9: "logic", // tests
    h_bbe91323d73f9daf: "logic", // tests
    h_74136ad7ed2cb07b: "logic", // tests
    h_aa794a7ce447c347: "logic", // tests
    h_75676ec6dd1879a2: "logic", // tests
    h_4627718e997cd6cd: "logic", // tests
    h_c6ff6f295d1f9f9c: "logic", // tests
    h_5ca7ef74a624d99d: "logic", // tests
    h_713d2c1b1f244111: "logic", // tests
    h_529b2c5c270f68b1: "logic", // tests
    h_c14e6c362b6b0c87: "logic", // tests
    h_f929637ff84d2010: "logic", // tests
    h_4188792f6be7be4b: "logic", // tests
    h_ee387eedbd2218ab: "logic", // tests
    h_3a26c57d706a8632: "logic", // tests
  },
  riskAt: {
    h_193ead7430db59ff: [
      { hunkId: "h_193ead7430db59ff", side: "new", lines: [297, 297] },
      { hunkId: "h_193ead7430db59ff", side: "new", lines: [300, 302] },
    ],
    h_8f79287251c0d953: [{ hunkId: "h_8f79287251c0d953", side: "new", lines: [532, 537] }],
    h_dd4ac0e00d4c0f89: [
      { hunkId: "h_dd4ac0e00d4c0f89", side: "new", lines: [25, 49] },
      { hunkId: "h_dd4ac0e00d4c0f89", side: "new", lines: [151, 173] },
    ],
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
