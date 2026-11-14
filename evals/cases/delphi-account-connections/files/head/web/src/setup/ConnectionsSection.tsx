import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { dataOrFailure } from "@/api/apiClient";
import { useApiConnection } from "@/api/apiContext";
import type { components } from "@/api/schema";
import { FailureMessage } from "@/components/FailureMessage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AccountConnection = components["schemas"]["AccountConnectionResponse"];

const CONNECTIONS_QUERY_KEY = ["account-connections"];

export function ConnectionsSection() {
  const { client } = useApiConnection();
  const connections = useQuery({
    queryKey: CONNECTIONS_QUERY_KEY,
    queryFn: async () => dataOrFailure(await client.GET("/api/account-connections")).connections,
  });

  return (
    <section aria-labelledby="connections-heading" className="grid gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="connections-heading" className="font-medium">
          Bitbucket and GitHub accounts
        </h2>
        <Button variant="outline" size="sm" onClick={() => connections.refetch()} disabled={connections.isFetching}>
          {connections.isFetching ? "Checking…" : "Check again"}
        </Button>
      </div>
      {connections.isPending && <p className="text-muted-foreground text-sm">Checking your accounts…</p>}
      {connections.isError && <FailureMessage failure={connections.error} />}
      {connections.data && (
        <ul className="grid gap-4 text-sm">
          {connections.data.map((connection) => (
            <ConnectionRow key={connection.domain} connection={connection} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ConnectionRow({ connection }: { connection: AccountConnection }) {
  const [enteringToken, setEnteringToken] = useState(false);
  const replaceConnection = useConnectionReplacer();
  const { client } = useApiConnection();
  const forgetting = useMutation({
    mutationFn: async () =>
      dataOrFailure(
        await client.DELETE("/api/account-connections/{domain}/token", {
          params: { path: { domain: connection.domain } },
        }),
      ),
    onSuccess: replaceConnection,
  });

  return (
    <li aria-label={connection.name} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{connection.name}</span>
        <ConnectionBadge connection={connection} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {connection.state === "connected" && (
            <Link
              to="/projects/from-account"
              search={{ service: connection.domain }}
              className="underline underline-offset-4"
            >
              Pick repositories
            </Link>
          )}
          {!enteringToken && (
            <Button variant="outline" size="sm" onClick={() => setEnteringToken(true)}>
              {connection.state === "not_connected" ? "Connect" : "Use another token"}
            </Button>
          )}
          {connection.saved_token && (
            <Button variant="ghost" size="sm" onClick={() => forgetting.mutate()} disabled={forgetting.isPending}>
              {forgetting.isPending ? "Forgetting…" : "Forget saved token"}
            </Button>
          )}
        </div>
      </div>
      <p className="break-words text-muted-foreground">{connectionDetail(connection)}</p>
      {forgetting.isError && <FailureMessage failure={forgetting.error} />}
      {enteringToken && <TokenForm connection={connection} onDone={() => setEnteringToken(false)} />}
    </li>
  );
}

function TokenForm({ connection, onDone }: { connection: AccountConnection; onDone: () => void }) {
  const ids = useId();
  const { client } = useApiConnection();
  const replaceConnection = useConnectionReplacer();
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const saving = useMutation({
    mutationFn: async () =>
      dataOrFailure(
        await client.PUT("/api/account-connections/{domain}/token", {
          params: { path: { domain: connection.domain } },
          body: { token, username: connection.username_label ? username : null },
        }),
      ),
    onSuccess: (saved) => {
      replaceConnection(saved);
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    saving.mutate();
  };

  return (
    <form aria-label={`${connection.name} token`} onSubmit={submit} className="grid gap-3 rounded-md bg-muted/50 p-3">
      <p>
        <a href={connection.token_page} target="_blank" rel="noreferrer" className="underline underline-offset-4">
          Create a {connection.name} token
        </a>{" "}
        in a new tab. {connection.token_permissions}. Delphi Code checks it with {connection.name}, then keeps it in
        your keychain.
      </p>
      {connection.username_label && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${ids}-username`}>{connection.username_label}</Label>
          <Input
            id={`${ids}-username`}
            type="email"
            autoComplete="email"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-token`}>Token</Label>
        <Input
          id={`${ids}-token`}
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          required
        />
      </div>
      {saving.isError && <FailureMessage failure={saving.error} />}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving.isPending}>
          {saving.isPending ? "Checking…" : "Check and save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function useConnectionReplacer() {
  const queryClient = useQueryClient();
  return (changed: AccountConnection) => {
    queryClient.setQueryData<AccountConnection[]>(CONNECTIONS_QUERY_KEY, (connections) =>
      connections?.map((connection) => (connection.domain === changed.domain ? changed : connection)),
    );
    void queryClient.invalidateQueries({ queryKey: ["hosting-services"] });
  };
}

function ConnectionBadge({ connection }: { connection: AccountConnection }) {
  switch (connection.state) {
    case "connected":
      return (
        <Badge variant="secondary">{connection.account ? `Connected as ${connection.account}` : "Connected"}</Badge>
      );
    case "failed":
      return <Badge variant="destructive">Not working</Badge>;
    case "not_connected":
      return <Badge variant="outline">Not connected</Badge>;
  }
}

function connectionDetail(connection: AccountConnection): string {
  switch (connection.state) {
    case "connected":
      return `Using the ${connection.credentials_source}.`;
    case "failed":
      return connection.problem ?? "";
    case "not_connected":
      return `Connect with a token here, or ${connection.how_to_connect}.`;
  }
}
