// The finding of a real AI review of delphi-code #2 (evals/cases/delphi-account-connections), as
// Sonnet 5.5 wrote it on 2026-11-22, with the code it rests on: the guardrail call's one case in a
// model's own words.

import type { AdviceInput } from "../src/application/ports/index.ts";

export const delphiPoints: AdviceInput["points"] = [
  {
    ref: "f1",
    path: "delphi_code/infrastructure/hosts.py",
    title: "Saved Bitbucket app-password login verifies but then fails to clone",
    explanation:
      'The env path in `clone_credentials` keeps a plain username (`"@" not in username`), but the saved-token branch always returns `API_TOKEN_GIT_USERNAME`. `PUT` accepts any `username`, so a saved username/app-password lists repos but fails to clone.',
    code: [
      "         if not password:",
      "+            saved = self._saved_token()",
      "+            return (API_TOKEN_GIT_USERNAME, saved.token) if saved else None",
    ],
  },
];
