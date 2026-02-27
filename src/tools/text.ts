import { z } from "zod";
import { flexJson, flexBool } from "../utils/coercion";
import * as S from "./schemas";
import type { McpServer, SendCommandFn } from "./types";
import { mcpJson, mcpError } from "./types";
import { batchHandler, suggestStyleForColor, suggestTextStyle } from "./helpers";

// ─── Schemas ─────────────────────────────────────────────────────

const textContentItem = z.object({
  nodeId: z.string().describe("Text node ID"),
  text: z.string().describe("New text content"),
});

const textPropsItem = z.object({
  nodeId: z.string().describe("Text node ID"),
  fontSize: z.coerce.number().optional().describe("Font size"),
  fontWeight: z.coerce.number().optional().describe("Font weight: 100-900"),
  fontColor: flexJson(S.colorRgba).optional().describe('Font color. Hex "#000" or {r,g,b,a?} 0-1.'),
  textStyleId: z.string().optional().describe("Text style ID to apply (overrides font props)"),
  textStyleName: z.string().optional().describe("Text style name (case-insensitive match)"),
  textAlignHorizontal: z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]).optional().describe("Horizontal text alignment"),
  textAlignVertical: z.enum(["TOP", "CENTER", "BOTTOM"]).optional().describe("Vertical text alignment"),
  textAutoResize: z.enum(["NONE", "WIDTH_AND_HEIGHT", "HEIGHT", "TRUNCATE"]).optional(),
  layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional(),
  layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional(),
});

const scanTextItem = z.object({
  nodeId: S.nodeId,
  limit: z.coerce.number().optional().describe("Max text nodes to return (default: 50)"),
  includePath: flexBool(z.boolean()).optional().describe("Include ancestor path strings (default: true). Set false to reduce payload."),
  includeGeometry: flexBool(z.boolean()).optional().describe("Include absoluteX/absoluteY/width/height (default: true). Set false to reduce payload."),
});

// ─── MCP Registration ────────────────────────────────────────────

export function registerMcpTools(server: McpServer, sendCommand: SendCommandFn) {
  server.tool(
    "set_text_content",
    "Set text content on text nodes. Batch: pass multiple items to replace text in multiple nodes at once.",
    { items: flexJson(z.array(textContentItem)).describe("Array of {nodeId, text}"), depth: S.depth },
    async (params: any) => {
      try { return mcpJson(await sendCommand("set_text_content", params)); }
      catch (e) { return mcpError("Error setting text content", e); }
    }
  );

  server.tool(
    "set_text_properties",
    "Set font properties on existing text nodes (fontSize, fontWeight, fontColor, textStyle). Batch: pass multiple items.",
    { items: flexJson(z.array(textPropsItem)).describe("Array of {nodeId, fontSize?, fontWeight?, fontColor?, ...}"), depth: S.depth },
    async (params: any) => {
      try { return mcpJson(await sendCommand("set_text_properties", params)); }
      catch (e) { return mcpError("Error setting text properties", e); }
    }
  );

  server.tool(
    "scan_text_nodes",
    "Scan all text nodes within a node tree. Batch: pass multiple items.",
    { items: flexJson(z.array(scanTextItem)).describe("Array of {nodeId}") },
    async (params: any) => {
      try { return mcpJson(await sendCommand("scan_text_nodes", params)); }
      catch (e) { return mcpError("Error scanning text nodes", e); }
    }
  );
}

// ─── Figma Handlers ──────────────────────────────────────────────

/**
 * Batch set_text_content with font preloading.
 * Resolves all nodes and preloads their fonts in one pass before writing text.
 */
