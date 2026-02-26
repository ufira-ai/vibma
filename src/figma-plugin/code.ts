// Figma Plugin entry point
// Built by tsup into code.js (IIFE bundle) for the Figma plugin sandbox

import { allFigmaHandlers } from "../tools/figma-registry";

// ─── Plugin State ────────────────────────────────────────────────

const state = {
  serverPort: 3055,
  channelName: "",
};

// ─── UI Setup ────────────────────────────────────────────────────

figma.showUI(__html__, { width: 350, height: 600 });

// Send saved settings to UI on startup
figma.clientStorage.getAsync("settings").then((saved: any) => {
  if (saved) {
    if (saved.serverPort) state.serverPort = saved.serverPort;
    if (saved.channelName) state.channelName = saved.channelName;
    figma.ui.postMessage({ type: "restore-settings", serverPort: state.serverPort, channelName: state.channelName });
  }
});

// ─── Auto-Focus ─────────────────────────────────────────────────
// After every create/modify command, select affected nodes and scroll
// viewport to show them. Fire-and-forget — never blocks the response.

const SKIP_FOCUS = new Set([
  "join", "set_selection", "set_viewport", "zoom_into_view", "set_focus",
  "set_current_page", "create_page", "rename_page", "delete_node",
  "get_document_info", "get_current_page", "get_pages", "get_selection",
  "read_my_design", "get_node_info", "get_node_css", "get_available_fonts",
  "get_component_by_id", "get_instance_overrides", "get_styles",
  "get_style_by_id", "get_local_variables", "get_local_variable_collections",
  "get_variable_by_id", "get_variable_collection_by_id",
  "search_nodes", "search_components", "scan_text_nodes", "export_node_as_image",
  "lint_node", "get_node_variables", "ping",
]);

function extractNodeIds(result: any, params: any): string[] {
  const ids: string[] = [];
  // From result (create commands return {id} or {results: [{id}, ...]})
  if (result?.id && typeof result.id === "string") ids.push(result.id);
  if (Array.isArray(result?.results)) {
    for (const r of result.results) {
      if (r?.id && typeof r.id === "string") ids.push(r.id);
    }
  }
  // Fallback: from params (modify commands use items[].nodeId)
  if (ids.length === 0 && Array.isArray(params?.items)) {
    for (const item of params.items) {
      if (item?.nodeId && typeof item.nodeId === "string") ids.push(item.nodeId);
    }
  }
  return ids;
}

async function autoFocus(nodeIds: string[]) {
  const nodes: SceneNode[] = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (node && "x" in node) nodes.push(node as SceneNode);
  }
  if (nodes.length > 0) {
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
  }
}

// ─── Message Handling ────────────────────────────────────────────

figma.ui.onmessage = async (msg: any) => {
  switch (msg.type) {
    case "update-settings":
      updateSettings(msg);
      break;
    case "notify":
      figma.notify(msg.message);
      break;
    case "close-plugin":
      figma.closePlugin();
      break;
    case "execute-command":
      try {
        const result = await handleCommand(msg.command, msg.params);
        figma.ui.postMessage({
          type: "command-result",
          id: msg.id,
          result,
        });
        // Fire-and-forget auto-focus
        if (!SKIP_FOCUS.has(msg.command)) {
          const ids = extractNodeIds(result, msg.params);
          if (ids.length > 0) autoFocus(ids).catch(() => {});
        }
      } catch (error: any) {
        figma.ui.postMessage({
          type: "command-error",
          id: msg.id,
          error: error.message || "Error executing command",
        });
      }
      break;
  }
};

// Listen for plugin commands from menu
figma.on("run", ({ command }: any) => {
  figma.ui.postMessage({ type: "auto-connect" });
});

// ─── Settings ────────────────────────────────────────────────────

function updateSettings(settings: any) {
  if (settings.serverPort) {
    state.serverPort = settings.serverPort;
  }
  if (settings.channelName !== undefined) {
    state.channelName = settings.channelName;
  }
  figma.clientStorage.setAsync("settings", {
    serverPort: state.serverPort,
    channelName: state.channelName,
  });
}

// ─── Command Dispatch ────────────────────────────────────────────

async function handleCommand(command: string, params: any): Promise<any> {
  const handler = allFigmaHandlers[command];
  if (handler) {
    return await handler(params);
  }
  throw new Error(`Unknown command: ${command}`);
}
