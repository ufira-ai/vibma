import { z } from "zod";
import { flexJson, flexBool } from "../utils/coercion";
import * as S from "./schemas";
import type { McpServer, SendCommandFn } from "./types";
import { mcpJson, mcpError } from "./types";
import { batchHandler, appendToParent, solidPaint, styleNotFoundHint, suggestStyleForColor, findVariableById } from "./helpers";

// ─── Schemas ─────────────────────────────────────────────────────

const componentItem = z.object({
  name: z.string().describe("Component name"),
  x: S.xPos,
  y: S.yPos,
  width: z.coerce.number().optional().describe("Width (default: 100)"),
  height: z.coerce.number().optional().describe("Height (default: 100)"),
  parentId: S.parentId,
  fillColor: flexJson(S.colorRgba).optional().describe('Fill color. Hex "#FF0000" or {r,g,b,a?} 0-1. Omit for no fill.'),
  fillStyleName: z.string().optional().describe("Apply a fill paint style by name (case-insensitive)."),
  fillVariableId: z.string().optional().describe("Bind a color variable to the fill."),
  strokeColor: flexJson(S.colorRgba).optional().describe('Stroke color. Hex "#FF0000" or {r,g,b,a?} 0-1. Omit for no stroke.'),
  strokeStyleName: z.string().optional().describe("Apply a stroke paint style by name."),
  strokeVariableId: z.string().optional().describe("Bind a color variable to the stroke."),
  strokeWeight: z.coerce.number().positive().optional().describe("Stroke weight (default: 1)"),
  cornerRadius: z.coerce.number().optional().describe("Corner radius (default: 0)"),
  layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).optional().describe("Layout direction (default: NONE)"),
  layoutWrap: z.enum(["NO_WRAP", "WRAP"]).optional().describe("Wrap behavior (default: NO_WRAP)"),
  paddingTop: z.coerce.number().optional().describe("Top padding (default: 0)"),
  paddingRight: z.coerce.number().optional().describe("Right padding (default: 0)"),
  paddingBottom: z.coerce.number().optional().describe("Bottom padding (default: 0)"),
  paddingLeft: z.coerce.number().optional().describe("Left padding (default: 0)"),
  primaryAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"]).optional().describe("Primary axis alignment (default: MIN)"),
  counterAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "BASELINE"]).optional().describe("Counter axis alignment (default: MIN)"),
  layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing (default: FIXED)"),
  layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing (default: FIXED)"),
  itemSpacing: z.coerce.number().optional().describe("Spacing between children (default: 0)"),
});

const fromNodeItem = z.object({
  nodeId: S.nodeId,
});

const combineItem = z.object({
  componentIds: flexJson(z.array(z.string())).describe("Component IDs to combine (min 2)"),
  name: z.string().optional().describe("Name for the component set. Omit to auto-generate."),
});

const propItem = z.object({
  componentId: z.string().describe("Component node ID"),
  propertyName: z.string().describe("Property name"),
  type: z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"]).describe("Property type"),
  defaultValue: flexBool(z.union([z.string(), z.boolean()])).describe("Default value (string for TEXT/VARIANT, boolean for BOOLEAN)"),
  preferredValues: flexJson(z.array(z.object({
    type: z.enum(["COMPONENT", "COMPONENT_SET"]),
    key: z.string(),
  })).optional()).describe("Preferred values for INSTANCE_SWAP type. Omit for none."),
});

const instanceItem = z.object({
  componentId: z.string().describe("Component or component set ID"),
  variantProperties: flexJson(z.record(z.string(), z.string())).optional().describe('Pick variant by properties, e.g. {"Style":"Secondary","Size":"Large"}. Ignored for plain COMPONENT IDs.'),
  x: z.coerce.number().optional().describe("X position. Omit to keep default."),
  y: z.coerce.number().optional().describe("Y position. Omit to keep default."),
  parentId: S.parentId,
});

// ─── MCP Registration ────────────────────────────────────────────