async function setTextContentBatch(params: any): Promise<{ results: any[] }> {
  const items = params.items || [params];
  const depth = params.depth;

  // 1. Resolve all nodes first
  const resolved: { node: TextNode; text: string }[] = [];
  const errors: Map<number, string> = new Map();
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const node = await figma.getNodeByIdAsync(p.nodeId);
    if (!node) { errors.set(i, `Node not found: ${p.nodeId}`); continue; }
    if (node.type !== "TEXT") { errors.set(i, `Node is not a text node: ${p.nodeId}`); continue; }
    resolved.push({ node: node as TextNode, text: p.text });
  }

  // 2. Collect unique fonts and preload in parallel
  const fontsToLoad = new Map<string, FontName>();
  const fallback: FontName = { family: "Inter", style: "Regular" };
  fontsToLoad.set("Inter::Regular", fallback);
  for (const { node } of resolved) {
    const fn = node.fontName;
    if (fn !== figma.mixed && fn) {
      const key = `${(fn as FontName).family}::${(fn as FontName).style}`;
      fontsToLoad.set(key, fn as FontName);
    }
  }
  await Promise.all([...fontsToLoad.values()].map(f => figma.loadFontAsync(f)));

  // 3. Import setCharacters once
  const { setCharacters } = await import("../utils/figma-helpers");

  // 4. Set text on all nodes
  const results: any[] = [];
  let resolvedIdx = 0;
  for (let i = 0; i < items.length; i++) {
    if (errors.has(i)) {
      results.push({ error: errors.get(i) });
      continue;
    }
    const { node, text } = resolved[resolvedIdx++];
    try {
      await setCharacters(node, text);
      let result: any = "ok";
      if (depth !== undefined) {
        const { nodeSnapshot } = await import("./helpers");
        const snapshot = await nodeSnapshot(node.id, depth);
        if (snapshot) result = snapshot;
      }
      results.push(result);
    } catch (e: any) {
      results.push({ error: e.message });
    }
  }
  return { results };
}

/**
 * Batch set_text_properties with font preloading.
 */
async function setTextPropertiesBatch(params: any): Promise<{ results: any[] }> {
  const items = params.items || [params];
  const depth = params.depth;

  // 1. Resolve all nodes
  const resolved: { node: TextNode; props: any }[] = [];
  const errors: Map<number, string> = new Map();
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const node = await figma.getNodeByIdAsync(p.nodeId);
    if (!node) { errors.set(i, `Node not found: ${p.nodeId}`); continue; }
    if (node.type !== "TEXT") { errors.set(i, `Not a text node: ${p.nodeId}`); continue; }
    resolved.push({ node: node as TextNode, props: p });
  }

  // 2. Collect fonts to load
  const fontsToLoad = new Map<string, FontName>();
  for (const { node, props } of resolved) {
    // Current font
    const fn = node.fontName;
    if (fn !== figma.mixed && fn) {
      fontsToLoad.set(`${fn.family}::${fn.style}`, fn);
    }
    // Target font if changing weight
    if (props.fontWeight !== undefined) {
      const style = getFontStyle(props.fontWeight);
      const family = (fn !== figma.mixed && fn) ? fn.family : "Inter";
      fontsToLoad.set(`${family}::${style}`, { family, style });
    }
  }
  await Promise.all([...fontsToLoad.values()].map(f => figma.loadFontAsync(f)));

  // 3. Resolve text styles by name once
  let textStyles: any[] | null = null;
  const styleNames = new Set<string>();
  for (const { props } of resolved) {
    if (props.textStyleName && !props.textStyleId) styleNames.add(props.textStyleName);
  }
  if (styleNames.size > 0) textStyles = await figma.getLocalTextStylesAsync();

  // 4. Apply properties
  const results: any[] = [];
  let resolvedIdx = 0;
  for (let i = 0; i < items.length; i++) {
    if (errors.has(i)) { results.push({ error: errors.get(i) }); continue; }
    const { node, props } = resolved[resolvedIdx++];
    try {
      // Text style takes priority
      let resolvedStyleId = props.textStyleId;
      if (!resolvedStyleId && props.textStyleName && textStyles) {
        const exact = textStyles.find((s: any) => s.name === props.textStyleName);
        if (exact) resolvedStyleId = exact.id;
        else {
          const fuzzy = textStyles.find((s: any) => s.name.toLowerCase().includes(props.textStyleName.toLowerCase()));
          if (fuzzy) resolvedStyleId = fuzzy.id;
        }
      }
      if (resolvedStyleId) {
        const s = await figma.getStyleByIdAsync(resolvedStyleId);
        if (s?.type === "TEXT") await (node as any).setTextStyleIdAsync(s.id);
      } else {
        if (props.fontWeight !== undefined) {
          const family = (node.fontName !== figma.mixed && node.fontName) ? node.fontName.family : "Inter";
          node.fontName = { family, style: getFontStyle(props.fontWeight) };
        }
        if (props.fontSize !== undefined) node.fontSize = props.fontSize;
      }

      if (props.fontColor) {
        node.fills = [{
          type: "SOLID",
          color: { r: props.fontColor.r ?? 0, g: props.fontColor.g ?? 0, b: props.fontColor.b ?? 0 },
          opacity: props.fontColor.a ?? 1,
        }];
      }

      if (props.textAlignHorizontal) node.textAlignHorizontal = props.textAlignHorizontal;
      if (props.textAlignVertical) node.textAlignVertical = props.textAlignVertical;
      if (props.textAutoResize) node.textAutoResize = props.textAutoResize;
      if (props.layoutSizingHorizontal) {
        try { node.layoutSizingHorizontal = props.layoutSizingHorizontal; } catch {}
      }
      if (props.layoutSizingVertical) {
        try { node.layoutSizingVertical = props.layoutSizingVertical; } catch {}
      }

      let result: any = "ok";
      if (depth !== undefined) {
        const { nodeSnapshot } = await import("./helpers");
        const snapshot = await nodeSnapshot(node.id, depth);
        if (snapshot) result = snapshot;
      }

      // Warnings — only on actual conflicts or actionable suggestions
      const warnings: string[] = [];
      if (props.textStyleName && props.textStyleId) {
        warnings.push("Both textStyleName and textStyleId provided — used textStyleId. Pass only one.");
      }
      if (!resolvedStyleId && !props.textStyleName && !props.textStyleId &&
          (props.fontSize !== undefined || props.fontWeight !== undefined)) {
        const fs = props.fontSize ?? (typeof node.fontSize === "number" ? node.fontSize : 14);
        const fw = props.fontWeight ?? 400;
        warnings.push(await suggestTextStyle(fs, fw));
      }
      if (props.fontColor) {
        const suggestion = await suggestStyleForColor(props.fontColor, "fontColorStyleName");
        if (suggestion) warnings.push(suggestion);
      }
      if (warnings.length > 0) {
        if (typeof result === "string") result = { status: result };
        result.warning = warnings.join(" ");
      }
      results.push(result);
    } catch (e: any) {
      results.push({ error: e.message });
    }
  }
  return { results };
}

