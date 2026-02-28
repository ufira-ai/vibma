import { z } from "zod";
import { flexJson, flexBool } from "../utils/coercion";
import * as S from "./schemas";
import type { McpServer, SendCommandFn } from "./types";
import { mcpJson, mcpError } from "./types";
import { findVariableById } from "./helpers";
import { formatContrastFailures } from "../utils/wcag";

// ─── Schemas ─────────────────────────────────────────────────────

const collectionItem = z.object({
  name: z.string().describe("Collection name"),
});

const variableItem = z.object({
  collectionId: z.string().describe("Variable collection ID"),
  name: z.string().describe("Variable name"),
  resolvedType: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]).describe("Variable type"),
});

const setValueItem = z.object({
  variableId: z.string().describe("Variable ID (use full ID from create_variable response, e.g. VariableID:1:6)"),
  modeId: z.string().describe("Mode ID"),
  value: flexJson(z.union([
    z.number(), z.string(), z.boolean(),
    z.object({ r: z.coerce.number(), g: z.coerce.number(), b: z.coerce.number(), a: z.coerce.number().optional() }),
  ])).describe("Value: number, string, boolean, or {r,g,b,a} color"),
});

const bindingItem = z.object({
  nodeId: z.string().describe("Node ID"),
  field: z.string().describe("Property field (e.g., 'opacity', 'fills/0/color')"),
  variableId: z.string().describe("Variable ID (use full ID from create_variable response, e.g. VariableID:1:6)"),
});

const addModeItem = z.object({
  collectionId: z.string().describe("Collection ID"),
  name: z.string().describe("Mode name"),
});

const renameModeItem = z.object({
  collectionId: z.string().describe("Collection ID"),
  modeId: z.string().describe("Mode ID"),
  name: z.string().describe("New name"),
});

const removeModeItem = z.object({
  collectionId: z.string().describe("Collection ID"),
  modeId: z.string().describe("Mode ID"),
});

const setExplicitModeItem = z.object({
  nodeId: S.nodeId,
  collectionId: z.string().describe("Variable collection ID"),
  modeId: z.string().describe("Mode ID to pin (e.g. Dark mode)"),
});

// ─── MCP Registration ────────────────────────────────────────────

