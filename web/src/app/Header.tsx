import type { StatusResponse } from "../../../contracts/index.ts";
import { type ApiError, errorMessage } from "../api/index.ts";
import { Link } from "./Link.tsx";

interface Indicator {
  readonly tone: "ok" | "warning" | "danger" | "muted";
  readonly label: string;
  readonly detail: string;
}

export const statusIndicator = (
  status: StatusResponse | null,
  error: ApiError | null,
): Indicator => {
  if (error !== null) return { tone: "danger", label: "Disconnected", detail: errorMessage(error) };
  if (status === null) return { tone: "muted", label: "Connecting…", detail: "" };
  const version = `megareviewer ${status.version}`;
  const { github, bitbucket } = status.hosts;
  if (!github.configured && !bitbucket.configured) {
    return { tone: "warning", label: "Setup needed", detail: version };
  }
  if (github.error !== null || bitbucket.error !== null) {
    return { tone: "warning", label: "Host problem", detail: version };
  }
  return { tone: "ok", label: "Ready", detail: version };
};

export const Header = ({
  status,
  error,
}: {
  readonly status: StatusResponse | null;
  readonly error: ApiError | null;
}) => {
  const indicator = statusIndicator(status, error);
  return (
    <header className="app-header">
      <Link to="/" className="brand">
        megareviewer
      </Link>
      <span className="status-indicator" role="status" title={indicator.detail}>
        <span className={`status-dot tone-${indicator.tone}`} aria-hidden="true" />
        {indicator.label}
      </span>
    </header>
  );
};
