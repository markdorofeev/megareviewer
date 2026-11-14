export function CredentialsGuide() {
  return (
    <section className="grid gap-2 rounded-lg border p-4 text-sm">
      <h2 className="font-medium">Connect Bitbucket or GitHub</h2>
      <p className="text-muted-foreground">Delphi Code found no credentials. Any of these works:</p>
      <ul className="grid list-disc gap-1 pl-5">
        <li>
          Sign in with <code className="font-mono">gh auth login</code>, or store git credentials for bitbucket.org or
          github.com. Then reload this page.
        </li>
        <li>
          Set <code className="font-mono">GITHUB_TOKEN</code>, or{" "}
          <code className="font-mono">BITBUCKET_APP_PASSWORD</code> with{" "}
          <code className="font-mono">BITBUCKET_EMAIL</code> or <code className="font-mono">BITBUCKET_USERNAME</code>,
          then stop <code className="font-mono">delphi-code ui</code> and start it again so it sees them.
        </li>
      </ul>
    </section>
  );
}
