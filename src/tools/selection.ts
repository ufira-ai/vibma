import { z } from "zod";
import { flexJson } from "../utils/coercion";
import type { McpServer, SendCommandFn } from "./types";
import { mcpJson, mcpError } from "./types";

// ─── MCP Registration ────────────────────────────────────────────

export function registerMcpTools(server: McpServer, sendCommand: SendCommandFn) {
  server.tool(
    "get_selection",
    "Get information about the current selection in Figma",
    {},
    async () => {
      try { return mcpJson(await sendCommand("get_selection")); }
      catch (e) { return mcpError("Error getting selection", e); }
    }
  );

  server.tool(
    "read_my_design",
    "Read the nodes the user has selected in Figma (or set via set_selection). Returns nothing if no selection exists — ask the user to select something, or use get_node_info with specific node IDs. Use depth to control child traversal.",
    { depth: z.coerce.number().optional().describe("Levels of children to recurse. 0=selection only, -1 or omit for unlimited.") },
    async ({ depth }: any) => {
      try { return mcpJson(await sendCommand("read_my_design", { depth })); }
      catch (e) { return mcpError("Error reading design", e); }
    }
  );

  server.tool(
    "set_selection",
    "Set selection to nodes and scroll viewport to show them. Also works as focus (single node).",
    {
      nodeIds: flexJson(z.array(z.string())).describe('Array of node IDs to select. Example: ["1:2","1:3"]'),
    },
    async ({ nodeIds }: any) => {
      try { return mcpJson(await sendCommand("set_selection", { nodeIds })); }
      catch (e) { return mcpError("Error setting selection", e); }
    }
  );

  server.tool(
    "zoom_into_view",
    "Zoom the viewport to fit specific nodes (like pressing Shift+1)",
    {
      nodeIds: flexJson(z.array(z.string())).describe("Array of node IDs to zoom into"),
    },
    async ({ nodeIds }: any) => {
      try { return mcpJson(await sendCommand("zoom_into_view", { nodeIds })); }
      catch (e) { return mcpError("Error zooming", e); }
    }
  );

  server.tool(
    "set_viewport",
    "Set viewport center position and/or zoom level",
    {
      center: flexJson(z.object({ x: z.coerce.number(), y: z.coerce.number() })).optional().describe("Viewport center point. Omit to keep current center."),
      zoom: z.coerce.number().optional().describe("Zoom level (1 = 100%). Omit to keep current zoom."),
    },
    async (params: any) => {
      try { return mcpJson(await sendCommand("set_viewport", params)); }
      catch (e) { return mcpError("Error setting viewport", e); }
    }
  );
}

// ─── Figma Handlers ──────────────────────────────────────────────

async function getSelection() {
  return {
    selectionCount: figma.currentPage.selection.length,
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
    })),
  };
}

async function readMyDesign(params: any) {
  const sel = figma.currentPage.selection;
  if (sel.length === 0) {
    return { selectionCount: 0, warning: "Nothing selected. Use set_selection to select nodes first, or use get_node_info with specific node IDs." };
  }

  const { serializeNode, DEFAULT_NODE_BUDGET } = await import("../utils/serialize-node");
  const depth = params?.depth;
  const budget = { remaining: DEFAULT_NODE_BUDGET };
  const responses: any[] = [];
  for (const node of sel) {
    responses.push({
      nodeId: node.id,
      document: await serializeNode(node, depth !== undefined ? depth : -1, 0, budget),
    });
  }
  const out: any = { selectionCount: responses.length, nodes: responses };
  if (budget.remaining <= 0) {
    out._truncated = true;
    out._notice = "Result was truncated (node budget exceeded). Nodes with _truncated: true are stubs. "
      + "To inspect them, call get_node_info with their IDs directly, or use a shallower depth.";
  }
  return out;
}

async function setSelection(params: any) {
  const nodeIds = params?.nodeIds;
  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw new Error("Missing or empty nodeIds");
  }

  const nodes: SceneNode[] = [];
  const notFound: string[] = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (node) nodes.push(node as SceneNode);
    else notFound.push(id);
  }
  if (nodes.length === 0) throw new Error(`No valid nodes found: ${nodeIds.join(", ")}`);

  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);

  return {
    count: nodes.length,
    selectedNodes: nodes.map((n) => ({ name: n.name, id: n.id })),
    notFoundIds: notFound.length > 0 ? notFound : undefined,
  };
}

async function zoomIntoView(params: any) {
  if (!params?.nodeIds?.length) throw new Error("Missing nodeIds");
  const nodes: SceneNode[] = [];
  const notFound: string[] = [];
  for (const id of params.nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (node) nodes.push(node as SceneNode);
    else notFound.push(id);
  }
  if (nodes.length === 0) throw new Error("None of the specified nodes were found");
  figma.viewport.scrollAndZoomIntoView(nodes);
  return {
    viewportCenter: figma.viewport.center,
    viewportZoom: figma.viewport.zoom,
    nodeCount: nodes.length,
    notFound: notFound.length > 0 ? notFound : undefined,
  };
}

async function setViewport(params: any) {
  if (!params) throw new Error("Missing parameters");
  if (params.center) figma.viewport.center = { x: params.center.x, y: params.center.y };
  if (params.zoom !== undefined) figma.viewport.zoom = params.zoom;
  return { center: figma.viewport.center, zoom: figma.viewport.zoom, bounds: figma.viewport.bounds };
}

export const figmaHandlers: Record<string, (params: any) => Promise<any>> = {
  get_selection: getSelection,
  read_my_design: readMyDesign,
  set_selection: setSelection,
  // Legacy aliases for backward compat
  set_focus: async (params: any) => setSelection({ nodeIds: [params.nodeId] }),
  set_selections: setSelection,
  zoom_into_view: zoomIntoView,
  set_viewport: setViewport,
};
