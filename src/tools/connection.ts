import type { McpServer, SendCommandFn } from "./types";
import { mcpJson, mcpError } from "./types";

// ─── MCP Registration ────────────────────────────────────────────

export function registerMcpTools(server: McpServer, sendCommand: SendCommandFn) {
  server.tool(
    "ping",
    "Verify end-to-end connection to Figma. Returns the document name if the full chain (MCP → relay → plugin → Figma) is working. Use this after join_channel to confirm everything is wired up.",
    {},
    async () => {
      try {
        return mcpJson(await sendCommand("ping", {}, 5000));
      } catch (e) {
        return mcpError("Connection verification failed", e);
      }
    }
  );
}

// ─── Figma Handlers ──────────────────────────────────────────────

async function ping() {
  return {
    status: "pong",
    documentName: figma.root.name,
    currentPage: figma.currentPage.name,
    timestamp: Date.now(),
  };
}

export const figmaHandlers: Record<string, (params: any) => Promise<any>> = {
  ping,
};