export function registerMcpTools(server: McpServer, sendCommand: SendCommandFn) {
  server.tool(
    "create_component",
    "Create components in Figma. Same layout params as create_frame. Name with 'Property=Value' pattern (e.g. 'Size=Small') if you plan to combine_as_variants later. Batch: pass multiple items.",
    { items: flexJson(z.array(componentItem)).describe("Array of components to create"), depth: S.depth },
    async (params: any) => {
      try { return mcpJson(await sendCommand("create_component", params)); }
      catch (e) { return mcpError("Error creating component", e); }
    }
  );

  server.tool(
    "create_component_from_node",
    "Convert existing nodes into components. Batch: pass multiple items.",
    { items: flexJson(z.array(fromNodeItem)).describe("Array of {nodeId}"), depth: S.depth },
    async (params: any) => {
      try { return mcpJson(await sendCommand("create_component_from_node", params)); }
      catch (e) { return mcpError("Error creating component from node", e); }
    }
  );

  server.tool(
    "combine_as_variants",
    "Combine components into variant sets. Name components with 'Property=Value' pattern (e.g. 'Style=Primary', 'Size=Large') BEFORE combining — Figma derives variant properties from component names. Avoid slashes in names. The resulting set is placed in the components' shared parent (or page root if parents differ). Batch: pass multiple items.",
    { items: flexJson(z.array(combineItem)).describe("Array of {componentIds, name?}"), depth: S.depth },
    async (params: any) => {
      try { return mcpJson(await sendCommand("combine_as_variants", params)); }
      catch (e) { return mcpError("Error combining variants", e); }
    }
  );

  server.tool(
    "add_component_property",
    "Add properties to components. Batch: pass multiple items.",
    { items: flexJson(z.array(propItem)).describe("Array of {componentId, propertyName, type, defaultValue, preferredValues?}") },
    async (params: any) => {
      try { return mcpJson(await sendCommand("add_component_property", params)); }
      catch (e) { return mcpError("Error adding component property", e); }
    }
  );

  server.tool(
    "create_instance_from_local",
    "Create instances of local components. For COMPONENT_SET, use variantProperties to pick a specific variant (e.g. {\"Style\":\"Secondary\"}). Batch: pass multiple items.",
    { items: flexJson(z.array(instanceItem)).describe("Array of {componentId, x?, y?, parentId?}") },
    async (params: any) => {
      try { return mcpJson(await sendCommand("create_instance_from_local", params)); }
      catch (e) { return mcpError("Error creating instance", e); }
    }
  );

  server.tool(
    "search_components",
    "Search local components and component sets across all pages. Returns component id, name, and which page it lives on.",
    {
      query: z.string().optional().describe("Filter by name (case-insensitive substring). Omit to list all."),
      setsOnly: flexBool(z.boolean()).optional().describe("If true, return only COMPONENT_SET nodes"),
      limit: z.coerce.number().optional().describe("Max results (default 100)"),
      offset: z.coerce.number().optional().describe("Skip N results (default 0)"),
    },
    async (params: any) => {
      try { return mcpJson(await sendCommand("search_components", params)); }
      catch (e) { return mcpError("Error searching components", e); }
    }
  );

  server.tool(
    "get_component_by_id",
    "Get detailed component info including property definitions and variants.",
    {
      componentId: z.string().describe("Component node ID"),
      includeChildren: flexBool(z.boolean()).optional().describe("For COMPONENT_SETs: include variant children (default false)"),
    },
    async (params: any) => {
      try { return mcpJson(await sendCommand("get_component_by_id", params)); }
      catch (e) { return mcpError("Error getting component", e); }
    }
  );

  server.tool(
    "get_instance_overrides",
    "Get override properties from a component instance.",
    { nodeId: z.string().optional().describe("Instance node ID (uses selection if omitted)") },
    async ({ nodeId }: any) => {
      try { return mcpJson(await sendCommand("get_instance_overrides", { instanceNodeId: nodeId || null })); }
      catch (e) { return mcpError("Error getting overrides", e); }
    }
  );

  server.tool(
    "set_instance_properties",
    "Set component property values on instances (e.g. text, boolean, instance swap). Use get_component_by_id to discover property keys. Batch: pass multiple items.",
    { items: flexJson(z.array(z.object({
      nodeId: S.nodeId,
      properties: flexJson(z.record(z.string(), z.union([z.string(), z.boolean()]))).describe('Property key→value map, e.g. {"Label#1:0":"Click Me"}'),
    }))).describe("Array of {nodeId, properties}"), depth: S.depth },
    async (params: any) => {
      try { return mcpJson(await sendCommand("set_instance_properties", params)); }
      catch (e) { return mcpError("Error setting instance properties", e); }
    }
  );
}

