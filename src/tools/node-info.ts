import { z } from "zod";
import { flexJson, flexBool } from "../utils/coercion";
import { serializeNode, DEFAULT_NODE_BUDGET } from "../utils/serialize-node";
import type { McpServer, SendCommandFn } from "./types";
import { mcpJson, mcpError } from "./types";

// ─── MCP Registration ────────────────────────────────────────────

export function registerMcpTools(server: McpServer, sendCommand: SendCommandFn) {
  server.tool(
    "get_node_info",
    "Get detailed information about one or more nodes. Always pass an array of IDs. Use `fields` to select only the properties you need (reduces context size).",
    {
      nodeIds: flexJson(z.array(z.string())).describe('Array of node IDs. Example: ["1:2","1:3"]'),
      depth: z.coerce.number().optional().describe("Child recursion depth (default: unlimited). 0=stubs only."),
      fields: flexJson(z.array(z.string())).optional().describe('Whitelist of property names to include. Always includes id, name, type. Example: ["absoluteBoundingBox","layoutMode","fills"]. Omit to return all properties.'),
    },
    async (params: any) => {
      try {
        const result = await sendCommand("get_node_info", params);
        return mcpJson(result);
      } catch (e) { return mcpError("Error getting node info", e); }
    }
  );

  server.tool(
    "get_node_css",
    "Get CSS properties for a node (useful for dev handoff)",
    { nodeId: z.string().describe("The node ID to get CSS for") },
    async ({ nodeId }: any) => {
      try { return mcpJson(await sendCommand("get_node_css", { nodeId })); }
      catch (e) { return mcpError("Error getting CSS", e); }
    }
  );

  server.tool(
    "search_nodes",
    "Search for nodes by layer name and/or type. Searches current page only — use set_current_page to switch pages first. Matches layer names (text nodes are often auto-named from their content). Returns paginated results.",
    {
      query: z.string().optional().describe("Name search (case-insensitive substring). Omit to match all names."),
      types: flexJson(z.array(z.string())).optional().describe('Filter by types. Example: ["FRAME","TEXT"]. Omit to match all types.'),
      scopeNodeId: z.string().optional().describe("Node ID to search within (defaults to current page)"),
      caseSensitive: flexBool(z.boolean()).optional().describe("Case-sensitive name match (default false)"),
      limit: z.coerce.number().optional().describe("Max results (default 50)"),
      offset: z.coerce.number().optional().describe("Skip N results for pagination (default 0)"),
    },
    async (params: any) => {
      try { return mcpJson(await sendCommand("search_nodes", params)); }
      catch (e) { return mcpError("Error searching nodes", e); }
    }
  );

  server.tool(
    "export_node_as_image",
    "Export a node as an image from Figma",
    {
      nodeId: z.string().describe("The node ID to export"),
      format: z.enum(["PNG", "JPG", "SVG", "PDF"]).optional().describe("Export format (default: PNG)"),
      scale: z.coerce.number().positive().optional().describe("Export scale (default: 1)"),
    },
    async ({ nodeId, format, scale }: any) => {
      try {
        const result = await sendCommand("export_node_as_image", { nodeId, format, scale }) as any;
        return {
          content: [{ type: "image", data: result.imageData, mimeType: result.mimeType || "image/png" }],
        };
      } catch (e) { return mcpError("Error exporting image", e); }
    }
  );
}

// ─── Figma Handlers ──────────────────────────────────────────────

/**
 * Recursively strip keys from a filtered node, keeping only `fields` + identity keys.
 * Stubs (objects with only id/name/type) are left untouched.
 */
function pickFields(node: any, keep: Set<string>): any {
  if (!node || typeof node !== "object") return node;
  const out: any = {};
  for (const key of Object.keys(node)) {
    if (keep.has(key) || key.startsWith("_")) {
      out[key] = key === "children" && Array.isArray(node.children)
        ? node.children.map((c: any) => pickFields(c, keep))
        : node[key];
    }
  }
  return out;
}