export function registerMcpTools(server: McpServer, sendCommand: SendCommandFn) {
  server.tool(
    "create_variable_collection",
    "Create variable collections. Batch: pass multiple items.",
    { items: flexJson(z.array(collectionItem)).describe("Array of {name}") },
    async ({ items }: any) => {
      try { return mcpJson(await sendCommand("create_variable_collection", { items })); }
      catch (e) { return mcpError("Error creating variable collection", e); }
    }
  );

  server.tool(
    "create_variable",
    "Create variables in a collection. Batch: pass multiple items.",
    { items: flexJson(z.array(variableItem)).describe("Array of {collectionId, name, resolvedType}") },
    async ({ items }: any) => {
      try { return mcpJson(await sendCommand("create_variable", { items })); }
      catch (e) { return mcpError("Error creating variable", e); }
    }
  );

  server.tool(
    "set_variable_value",
    "Set variable values for modes. Batch: pass multiple items.",
    { items: flexJson(z.array(setValueItem)).describe("Array of {variableId, modeId, value}") },
    async ({ items }: any) => {
      try { return mcpJson(await sendCommand("set_variable_value", { items })); }
      catch (e) { return mcpError("Error setting variable value", e); }
    }
  );

  server.tool(
    "get_local_variables",
    "List local variables. Pass includeValues:true to get all mode values in bulk (avoids N separate get_variable_by_id calls).",
    {
      type: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]).optional().describe("Filter by type"),
      collectionId: z.string().optional().describe("Filter by collection. Omit for all collections."),
      includeValues: flexBool(z.boolean()).optional().describe("Include valuesByMode for each variable (default: false)"),
    },
    async (params: any) => {
      try { return mcpJson(await sendCommand("get_local_variables", params)); }
      catch (e) { return mcpError("Error getting variables", e); }
    }
  );

  server.tool(
    "get_local_variable_collections",
    "List all local variable collections.",
    {},
    async () => {
      try { return mcpJson(await sendCommand("get_local_variable_collections")); }
      catch (e) { return mcpError("Error getting variable collections", e); }
    }
  );

  server.tool(
    "get_variable_by_id",
    "Get detailed variable info including all mode values.",
    { variableId: z.string().describe("Variable ID") },
    async ({ variableId }: any) => {
      try { return mcpJson(await sendCommand("get_variable_by_id", { variableId })); }
      catch (e) { return mcpError("Error getting variable", e); }
    }
  );

  server.tool(
    "get_variable_collection_by_id",
    "Get detailed variable collection info including modes and variable IDs.",
    { collectionId: z.string().describe("Collection ID") },
    async ({ collectionId }: any) => {
      try { return mcpJson(await sendCommand("get_variable_collection_by_id", { collectionId })); }
      catch (e) { return mcpError("Error getting variable collection", e); }
    }
  );

  server.tool(
    "set_variable_binding",
    "Bind variables to node properties. Common fields: 'fills/0/color', 'strokes/0/color', 'opacity', 'topLeftRadius', 'itemSpacing'. Batch: pass multiple items.",
    { items: flexJson(z.array(bindingItem)).describe("Array of {nodeId, field, variableId}") },
    async ({ items }: any) => {
      try { return mcpJson(await sendCommand("set_variable_binding", { items })); }
      catch (e) { return mcpError("Error binding variable", e); }
    }
  );

  server.tool(
    "add_mode",
    "Add modes to variable collections. Batch: pass multiple items.",
    { items: flexJson(z.array(addModeItem)).describe("Array of {collectionId, name}") },
    async ({ items }: any) => {
      try { return mcpJson(await sendCommand("add_mode", { items })); }
      catch (e) { return mcpError("Error adding mode", e); }
    }
  );

  server.tool(
    "rename_mode",
    "Rename modes in variable collections. Batch: pass multiple items.",
    { items: flexJson(z.array(renameModeItem)).describe("Array of {collectionId, modeId, name}") },
    async ({ items }: any) => {
      try { return mcpJson(await sendCommand("rename_mode", { items })); }
      catch (e) { return mcpError("Error renaming mode", e); }
    }
  );

  server.tool(
    "remove_mode",
    "Remove modes from variable collections. Batch: pass multiple items.",
    { items: flexJson(z.array(removeModeItem)).describe("Array of {collectionId, modeId}") },
    async ({ items }: any) => {
      try { return mcpJson(await sendCommand("remove_mode", { items })); }
      catch (e) { return mcpError("Error removing mode", e); }
    }
  );

  server.tool(
    "set_explicit_variable_mode",
    "Pin a variable collection mode on a frame (e.g. show Dark mode). Batch: pass multiple items.",
    { items: flexJson(z.array(setExplicitModeItem)).describe("Array of {nodeId, collectionId, modeId}") },
    async ({ items }: any) => {
      try { return mcpJson(await sendCommand("set_explicit_variable_mode", { items })); }
      catch (e) { return mcpError("Error setting variable mode", e); }
    }
  );

  server.tool(
    "get_node_variables",
    "Get variable bindings on a node. Returns which variables are bound to fills, strokes, opacity, corner radius, etc.",
    { nodeId: S.nodeId },
    async ({ nodeId }: any) => {
      try { return mcpJson(await sendCommand("get_node_variables", { nodeId })); }
      catch (e) { return mcpError("Error getting node variables", e); }
    }
  );
}

// ─── Figma Handlers ──────────────────────────────────────────────

/** Resolve a variable collection by ID with scan fallback.
 *  Direct lookup can fail for recently-created collections. */
async function findCollectionById(id: string): Promise<any> {
  const direct = await figma.variables.getVariableCollectionByIdAsync(id);
  if (direct) return direct;
  const all = await figma.variables.getLocalVariableCollectionsAsync();
  return all.find(c => c.id === id) || null;
}

async function createCollectionSingle(p: any) {
  const collection = figma.variables.createVariableCollection(p.name);
  return { id: collection.id, modes: collection.modes, defaultModeId: collection.defaultModeId };
}