// ─── Figma Handlers ──────────────────────────────────────────────

async function resolvePaintStyle(name: string): Promise<{ id: string | null, available: string[] }> {
  const styles = await figma.getLocalPaintStylesAsync();
  const available = styles.map(s => s.name);
  const exact = styles.find(s => s.name === name);
  if (exact) return { id: exact.id, available };
  const fuzzy = styles.find(s => s.name.toLowerCase().includes(name.toLowerCase()));
  return { id: fuzzy?.id ?? null, available };
}

async function bindFillVariable(node: any, variableId: string, fallbackColor?: any) {
  const v = await findVariableById(variableId);
  if (!v) return false;
  node.fills = [solidPaint(fallbackColor || { r: 0, g: 0, b: 0 })];
  const bound = figma.variables.setBoundVariableForPaint(node.fills[0], "color", v);
  node.fills = [bound];
  return true;
}

async function bindStrokeVariable(node: any, variableId: string, fallbackColor?: any) {
  const v = await findVariableById(variableId);
  if (!v) return false;
  node.strokes = [solidPaint(fallbackColor || { r: 0, g: 0, b: 0 })];
  const bound = figma.variables.setBoundVariableForPaint(node.strokes[0], "color", v);
  node.strokes = [bound];
  return true;
}

async function createComponentSingle(p: any) {
  if (!p.name) throw new Error("Missing name");
  const {
    x = 0, y = 0, width = 100, height = 100, name, parentId,
    fillColor, fillStyleName, fillVariableId,
    strokeColor, strokeStyleName, strokeVariableId,
    strokeWeight, cornerRadius,
    layoutMode = "NONE", layoutWrap = "NO_WRAP",
    paddingTop = 0, paddingRight = 0, paddingBottom = 0, paddingLeft = 0,
    primaryAxisAlignItems = "MIN", counterAxisAlignItems = "MIN",
    layoutSizingHorizontal = "FIXED", layoutSizingVertical = "FIXED",
    itemSpacing = 0,
  } = p;

  const deferH = parentId && layoutSizingHorizontal === "FILL";
  const deferV = parentId && layoutSizingVertical === "FILL";

  const comp = figma.createComponent();
  comp.name = name;
  comp.x = x; comp.y = y;
  comp.resize(width, height);
  comp.fills = [];

  if (layoutMode !== "NONE") {
    comp.layoutMode = layoutMode;
    comp.layoutWrap = layoutWrap;
    comp.paddingTop = paddingTop; comp.paddingRight = paddingRight;
    comp.paddingBottom = paddingBottom; comp.paddingLeft = paddingLeft;
    comp.primaryAxisAlignItems = primaryAxisAlignItems;
    comp.counterAxisAlignItems = counterAxisAlignItems;
    comp.layoutSizingHorizontal = deferH ? "FIXED" : layoutSizingHorizontal;
    comp.layoutSizingVertical = deferV ? "FIXED" : layoutSizingVertical;
    comp.itemSpacing = itemSpacing;
  }

  // Fill: variableId > styleName > direct color
  const hints: string[] = [];
  if (fillVariableId) {
    const ok = await bindFillVariable(comp, fillVariableId, fillColor);
    if (!ok) hints.push(`fillVariableId '${fillVariableId}' not found.`);
  } else if (fillStyleName) {
    const { id: sid, available } = await resolvePaintStyle(fillStyleName);
    if (sid) {
      try { await (comp as any).setFillStyleIdAsync(sid); }
      catch (e: any) { hints.push(`fillStyleName '${fillStyleName}' matched but failed to apply: ${e.message}`); }
    } else hints.push(styleNotFoundHint("fillStyleName", fillStyleName, available));
  } else if (fillColor) {
    comp.fills = [solidPaint(fillColor)];
    const suggestion = await suggestStyleForColor(fillColor, "fillStyleName");
    if (suggestion) hints.push(suggestion);
  }

  // Stroke: variableId > styleName > direct color
  if (strokeVariableId) {
    const ok = await bindStrokeVariable(comp, strokeVariableId, strokeColor);
    if (!ok) hints.push(`strokeVariableId '${strokeVariableId}' not found.`);
  } else if (strokeStyleName) {
    const { id: sid, available } = await resolvePaintStyle(strokeStyleName);
    if (sid) {
      try { await (comp as any).setStrokeStyleIdAsync(sid); }
      catch (e: any) { hints.push(`strokeStyleName '${strokeStyleName}' matched but failed to apply: ${e.message}`); }
    } else hints.push(styleNotFoundHint("strokeStyleName", strokeStyleName, available));
  } else if (strokeColor) {
    comp.strokes = [solidPaint(strokeColor)];
    const suggestion = await suggestStyleForColor(strokeColor, "strokeStyleName");
    if (suggestion) hints.push(suggestion);
  }
  if (strokeWeight !== undefined) comp.strokeWeight = strokeWeight;
  if (cornerRadius !== undefined) comp.cornerRadius = cornerRadius;

  const parent = await appendToParent(comp, parentId);
  if (parent) {
    if (deferH) { try { comp.layoutSizingHorizontal = "FILL"; } catch {} }
    if (deferV) { try { comp.layoutSizingVertical = "FILL"; } catch {} }
  }

  const result: any = { id: comp.id };
  if (hints.length > 0) result.warning = hints.join(" ");
  return result;
}