function getFontStyle(weight: number): string {
  const map: Record<number, string> = {
    100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular",
    500: "Medium", 600: "Semi Bold", 700: "Bold", 800: "Extra Bold", 900: "Black",
  };
  return map[weight] || "Regular";
}

async function scanTextSingle(p: any) {
  const node = await figma.getNodeByIdAsync(p.nodeId);
  if (!node) throw new Error(`Node not found: ${p.nodeId}`);

  const limit = p.limit ?? 50;
  const opts = { includePath: p.includePath !== false, includeGeometry: p.includeGeometry !== false };
  const textNodes: any[] = [];
  await collectTextNodes(node, [], [], 0, textNodes, limit, opts);
  const truncated = textNodes.length >= limit;
  return { nodeId: p.nodeId, count: textNodes.length, truncated, textNodes };
}

async function collectTextNodes(node: any, namePath: string[], idPath: string[], depth: number, out: any[], limit: number, opts: { includePath: boolean; includeGeometry: boolean }) {
  if (out.length >= limit) return;
  if (node.visible === false) return;
  const names = [...namePath, node.name || `Unnamed ${node.type}`];
  const ids = [...idPath, node.id];

  if (node.type === "TEXT") {
    let fontFamily = "", fontStyle = "";
    if (node.fontName && typeof node.fontName === "object") {
      if ("family" in node.fontName) fontFamily = node.fontName.family;
      if ("style" in node.fontName) fontStyle = node.fontName.style;
    }
    const entry: any = {
      id: node.id,
      name: node.name || "Text",
      characters: node.characters,
      fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
      fontFamily,
      fontStyle,
    };
    if (opts.includeGeometry) {
      const bounds = node.absoluteBoundingBox ?? node.absoluteRenderBounds;
      entry.absoluteX = bounds ? bounds.x : null;
      entry.absoluteY = bounds ? bounds.y : null;
      entry.width = bounds ? bounds.width : (node.width ?? 0);
      entry.height = bounds ? bounds.height : (node.height ?? 0);
    }
    if (opts.includePath) {
      entry.path = names.join(" > ");
      entry.pathIds = ids.join(" > ");
      entry.depth = depth;
    }
    out.push(entry);
  }

  if ("children" in node) {
    for (const child of (node as any).children) {
      if (out.length >= limit) break;
      await collectTextNodes(child, names, ids, depth + 1, out, limit, opts);
    }
  }
}

// Legacy handler: set_multiple_text_contents maps to set_text_content
async function setMultipleTextContentsFigma(params: any) {
  // Legacy format: { nodeId: "parent", text: [{ nodeId, text }] }
  const items = params.text || params.items || [];
  return setTextContentBatch({ items, depth: params.depth });
}

export const figmaHandlers: Record<string, (params: any) => Promise<any>> = {
  set_text_content: setTextContentBatch,
  set_text_properties: setTextPropertiesBatch,
  scan_text_nodes: (p) => batchHandler(p, scanTextSingle),
  // Legacy alias
  set_multiple_text_contents: setMultipleTextContentsFigma,
};