async function createVariableSingle(p: any) {
  const collection = await findCollectionById(p.collectionId);
  if (!collection) throw new Error(`Collection not found: ${p.collectionId}`);
  const variable = figma.variables.createVariable(p.name, collection, p.resolvedType);
  return { id: variable.id };
}

async function setValueSingle(p: any) {
  const variable = await findVariableById(p.variableId);
  if (!variable) throw new Error(`Variable not found: ${p.variableId}`);
  let value = p.value;
  if (typeof value === "object" && value !== null && "r" in value) {
    value = { r: value.r, g: value.g, b: value.b, a: value.a ?? 1 };
  }
  variable.setValueForMode(p.modeId, value);

  // WCAG contrast recommendation for COLOR variables
  const result: any = {};
  if (variable.resolvedType === "COLOR" && typeof value === "object" && "r" in value) {
    const collectionVars = await figma.variables.getLocalVariablesAsync("COLOR");
    const sameCollection = collectionVars.filter(
      (v: any) => v.variableCollectionId === variable.variableCollectionId && v.id !== variable.id
    );
    const existingColors: Array<{ name: string; color: { r: number; g: number; b: number } }> = [];
    for (const v of sameCollection) {
      const modeValue = v.valuesByMode?.[p.modeId];
      if (modeValue && typeof modeValue === "object" && "r" in modeValue) {
        existingColors.push({ name: v.name, color: modeValue as { r: number; g: number; b: number } });
      }
    }
    const contrastReport = formatContrastFailures(value, existingColors);
    if (contrastReport) result.warning = contrastReport;
  }

  return Object.keys(result).length === 0 ? {} : result;
}

async function getLocalVariablesFigma(params: any) {
  let variables = params?.type
    ? await figma.variables.getLocalVariablesAsync(params.type)
    : await figma.variables.getLocalVariablesAsync();
  if (params?.collectionId) variables = variables.filter((v: any) => v.variableCollectionId === params.collectionId);
  const includeValues = params?.includeValues === true;
  return {
    variables: variables.map((v: any) => {
      const entry: any = { id: v.id, name: v.name, resolvedType: v.resolvedType, variableCollectionId: v.variableCollectionId };
      if (includeValues) entry.valuesByMode = v.valuesByMode;
      return entry;
    }),
  };
}

async function getLocalCollectionsFigma() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  return {
    collections: collections.map((c: any) => ({ id: c.id, name: c.name, modes: c.modes, defaultModeId: c.defaultModeId, variableIds: c.variableIds })),
  };
}

async function getVariableByIdFigma(params: any) {
  const v = await findVariableById(params.variableId);
  if (!v) throw new Error(`Variable not found: ${params.variableId}`);
  return { id: v.id, name: v.name, resolvedType: v.resolvedType, variableCollectionId: v.variableCollectionId, valuesByMode: v.valuesByMode, description: v.description, scopes: v.scopes };
}

async function getCollectionByIdFigma(params: any) {
  const c = await findCollectionById(params.collectionId);
  if (!c) throw new Error(`Collection not found: ${params.collectionId}`);
  return { id: c.id, name: c.name, modes: c.modes, defaultModeId: c.defaultModeId, variableIds: c.variableIds };
}

async function setBindingSingle(p: any) {
  const node = await figma.getNodeByIdAsync(p.nodeId);
  if (!node) throw new Error(`Node not found: ${p.nodeId}`);
  const variable = await findVariableById(p.variableId);
  if (!variable) throw new Error(`Variable not found: ${p.variableId}`);

  const paintMatch = p.field.match(/^(fills|strokes)\/(\d+)\/color$/);
  if (paintMatch) {
    const prop = paintMatch[1];
    const index = parseInt(paintMatch[2], 10);
    if (!(prop in node)) throw new Error(`Node does not have ${prop}`);
    const paints = (node as any)[prop].slice();
    if (index >= paints.length) throw new Error(`${prop} index ${index} out of range`);
    const newPaint = figma.variables.setBoundVariableForPaint(paints[index], "color", variable);
    paints[index] = newPaint;
    (node as any)[prop] = paints;
  } else if ("setBoundVariable" in node) {
    (node as any).setBoundVariable(p.field, variable);
  } else {
    throw new Error("Node does not support variable binding");
  }
  return {};
}