async function fromNodeSingle(p: any) {
  const node = await figma.getNodeByIdAsync(p.nodeId);
  if (!node) throw new Error(`Node not found: ${p.nodeId}`);
  if (!("parent" in node) || !node.parent) throw new Error("Node has no parent");
  const parent = node.parent;
  const index = (parent as any).children.indexOf(node);
  const comp = figma.createComponent();
  comp.name = node.name;
  if ("width" in node && "height" in node) comp.resize((node as any).width, (node as any).height);
  if ("x" in node && "y" in node) { comp.x = (node as any).x; comp.y = (node as any).y; }
  const clone = (node as any).clone(); clone.x = 0; clone.y = 0;
  comp.appendChild(clone);
  (parent as any).insertChild(index, comp);
  node.remove();
  return { id: comp.id };
}

async function combineSingle(p: any) {
  if (!p.componentIds?.length || p.componentIds.length < 2) throw new Error("Need at least 2 components");
  const comps: ComponentNode[] = [];
  for (const id of p.componentIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) throw new Error(`Component not found: ${id}`);
    if (node.type !== "COMPONENT") throw new Error(`Node ${id} is not a COMPONENT`);
    comps.push(node as ComponentNode);
  }
  // Use common parent of components (falls back to currentPage)
  const parent = comps[0].parent && comps.every(c => c.parent === comps[0].parent)
    ? comps[0].parent : figma.currentPage;
  const set = figma.combineAsVariants(comps, parent as any);
  if (p.name) set.name = p.name;
  return { id: set.id };
}

async function addPropSingle(p: any) {
  const node = await figma.getNodeByIdAsync(p.componentId);
  if (!node) throw new Error(`Node not found: ${p.componentId}`);
  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") throw new Error(`Node ${p.componentId} is a ${node.type}, not a COMPONENT or COMPONENT_SET. Property definitions can only be added to COMPONENT_SET nodes (or standalone COMPONENT nodes not inside a set).`);
  (node as any).addComponentProperty(p.propertyName, p.type, p.defaultValue);
  return {};
}

async function instanceSingle(p: any) {
  let node: any = await figma.getNodeByIdAsync(p.componentId);
  if (!node) {
    // Component may be on another page — load all pages and retry
    await figma.loadAllPagesAsync();
    node = await figma.getNodeByIdAsync(p.componentId);
  }
  if (!node) throw new Error(`Component not found: ${p.componentId}`);
  if (node.type === "COMPONENT_SET") {
    if (!node.children?.length) throw new Error("Component set has no variants");
    // Match variant by properties if provided
    if (p.variantProperties && typeof p.variantProperties === "object") {
      const match = node.children.find((child: any) => {
        if (child.type !== "COMPONENT" || !child.variantProperties) return false;
        return Object.entries(p.variantProperties).every(
          ([k, v]) => child.variantProperties[k] === v
        );
      });
      if (match) node = match;
      else throw new Error(`No variant matching ${JSON.stringify(p.variantProperties)} in ${node.name}`);
    } else {
      node = node.defaultVariant || node.children[0];
    }
  }
  if (node.type !== "COMPONENT") throw new Error(`Not a component: ${node.type}`);
  const inst = node.createInstance();
  if (p.x !== undefined) inst.x = p.x;
  if (p.y !== undefined) inst.y = p.y;
  await appendToParent(inst, p.parentId);
  return { id: inst.id };
}