async function getNodeInfo(params: any) {
  const nodeIds: string[] = params.nodeIds || (params.nodeId ? [params.nodeId] : []);
  const depth = params.depth;
  const fields = params.fields;

  // Build fields whitelist (always include identity keys)
  const keep = fields?.length
    ? new Set<string>([...fields, "id", "name", "type", "children", "parentId", "parentName", "parentType"])
    : null;

  // Shared budget across all requested nodes — sequential to keep counter deterministic
  const budget = { remaining: DEFAULT_NODE_BUDGET };
  const results: any[] = [];

  for (const nodeId of nodeIds) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) { results.push({ nodeId, error: `Node not found: ${nodeId}` }); continue; }

    let serialized = await serializeNode(node, depth !== undefined ? depth : -1, 0, budget);

    if (keep && serialized) serialized = pickFields(serialized, keep);

    results.push(serialized);
  }

  const out: any = { results };

  if (budget.remaining <= 0) {
    out._truncated = true;
    out._notice = "Result was truncated (node budget exceeded). Nodes with _truncated: true are stubs. "
      + "To inspect them, call get_node_info with their IDs directly, or use a shallower depth.";
  }

  return out;
}

async function getNodeCss(params: any) {
  if (!params?.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(params.nodeId);
  if (!node) throw new Error(`Node not found: ${params.nodeId}`);
  if (!("getCSSAsync" in node)) throw new Error("Node does not support CSS export");
  const css = await (node as any).getCSSAsync();
  return { id: node.id, name: node.name, css };
}

async function searchNodes(params: any) {
  if (!params) throw new Error("Missing parameters");

  let scopeNode: any;
  if (params.scopeNodeId) {
    scopeNode = await figma.getNodeByIdAsync(params.scopeNodeId);
    if (!scopeNode) throw new Error(`Scope node not found: ${params.scopeNodeId}`);
  } else {
    await figma.currentPage.loadAsync();
    scopeNode = figma.currentPage;
  }
  if (!("findAll" in scopeNode)) throw new Error("Scope node does not support searching");

  let results: any[];
  if (params.types && !params.query) {
    results = scopeNode.findAllWithCriteria({ types: params.types });
  } else {
    results = scopeNode.findAll((node: any) => {
      if (params.types?.length && !params.types.includes(node.type)) return false;
      if (params.query) {
        const q = params.query.toLowerCase();
        return params.caseSensitive ? node.name.includes(params.query) : node.name.toLowerCase().includes(q);
      }
      return true;
    });
  }

  const totalCount = results.length;
  const limit = params.limit || 50;
  const offset = params.offset || 0;
  results = results.slice(offset, offset + limit);

  return {
    totalCount,
    returned: results.length,
    offset,
    limit,
    results: results.map((node: any) => {
      const entry: any = { id: node.id, name: node.name, type: node.type };
      if (node.parent) { entry.parentId = node.parent.id; entry.parentName = node.parent.name; }
      if ("absoluteBoundingBox" in node && node.absoluteBoundingBox) {
        entry.bounds = node.absoluteBoundingBox;
      } else if ("x" in node) {
        entry.x = node.x; entry.y = node.y;
        if ("width" in node) { entry.width = node.width; entry.height = node.height; }
      }
      return entry;
    }),
  };
}

async function exportNodeAsImage(params: any) {
  const { customBase64Encode } = await import("../utils/base64");
  const { nodeId, scale = 1 } = params || {};
  const format = params.format || "PNG";
  if (!nodeId) throw new Error("Missing nodeId");

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);
  if (!("exportAsync" in node)) throw new Error(`Node does not support export: ${nodeId}`);

  const bytes = await (node as any).exportAsync({
    format,
    constraint: { type: "SCALE", value: scale },
  });

  const mimeMap: Record<string, string> = {
    PNG: "image/png", JPG: "image/jpeg", SVG: "image/svg+xml", PDF: "application/pdf",
  };

  return {
    nodeId, format, scale,
    mimeType: mimeMap[format] || "application/octet-stream",
    imageData: customBase64Encode(bytes),
  };
}

export const figmaHandlers: Record<string, (params: any) => Promise<any>> = {
  get_node_info: getNodeInfo,
  // Legacy single-node alias
  get_nodes_info: async (params: any) => getNodeInfo({ nodeIds: params.nodeIds, depth: params.depth }),
  get_node_css: getNodeCss,
  search_nodes: searchNodes,
  export_node_as_image: exportNodeAsImage,
};