async function addModeSingle(p: any) {
  const c = await findCollectionById(p.collectionId);
  if (!c) throw new Error(`Collection not found: ${p.collectionId}`);
  const modeId = c.addMode(p.name);
  return { modeId, modes: c.modes };
}

async function renameModeSingle(p: any) {
  const c = await findCollectionById(p.collectionId);
  if (!c) throw new Error(`Collection not found: ${p.collectionId}`);
  c.renameMode(p.modeId, p.name);
  return { modes: c.modes };
}

async function removeModeSingle(p: any) {
  const c = await findCollectionById(p.collectionId);
  if (!c) throw new Error(`Collection not found: ${p.collectionId}`);
  c.removeMode(p.modeId);
  return { modes: c.modes };
}

async function setExplicitModeSingle(p: any) {
  const node = await figma.getNodeByIdAsync(p.nodeId);
  if (!node) throw new Error(`Node not found: ${p.nodeId}`);
  if (!("setExplicitVariableModeForCollection" in node)) throw new Error(`Node ${p.nodeId} (${node.type}) does not support explicit variable modes. Use a FRAME, COMPONENT, or COMPONENT_SET.`);
  const collection = await findCollectionById(p.collectionId);
  if (!collection) throw new Error(`Collection not found: ${p.collectionId}`);
  try {
    (node as any).setExplicitVariableModeForCollection(collection, p.modeId);
  } catch (e: any) {
    throw new Error(`Failed to set mode '${p.modeId}' on node ${p.nodeId}: ${e.message}. Ensure the modeId is valid for collection '${collection.name}'.`);
  }
  return {};
}

async function getNodeVariablesFigma(params: any) {
  const node = await figma.getNodeByIdAsync(params.nodeId);
  if (!node) throw new Error(`Node not found: ${params.nodeId}`);
  const result: any = { nodeId: params.nodeId };
  if ("boundVariables" in node) {
    const bv = (node as any).boundVariables;
    if (bv && typeof bv === "object") {
      const bindings: Record<string, any> = {};
      for (const [key, val] of Object.entries(bv)) {
        if (Array.isArray(val)) {
          bindings[key] = val.map((v: any) => v?.id ? { variableId: v.id, field: v.field } : v);
        } else if (val && typeof val === "object" && (val as any).id) {
          bindings[key] = { variableId: (val as any).id, field: (val as any).field };
        }
      }
      result.boundVariables = bindings;
    }
  }
  if ("explicitVariableModes" in node) {
    result.explicitVariableModes = (node as any).explicitVariableModes;
  }
  return result;
}

async function batchHandler(params: any, fn: (item: any) => Promise<any>) {
  const items = params.items || [params];
  const results = [];
  for (const item of items) {
    try {
      const r = await fn(item);
      results.push(r && typeof r === "object" && Object.keys(r).length === 0 ? "ok" : r);
    }
    catch (e: any) { results.push({ error: e.message }); }
  }
  return { results };
}

export const figmaHandlers: Record<string, (params: any) => Promise<any>> = {
  create_variable_collection: (p) => batchHandler(p, createCollectionSingle),
  create_variable: (p) => batchHandler(p, createVariableSingle),
  set_variable_value: (p) => batchHandler(p, setValueSingle),
  get_local_variables: getLocalVariablesFigma,
  get_local_variable_collections: getLocalCollectionsFigma,
  get_variable_by_id: getVariableByIdFigma,
  get_variable_collection_by_id: getCollectionByIdFigma,
  set_variable_binding: (p) => batchHandler(p, setBindingSingle),
  add_mode: (p) => batchHandler(p, addModeSingle),
  rename_mode: (p) => batchHandler(p, renameModeSingle),
  remove_mode: (p) => batchHandler(p, removeModeSingle),
  set_explicit_variable_mode: (p) => batchHandler(p, setExplicitModeSingle),
  get_node_variables: getNodeVariablesFigma,
};
