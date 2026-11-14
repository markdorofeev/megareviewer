import type { CaseLabels } from "../../labels.ts";

// Contract only where a mistake would break or expose something outside the PR: the new
// endpoints, and the code that stores, removes and hands out the user's tokens. The API models,
// the generated schema and client, the router's registration, the page, and the plumbing
// between the PR's own modules follow from those, and are logic.
export const labels: CaseLabels = {
  risk: {
    h_3ad7767d9acf9f2c: "logic", // CONTRIBUTING.md
    h_11a52503379df40c: "logic", // import
    // AccountConnection.to_json(), the response shape: an HTTP API, though only the PR's own
    // page reads it today.
    h_054a8a2424d85147: "either",
    h_9e6b079e792b0b0c: "logic", // the router's registration
    h_4c462bf7b6f235b0: "logic", // request model of the new endpoint
    h_b901599b73a4fdd7: "logic", // response models of the new endpoints
    h_f0f06a5f0031f84f: "contract", // PUT accepts and persists a credential, DELETE removes it
    h_de6f987f8f9367d8: "logic", // imports and the saved-token source's name
    h_01748d3dfe7c8369: "logic", // SavedToken
    h_835c6bab402715e4: "logic", // token form fields
    h_cb05a3ceba6f0ebc: "contract", // save_token and forget_saved_token write and delete a secret
    h_c07602170366e828: "logic", // the child process runs any request
    h_260b353204ffdcbe: "logic", // Bitbucket's token form text
    h_458525b7a4806fe2: "contract", // Bitbucket clones hand the saved token to git
    h_24393343afea5f06: "contract", // a saved token outranks git-stored credentials for Bitbucket
    h_41ad920c36c36c34: "contract", // a saved token outranks gh and git credentials for GitHub
    h_9e4bb28a39aa1c31: "logic", // GitHub's account name
    // configured_hosts renamed known_hosts; nothing outside the PR calls it.
    h_66ed69b5f388df2e: "logic",
    h_fdf72584a4c22928: "logic", // the child's request names, both ends in the PR
    h_7c8a78b251189575: "logic", // the child's output, both ends in the PR
    h_66f414f852d4bd40: "contract", // runs security and secret-tool with the secret
    h_5d316316659a80af: "logic", // import
    h_9ec463fa1453ecbf: "logic", // DelphiCode's new methods, called only by the routes
    h_bd2100244af12524: "logic", // import
    // connect_account checks a token and saves it: the write path, but the persistence it
    // reaches is in hosts.py and keychain.py.
    h_79397fb1b9683b02: "either",
    h_5eba290544449a8b: "logic", // the hosts with credentials, filtered here now
    h_7acf022352e1e5e1: "logic", // one connection's state
    h_e4d9835b56e246a4: "logic", // tests: fake keychain
    h_f7abae86420558fa: "logic", // tests
    h_790b401723df3725: "logic", // tests
    h_75bfbf4af6d004e2: "logic", // tests
    h_8c777e4d1f82a3d5: "logic", // tests
    h_ba84791b47b57091: "logic", // tests
    h_743d2e18313690ee: "logic", // tests
    h_d6f66d1faf76610b: "logic", // tests
    h_d9dd90eff846ec3d: "logic", // tests
    h_d30f8b98357e61ae: "logic", // tests
    h_99be348e5c49c6c6: "logic", // generated OpenAPI schema
    h_fe4895ff9d7d4f68: "logic", // generated OpenAPI schema
    h_792dd994cc6c715f: "logic", // generated client types
    h_83cf5736b748cc7f: "logic", // generated client types
    h_567888af004223b6: "logic", // generated client types
    h_e07de8ac1b7a10e4: "logic", // a link to the setup page
    h_5a8a7b15b5891f5c: "logic", // tests
    h_9e19c88847b8f1ee: "logic", // tests
    h_d08c050f491d289f: "logic", // import
    h_f9157990586f3468: "logic", // the setup page shows the connections
    h_8a79a987333dfd60: "logic", // the connections section, which calls the new endpoints
  },
  riskAt: {
    h_f0f06a5f0031f84f: [
      { hunkId: "h_f0f06a5f0031f84f", side: "new", lines: [29, 33] },
      { hunkId: "h_f0f06a5f0031f84f", side: "new", lines: [36, 38] },
    ],
    h_cb05a3ceba6f0ebc: [{ hunkId: "h_cb05a3ceba6f0ebc", side: "new", lines: [79, 84] }],
    h_458525b7a4806fe2: [{ hunkId: "h_458525b7a4806fe2", side: "new", lines: [265, 267] }],
    h_24393343afea5f06: [{ hunkId: "h_24393343afea5f06", side: "new", lines: [279, 280] }],
    h_41ad920c36c36c34: [
      { hunkId: "h_41ad920c36c36c34", side: "new", lines: [340, 340] },
      { hunkId: "h_41ad920c36c36c34", side: "new", lines: [346, 346] },
    ],
    h_66f414f852d4bd40: [
      { hunkId: "h_66f414f852d4bd40", side: "new", lines: [27, 41] },
      { hunkId: "h_66f414f852d4bd40", side: "new", lines: [44, 48] },
    ],
  },
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
  decisions: [
    {
      description:
        "Why read the keychain entry back after saving it: the keychain tools can exit without keeping it, and a lost token should fail the save",
      mustHave: false,
    },
    {
      description: "Why the secret goes to security -i hex-encoded, with -X",
      mustHave: false,
    },
    {
      description:
        "Why the GitHub token page preselects a classic token with the full repo scope, which grants more than listing needs",
      mustHave: false,
    },
    {
      description:
        "Why one service that fails doesn't fail the list of connections: its row shows the problem and the others still show",
      mustHave: false,
    },
    {
      description: "Why the keychain entry holds the token and the username as one JSON value",
      mustHave: false,
    },
  ],
  mismatches: [],
};
