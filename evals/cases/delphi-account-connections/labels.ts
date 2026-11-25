import type { CaseLabels } from "../../labels.ts";

export const labels: CaseLabels = {
  findings: [
    {
      description:
        "A saved GitHub token is tried before gh and git credentials and never checked, so once it's revoked the working credentials behind it are never used",
      at: [{ hunkId: "h_41ad920c36c36c34", side: "new", lines: [346, 346] }],
      mustHave: true,
    },
    {
      description:
        "With BITBUCKET_APP_PASSWORD set but no BITBUCKET_USERNAME or BITBUCKET_EMAIL, listing uses the saved token while clone_credentials returns nothing, so repositories it lists fail to clone",
      at: [
        { hunkId: "h_458525b7a4806fe2", side: "new", lines: [265, 267] },
        { hunkId: "h_24393343afea5f06", side: "new", lines: [279, 280] },
      ],
      mustHave: true,
    },
    {
      description:
        "The tests read the real keychain, though the PR says they don't: Bitbucket clones in test_sources.py run without BITBUCKET_APP_PASSWORD, so clone_credentials looks up the saved token with the real security or secret-tool",
      at: [
        { hunkId: "h_458525b7a4806fe2", side: "new", lines: [266, 267] },
        { hunkId: "h_d30f8b98357e61ae", side: "new", lines: [260, 260] },
      ],
      mustHave: true,
    },
    {
      description:
        "A saved Bitbucket token that's rejected after it was saved gets the environment-variable hint (set BITBUCKET_EMAIL), not a hint to use another token",
      at: [{ hunkId: "h_c07602170366e828", side: "new", lines: [190, 192] }],
      mustHave: false,
    },
    {
      description:
        "Saving a token while GITHUB_TOKEN or GH_TOKEN is set reads as a successful connect, though the environment token shadows it and the new token is unused",
      at: [{ hunkId: "h_79397fb1b9683b02", side: "new", lines: [53, 54] }],
      mustHave: false,
    },
    {
      description:
        "A keychain command that fails or times out reads as no saved token, so saving reports the keychain didn't keep it and lookups fall through to other credentials",
      at: [{ hunkId: "h_66f414f852d4bd40", side: "new", lines: [22, 23] }],
      mustHave: false,
    },
    {
      description:
        "Forgetting a token fails silently when the keychain refuses the delete: forget_secret ignores the result, so the request succeeds and the token stays saved with no reason given",
      at: [{ hunkId: "h_66f414f852d4bd40", side: "new", lines: [44, 48] }],
      mustHave: false,
    },
  ],
  mismatches: [],
};
