import { readFileSync } from "node:fs";
import { z } from "zod";

/** Where Claude Code looks for an organization's `managed-mcp.json`. */
export const managedMcpConfigPath = (platform: NodeJS.Platform = process.platform): string => {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-mcp.json";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\managed-mcp.json";
  return "/etc/claude-code/managed-mcp.json";
};

const ManagedMcpConfig = z
  .object({ mcpServers: z.record(z.string(), z.unknown()).optional() })
  .loose();

/**
 * The names of the servers an organization's `managed-mcp.json` defines, or null when there's
 * no such file Claude Code could read. With one, Claude Code refuses `--strict-mcp-config` and
 * loads those servers whatever megareviewer asks, so a pass has to deny them by name instead.
 */
export const readManagedMcpServers = (
  path: string = managedMcpConfigPath(),
  read: (path: string) => string = (file) => readFileSync(file, "utf8"),
): readonly string[] | null => {
  let text: string;
  try {
    text = read(path);
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Claude Code can't parse it either, so it doesn't count as an enterprise config.
    return null;
  }
  const config = ManagedMcpConfig.safeParse(json);
  return config.success ? Object.keys(config.data.mcpServers ?? {}) : null;
};
