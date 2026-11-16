import { describe, expect, it } from "vitest";
import { managedMcpConfigPath, readManagedMcpServers } from "./managed-mcp.ts";

const reading = (text: string) => () => text;
const missing = () => {
  throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
};

describe("managed MCP config", () => {
  it("is where Claude Code looks for it on each platform", () => {
    expect(managedMcpConfigPath("darwin")).toBe(
      "/Library/Application Support/ClaudeCode/managed-mcp.json",
    );
    expect(managedMcpConfigPath("linux")).toBe("/etc/claude-code/managed-mcp.json");
    expect(managedMcpConfigPath("win32")).toBe("C:\\Program Files\\ClaudeCode\\managed-mcp.json");
  });

  it("names the servers it defines", () => {
    const text = JSON.stringify({
      mcpServers: { github: { type: "http", url: "https://example.com/mcp" }, tool: {} },
    });
    expect(readManagedMcpServers("x", reading(text))).toEqual(["github", "tool"]);
  });

  it("names none for an empty map, which still makes it an enterprise config", () => {
    expect(readManagedMcpServers("x", reading('{"mcpServers":{}}'))).toEqual([]);
  });

  it("is null without a file, or with one Claude Code can't parse either", () => {
    expect(readManagedMcpServers("x", missing)).toBeNull();
    expect(readManagedMcpServers("x", reading("{not json"))).toBeNull();
    expect(readManagedMcpServers("x", reading("[]"))).toBeNull();
  });
});