async function getLocalComponentsFigma(params: any) {
  await figma.loadAllPagesAsync();
  const setsOnly = params?.setsOnly;
  const types = setsOnly ? ["COMPONENT_SET"] : ["COMPONENT", "COMPONENT_SET"];
  let components = figma.root.findAllWithCriteria({ types: types as any });
  if (params?.query) {
    const f = params.query.toLowerCase();
    components = components.filter((c: any) => c.name.toLowerCase().includes(f));
  }
  const total = components.length;
  const limit = params?.limit || 100;
  const offset = params?.offset || 0;
  components = components.slice(offset, offset + limit);
  return {
    totalCount: total, returned: components.length, offset, limit,
    components: components.map((c: any) => {
      const e: any = { id: c.id, name: c.name, type: c.type };
      if (c.type === "COMPONENT_SET" && "children" in c) e.variantCount = c.children.length;
      if (c.description) e.description = c.description;
      // Walk up to find containing page
      let p = c.parent;
      while (p && p.type !== "PAGE") p = p.parent;
      if (p) { e.pageId = p.id; e.pageName = p.name; }
      return e;
    }),
  };
}

async function getComponentByIdFigma(params: any) {
  const node = await figma.getNodeByIdAsync(params.componentId);
  if (!node) throw new Error(`Component not found: ${params.componentId}`);
  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") throw new Error(`Not a component: ${node.type}`);
  const r: any = { id: node.id, name: node.name, type: node.type };
  if ("description" in node) r.description = (node as any).description;
  if (node.parent) { r.parentId = node.parent.id; r.parentName = node.parent.name; }
  if ("componentPropertyDefinitions" in node) r.propertyDefinitions = (node as any).componentPropertyDefinitions;
  if (node.type === "COMPONENT_SET" && "variantGroupProperties" in node) r.variantGroupProperties = (node as any).variantGroupProperties;
  if (node.type === "COMPONENT" && "variantProperties" in node) r.variantProperties = (node as any).variantProperties;
  if ("children" in node && (node as any).children) {
    if (node.type === "COMPONENT_SET") {
      r.variantCount = (node as any).children.length;
      if (params.includeChildren) r.children = (node as any).children.map((c: any) => ({ id: c.id, name: c.name, type: c.type }));
    } else {
      r.children = (node as any).children.map((c: any) => ({ id: c.id, name: c.name, type: c.type }));
    }
  }
  return r;
}

async function getInstanceOverridesFigma(params: any) {
  let inst: any = null;
  if (params?.instanceNodeId) {
    inst = await figma.getNodeByIdAsync(params.instanceNodeId);
    if (!inst) throw new Error(`Instance not found: ${params.instanceNodeId}`);
    if (inst.type !== "INSTANCE") throw new Error("Node is not an instance");
  } else {
    const sel = figma.currentPage.selection.filter((n: any) => n.type === "INSTANCE");
    if (!sel.length) throw new Error("No instance selected");
    inst = sel[0];
  }
  const overrides = inst.overrides || [];
  const main = await inst.getMainComponentAsync();
  return {
    mainComponentId: main?.id,
    overrides: overrides.map((o: any) => ({ id: o.id, fields: o.overriddenFields })),
  };
}

async function setInstancePropertiesSingle(p: any) {
  const node = await figma.getNodeByIdAsync(p.nodeId);
  if (!node) throw new Error(`Node not found: ${p.nodeId}`);
  if (node.type !== "INSTANCE") throw new Error(`Node ${p.nodeId} is ${node.type}, not an INSTANCE`);
  (node as InstanceNode).setProperties(p.properties);
  return {};
}

export const figmaHandlers: Record<string, (params: any) => Promise<any>> = {
  create_component: (p) => batchHandler(p, createComponentSingle),
  create_component_from_node: (p) => batchHandler(p, fromNodeSingle),
  combine_as_variants: (p) => batchHandler(p, combineSingle),
  add_component_property: (p) => batchHandler(p, addPropSingle),
  create_instance_from_local: (p) => batchHandler(p, instanceSingle),
  set_instance_properties: (p) => batchHandler(p, setInstancePropertiesSingle),
  search_components: getLocalComponentsFigma,
  get_component_by_id: getComponentByIdFigma,
  get_instance_overrides: getInstanceOverridesFigma,
};
