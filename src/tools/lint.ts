import { z } from "zod";
import { flexJson, flexBool } from "../utils/coercion";
import * as S from "./schemas";
import type { McpServer, SendCommandFn } from "./types";
import { mcpJson, mcpError } from "./types";
import { batchHandler } from "./helpers";
import { rgbaToHex } from "../utils/color";
import {
  alphaComposite, checkContrastPair, isLargeText, inferFontWeight,
  looksInteractive, type SolidColor,
} from "../utils/wcag";

// ─── Schemas ─────────────────────────────────────────────────────

const WCAG_RULES = [
  "wcag-contrast", "wcag-contrast-enhanced", "wcag-non-text-contrast",
  "wcag-target-size", "wcag-text-size", "wcag-line-height",
] as const;

const lintRules = z.enum([
  "no-autolayout",           // Frames with >1 child and no auto-layout
  "shape-instead-of-frame",  // Shapes used where FRAME should be
  "hardcoded-color",         // Fills/strokes not using styles
  "no-text-style",           // Text nodes without text style
  "fixed-in-autolayout",     // Fixed-size children in auto-layout parents
  "default-name",            // Nodes with default/unnamed names
  "empty-container",         // Frames/components with layout but no children
  "stale-text-name",         // Text nodes where layer name diverges from content
  "no-text-property",        // Text in components not bound to a component property
  // ── WCAG 2.2 rules ──
  "wcag-contrast",           // 1.4.3 AA text contrast (4.5:1 / 3:1 large)
  "wcag-contrast-enhanced",  // 1.4.6 AAA text contrast (7:1 / 4.5:1 large)
  "wcag-non-text-contrast",  // 1.4.11 AA non-text contrast (3:1)
  "wcag-target-size",        // 2.5.8 AA target size minimum (24x24px)
  "wcag-text-size",          // Best practice: minimum readable text (12px)
  "wcag-line-height",        // 1.4.12 AA text spacing (line height 1.5x)
  "wcag",                    // Meta: run all wcag-* rules
  "all",                     // Run all rules (including WCAG)
]);

// ─── MCP Registration ────────────────────────────────────────────

export function registerMcpTools(server: McpServer, sendCommand: SendCommandFn) {
  server.tool(
    "lint_node",
    "Run design linter on a node tree. Returns issues grouped by category with affected node IDs and fix instructions. Lint child nodes individually for large trees.",
    {
      nodeId: z.string().optional().describe("Node ID to lint. Omit to lint current selection."),
      rules: flexJson(z.array(lintRules)).optional().describe('Rules to run. Default: ["all"]. Options: no-autolayout, shape-instead-of-frame, hardcoded-color, no-text-style, fixed-in-autolayout, default-name, empty-container, stale-text-name, no-text-property, all, wcag-contrast, wcag-contrast-enhanced, wcag-non-text-contrast, wcag-target-size, wcag-text-size, wcag-line-height, wcag'),
      maxDepth: z.coerce.number().optional().describe("Max depth to recurse (default: 10)"),
      maxFindings: z.coerce.number().optional().describe("Stop after N findings (default: 50)"),
    },
    async (params: any) => {
      try { return mcpJson(await sendCommand("lint_node", params)); }
      catch (e) { return mcpError("Error running lint", e); }
    }
  );

  server.tool(
    "lint_fix_autolayout",
    "Auto-fix: convert frames with multiple children to auto-layout. Takes node IDs from lint_node 'no-autolayout' results.",
    {
      items: flexJson(z.array(z.object({
        nodeId: S.nodeId,
        layoutMode: z.enum(["HORIZONTAL", "VERTICAL"]).optional().describe("Layout direction (default: auto-detect based on child positions)"),
        itemSpacing: z.coerce.number().optional().describe("Spacing between children (default: 0)"),
      }))).describe("Array of frames to convert to auto-layout"),
      depth: S.depth,
    },
    async (params: any) => {
      try { return mcpJson(await sendCommand("lint_fix_autolayout", params)); }
      catch (e) { return mcpError("Error fixing auto-layout", e); }
    }
  );

  server.tool(
    "lint_fix_replace_shape_with_frame",
    "Auto-fix: replace shapes with frames preserving visual properties. Overlapping siblings are re-parented into the new frame. Use after lint_node 'shape-instead-of-frame' results.",
    {
      items: flexJson(z.array(z.object({
        nodeId: S.nodeId,
        adoptChildren: flexBool(z.boolean()).optional().describe("Re-parent overlapping siblings into the new frame (default: true)"),
      }))).describe("Array of shapes to convert to frames"),
      depth: S.depth,
    },
    async (params: any) => {
      try { return mcpJson(await sendCommand("lint_fix_replace_shape_with_frame", params)); }
      catch (e) { return mcpError("Error converting shapes to frames", e); }
    }
  );
}

// ─── Figma Handlers ──────────────────────────────────────────────

/** Collected issue: just rule + nodeId. Grouping and prose happen at the end. */
interface Issue {
  rule: string;
  nodeId: string;
  nodeName: string;
  /** Extra context for the prose generator */
  extra?: Record<string, any>;
}

async function lintNodeHandler(params: any): Promise<any> {
  const ruleSet = new Set<string>(params?.rules || ["all"]);
  const runAll = ruleSet.has("all");
  // Expand "wcag" meta-rule into individual wcag-* rules
  if (ruleSet.has("wcag") || runAll) {
    for (const r of WCAG_RULES) ruleSet.add(r);
  }
  const runWcag = WCAG_RULES.some(r => ruleSet.has(r));
  const maxDepth = params?.maxDepth ?? 10;
  const maxFindings = params?.maxFindings ?? 50;

  // Get root node
  let root: BaseNode;
  if (params?.nodeId) {
    const node = await figma.getNodeByIdAsync(params.nodeId);
    if (!node) throw new Error(`Node not found: ${params.nodeId}`);
    root = node;
  } else {
    const sel = figma.currentPage.selection;
    if (sel.length === 0) throw new Error("Nothing selected and no nodeId provided");
    root = sel.length === 1 ? sel[0] : figma.currentPage;
  }

  // Collect local styles for checks
  let localPaintStyleIds = new Set<string>();
  let localTextStyleIds = new Set<string>();
  if (runAll || ruleSet.has("hardcoded-color")) {
    const paints = await figma.getLocalPaintStylesAsync();
    localPaintStyleIds = new Set(paints.map(s => s.id));
  }
  if (runAll || ruleSet.has("no-text-style")) {
    const texts = await figma.getLocalTextStylesAsync();
    localTextStyleIds = new Set(texts.map(s => s.id));
  }

  const issues: Issue[] = [];
  const ctx: LintCtx = { runAll, ruleSet, maxDepth, maxFindings, localPaintStyleIds, localTextStyleIds, hasPaintStyles: localPaintStyleIds.size > 0, hasTextStyles: localTextStyleIds.size > 0, runWcag };

  await walkNode(root, 0, issues, ctx);

  const truncated = issues.length >= maxFindings;

  // Group by rule → prose output
  const grouped: Record<string, Issue[]> = {};
  for (const issue of issues) {
    if (!grouped[issue.rule]) grouped[issue.rule] = [];
    grouped[issue.rule].push(issue);
  }

  const categories: any[] = [];
  for (const [rule, ruleIssues] of Object.entries(grouped)) {
    categories.push({
      rule,
      count: ruleIssues.length,
      fix: FIX_INSTRUCTIONS[rule] || "Review and fix manually.",
      nodes: ruleIssues.map(i => {
        const entry: any = { id: i.nodeId, name: i.nodeName };
        if (i.extra) Object.assign(entry, i.extra);
        return entry;
      }),
    });
  }

  const result: any = { nodeId: root.id, nodeName: root.name, categories };
  if (truncated) {
    const breakdown = categories.map(c => `${c.rule}: ${c.count}`).join(", ");
    result.warning = `Showing first ${maxFindings} findings (${breakdown}). Increase maxFindings or lint specific rules (e.g. rules: ["hardcoded-color"]) to see more.`;
  }
  return result;
}

/** Per-rule fix instructions — natural language, actionable, referencing MCP tools */
const FIX_INSTRUCTIONS: Record<string, string> = {
  "no-autolayout": "Use lint_fix_autolayout or update_frame with layoutMode to add auto-layout to these frames.",
  "shape-instead-of-frame": "Use lint_fix_replace_shape_with_frame to convert these shapes to frames with children.",
  "hardcoded-color": "Use set_fill_color with styleName to apply a paint style, or set_variable_binding to bind to a color variable.",
  "no-text-style": "Use apply_style_to_node with styleType:\"text\" and styleName, or set_variable_binding to bind text properties to variables.",
  "fixed-in-autolayout": "Use update_frame with layoutSizingHorizontal/layoutSizingVertical to set FILL or HUG instead of FIXED sizing.",
  "default-name": "Use set_node_properties to give descriptive names.",
  "empty-container": "These frames or components have auto-layout but no children. Delete them or add content.",
  "stale-text-name": "These text nodes have layer names that don't match their content. Use set_node_properties to rename, or leave if intentional.",
  "no-text-property": "Use add_component_property to create a TEXT property on the component set, then set_node_properties with componentPropertyReferences: {characters: \"PropertyKey#id\"} to bind.",
  // ── WCAG fix instructions ──
  "wcag-contrast": "Adjust fill or background to meet AA (4.5:1, 3:1 large text).",
  "wcag-contrast-enhanced": "Adjust to meet AAA (7:1, 4.5:1 large text).",
  "wcag-non-text-contrast": "Need 3:1 against parent background. Adjust via set_fill_color.",
  "wcag-target-size": "Resize to 24×24px min via resize_node or add padding.",
  "wcag-text-size": "Increase to 12px min via set_text_properties.",
  "wcag-line-height": "Increase line height to 1.5× font size.",
};

interface LintCtx {
  runAll: boolean;
  ruleSet: Set<string>;
  maxDepth: number;
  maxFindings: number;
  localPaintStyleIds: Set<string>;
  localTextStyleIds: Set<string>;
  hasPaintStyles: boolean;
  hasTextStyles: boolean;
  runWcag: boolean;
}

async function walkNode(node: BaseNode, depth: number, issues: Issue[], ctx: LintCtx) {
  if (issues.length >= ctx.maxFindings) return;
  if (depth > ctx.maxDepth) return;

  // ── Rule: no-autolayout ──
  if (ctx.runAll || ctx.ruleSet.has("no-autolayout")) {
    if (isFrame(node) && node.layoutMode === "NONE" && "children" in node) {
      const childCount = (node as any).children.length;
      if (childCount > 1) {
        const direction = detectLayoutDirection(node as FrameNode);
        issues.push({ rule: "no-autolayout", nodeId: node.id, nodeName: node.name, extra: { suggestedDirection: direction } });
        if (issues.length >= ctx.maxFindings) return;
      }
    }
  }

  // ── Rule: shape-instead-of-frame ──
  if (ctx.runAll || ctx.ruleSet.has("shape-instead-of-frame")) {
    if (isShape(node) && node.parent && "children" in node.parent) {
      const siblings = (node.parent as any).children as SceneNode[];
      const bounds = getAbsoluteBounds(node as SceneNode);
      if (bounds) {
        const overlapping = siblings.filter(s => {
          if (s.id === node.id) return false;
          const sb = getAbsoluteBounds(s);
          if (!sb) return false;
          return sb.x >= bounds.x && sb.y >= bounds.y
            && sb.x + sb.width <= bounds.x + bounds.width
            && sb.y + sb.height <= bounds.y + bounds.height;
        });
        if (overlapping.length > 0) {
          issues.push({ rule: "shape-instead-of-frame", nodeId: node.id, nodeName: node.name, extra: { overlappingIds: overlapping.map(s => s.id) } });
          if (issues.length >= ctx.maxFindings) return;
        }
      }
    }
  }

  // ── Rule: hardcoded-color ──
  if ((ctx.runAll || ctx.ruleSet.has("hardcoded-color")) && ctx.hasPaintStyles) {
    if ("fills" in node && "fillStyleId" in node) {
      const fills = (node as any).fills;
      const fillStyleId = (node as any).fillStyleId;
      const hasFillVar = (node as any).boundVariables?.fills?.length > 0;
      if (fills && Array.isArray(fills) && fills.length > 0 && fills[0].type === "SOLID") {
        if (!hasFillVar && (!fillStyleId || fillStyleId === "" || fillStyleId === figma.mixed)) {
          issues.push({ rule: "hardcoded-color", nodeId: node.id, nodeName: node.name });
          if (issues.length >= ctx.maxFindings) return;
        }
      }
    }
  }

  // ── Rule: no-text-style ──
  if ((ctx.runAll || ctx.ruleSet.has("no-text-style")) && ctx.hasTextStyles) {
    if (node.type === "TEXT") {
      const textStyleId = (node as any).textStyleId;
      const hasTextVar = (node as any).boundVariables && Object.keys((node as any).boundVariables).length > 0;
      if (!hasTextVar && (!textStyleId || textStyleId === "" || textStyleId === figma.mixed)) {
        issues.push({ rule: "no-text-style", nodeId: node.id, nodeName: node.name });
        if (issues.length >= ctx.maxFindings) return;
      }
    }
  }

  // ── Rule: fixed-in-autolayout ──
  if (ctx.runAll || ctx.ruleSet.has("fixed-in-autolayout")) {
    if (isFrame(node) && node.layoutMode !== "NONE" && "children" in node) {
      for (const child of (node as any).children) {
        if (issues.length >= ctx.maxFindings) break;
        if (!("layoutSizingHorizontal" in child)) continue;
        if (child.layoutSizingHorizontal === "FIXED" && child.layoutSizingVertical === "FIXED") {
          issues.push({ rule: "fixed-in-autolayout", nodeId: child.id, nodeName: child.name, extra: { parentId: node.id, axis: node.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical" } });
        }
      }
      if (issues.length >= ctx.maxFindings) return;
    }
  }

  // ── Rule: default-name ──
  if (ctx.runAll || ctx.ruleSet.has("default-name")) {
    const defaultNames = ["Frame", "Rectangle", "Ellipse", "Line", "Text", "Group", "Component", "Instance", "Section", "Vector"];
    const isDefault = defaultNames.some(d => node.name === d || /^.+ \d+$/.test(node.name) && node.name.startsWith(d));
    if (isDefault && node.type !== "PAGE") {
      issues.push({ rule: "default-name", nodeId: node.id, nodeName: node.name });
      if (issues.length >= ctx.maxFindings) return;
    }
  }

  // ── Rule: empty-container ──
  if (ctx.runAll || ctx.ruleSet.has("empty-container")) {
    if (isFrame(node) && "children" in node && (node as any).children.length === 0) {
      issues.push({ rule: "empty-container", nodeId: node.id, nodeName: node.name });
      if (issues.length >= ctx.maxFindings) return;
    }
  }

  // ── Rule: stale-text-name ──
  if (ctx.runAll || ctx.ruleSet.has("stale-text-name")) {
    if (node.type === "TEXT") {
      const chars = (node as any).characters as string;
      // Only flag if both name and characters are non-empty and they differ
      if (chars && node.name && node.name !== chars && node.name !== chars.slice(0, node.name.length)) {
        issues.push({ rule: "stale-text-name", nodeId: node.id, nodeName: node.name, extra: { characters: chars.slice(0, 60) } });
        if (issues.length >= ctx.maxFindings) return;
      }
    }
  }

  // ── Rule: no-text-property ──
  if (ctx.runAll || ctx.ruleSet.has("no-text-property")) {
    if (node.type === "TEXT" && isInsideComponent(node)) {
      const refs = (node as any).componentPropertyReferences;
      if (!refs || !refs.characters) {
        issues.push({ rule: "no-text-property", nodeId: node.id, nodeName: node.name });
        if (issues.length >= ctx.maxFindings) return;
      }
    }
  }

  // ── WCAG Rules ──────────────────────────────────────────────────

  // ── Rule: wcag-contrast + wcag-contrast-enhanced ──
  if (ctx.runWcag && (ctx.ruleSet.has("wcag-contrast") || ctx.ruleSet.has("wcag-contrast-enhanced"))) {
    if (node.type === "TEXT") {
      const textNode = node as any;
      const fontSize = textNode.fontSize;
      const fontName = textNode.fontName;

      // Skip if fontSize or fontName is mixed (multiple styles in one text node)
      if (fontSize !== figma.mixed && fontName !== figma.mixed) {
        const fgColor = getTextFillColor(textNode);
        if (fgColor) {
          const bgColor = resolveBackgroundColor(node);
          if (bgColor !== null) {
            // Composite foreground over background accounting for opacity
            const nodeOpacity = getEffectiveOpacity(node);
            const effectiveAlpha = fgColor.a * nodeOpacity;
            const composited = alphaComposite(
              fgColor.r, fgColor.g, fgColor.b, effectiveAlpha,
              bgColor.r, bgColor.g, bgColor.b,
            );

            const fontWeight = inferFontWeight((fontName as FontName).style);
            const large = isLargeText(fontSize as number, fontWeight);
            const result = checkContrastPair(composited, bgColor, large);

            const fgHex = rgbaToHex({ ...fgColor, a: effectiveAlpha });
            const bgHex = rgbaToHex({ r: bgColor.r, g: bgColor.g, b: bgColor.b, a: 1 });

            // AA check
            if (ctx.ruleSet.has("wcag-contrast") && !result.passesAA) {
              issues.push({
                rule: "wcag-contrast",
                nodeId: node.id,
                nodeName: node.name,
                extra: {
                  ratio: result.ratio,
                  required: result.aaRequired,
                  level: "AA",
                  foreground: fgHex,
                  background: bgHex,
                  fontSize: fontSize as number,
                  fontWeight,
                  isLargeText: large,
                },
              });
              if (issues.length >= ctx.maxFindings) return;
            }

            // AAA check (only if AA passes but AAA fails)
            if (ctx.ruleSet.has("wcag-contrast-enhanced") && result.passesAA && !result.passesAAA) {
              issues.push({
                rule: "wcag-contrast-enhanced",
                nodeId: node.id,
                nodeName: node.name,
                extra: {
                  ratio: result.ratio,
                  required: result.aaaRequired,
                  level: "AAA",
                  foreground: fgHex,
                  background: bgHex,
                  fontSize: fontSize as number,
                  fontWeight,
                  isLargeText: large,
                },
              });
              if (issues.length >= ctx.maxFindings) return;
            }
          }
        }
      }
    }
  }

  // ── Rule: wcag-non-text-contrast ──
  if (ctx.runWcag && ctx.ruleSet.has("wcag-non-text-contrast")) {
    // Check frames, shapes, and components with fills against their parent's fill
    if (node.type !== "TEXT" && node.type !== "PAGE" && "fills" in node) {
      const nodeFill = getNodeFillColor(node);
      if (nodeFill && node.parent) {
        const parentFill = resolveBackgroundColor(node);
        if (parentFill !== null) {
          const result = checkContrastPair(nodeFill, parentFill);
          if (result.ratio < 3.0) {
            const nodeHex = rgbaToHex({ ...nodeFill, a: 1 });
            const parentHex = rgbaToHex({ r: parentFill.r, g: parentFill.g, b: parentFill.b, a: 1 });
            issues.push({
              rule: "wcag-non-text-contrast",
              nodeId: node.id,
              nodeName: node.name,
              extra: {
                ratio: result.ratio,
                required: 3.0,
                level: "AA",
                fill: nodeHex,
                background: parentHex,
              },
            });
            if (issues.length >= ctx.maxFindings) return;
          }
        }
      }
    }
  }

  // ── Rule: wcag-target-size ──
  if (ctx.runWcag && ctx.ruleSet.has("wcag-target-size")) {
    if (looksInteractive(node) && "width" in node && "height" in node) {
      const w = (node as any).width as number;
      const h = (node as any).height as number;
      const MIN_TARGET = 24;

      if (w < MIN_TARGET || h < MIN_TARGET) {
        issues.push({
          rule: "wcag-target-size",
          nodeId: node.id,
          nodeName: node.name,
          extra: {
            width: Math.round(w * 100) / 100,
            height: Math.round(h * 100) / 100,
            minimumRequired: MIN_TARGET,
            failingDimension: w < MIN_TARGET && h < MIN_TARGET ? "both"
              : w < MIN_TARGET ? "width" : "height",
          },
        });
        if (issues.length >= ctx.maxFindings) return;
      }
    }
  }

  // ── Rule: wcag-text-size ──
  if (ctx.runWcag && ctx.ruleSet.has("wcag-text-size")) {
    if (node.type === "TEXT") {
      const fontSize = (node as any).fontSize;
      if (fontSize !== figma.mixed && typeof fontSize === "number" && fontSize < 12) {
        issues.push({
          rule: "wcag-text-size",
          nodeId: node.id,
          nodeName: node.name,
          extra: { fontSize, minimumRecommended: 12 },
        });
        if (issues.length >= ctx.maxFindings) return;
      }
    }
  }

  // ── Rule: wcag-line-height ──
  if (ctx.runWcag && ctx.ruleSet.has("wcag-line-height")) {
    if (node.type === "TEXT") {
      const textNode = node as any;
      const fontSize = textNode.fontSize;
      const lineHeight = textNode.lineHeight;

      if (fontSize !== figma.mixed && lineHeight !== figma.mixed) {
        const fs = fontSize as number;
        const lh = lineHeight as { unit: string; value: number };
        let lineHeightPx: number | null = null;

        if (lh.unit === "PIXELS") {
          lineHeightPx = lh.value;
        } else if (lh.unit === "PERCENT") {
          lineHeightPx = (lh.value / 100) * fs;
        }
        // Skip "AUTO" — platform default, flagging it would be too noisy

        if (lineHeightPx !== null) {
          const ratio = lineHeightPx / fs;
          const REQUIRED_RATIO = 1.5;

          if (ratio < REQUIRED_RATIO) {
            issues.push({
              rule: "wcag-line-height",
              nodeId: node.id,
              nodeName: node.name,
              extra: {
                lineHeightPx: Math.round(lineHeightPx * 100) / 100,
                fontSize: fs,
                ratio: Math.round(ratio * 100) / 100,
                requiredRatio: REQUIRED_RATIO,
                recommendedLineHeight: Math.ceil(fs * REQUIRED_RATIO),
              },
            });
            if (issues.length >= ctx.maxFindings) return;
          }
        }
      }
    }
  }

  // Recurse into children
  if ("children" in node) {
    for (const child of (node as any).children) {
      if (issues.length >= ctx.maxFindings) break;
      await walkNode(child, depth + 1, issues, ctx);
    }
  }
}

function isFrame(node: BaseNode): node is FrameNode {
  return node.type === "FRAME" || node.type === "COMPONENT" || node.type === "COMPONENT_SET";
}

function isInsideComponent(node: BaseNode): boolean {
  let p = node.parent;
  while (p) {
    if (p.type === "COMPONENT" || p.type === "COMPONENT_SET") return true;
    p = p.parent;
  }
  return false;
}

const SHAPE_TYPES = new Set(["RECTANGLE", "ELLIPSE", "POLYGON", "STAR", "VECTOR", "LINE"]);
function isShape(node: BaseNode): boolean {
  return SHAPE_TYPES.has(node.type);
}

function getAbsoluteBounds(node: SceneNode): { x: number; y: number; width: number; height: number } | null {
  if ("absoluteBoundingBox" in node && (node as any).absoluteBoundingBox) {
    return (node as any).absoluteBoundingBox;
  }
  if ("x" in node && "width" in node) {
    return { x: (node as any).x, y: (node as any).y, width: (node as any).width, height: (node as any).height };
  }
  return null;
}

function detectLayoutDirection(frame: FrameNode): "VERTICAL" | "HORIZONTAL" {
  const children = frame.children;
  if (children.length < 2) return "VERTICAL";
  let xVariance = 0;
  let yVariance = 0;
  for (let i = 1; i < children.length; i++) {
    xVariance += Math.abs(children[i].x - children[i - 1].x);
    yVariance += Math.abs(children[i].y - children[i - 1].y);
  }
  return yVariance >= xVariance ? "VERTICAL" : "HORIZONTAL";
}

// ── WCAG Figma Helpers ──────────────────────────────────────────

/**
 * Get the effective foreground solid color of a text node.
 * Returns null if fills are mixed, empty, non-solid, or invisible.
 */
function getTextFillColor(node: any): SolidColor | null {
  const fills = node.fills;
  if (fills === figma.mixed) return null;
  if (!Array.isArray(fills) || fills.length === 0) return null;

  // Use the last visible SOLID fill (topmost in Figma's paint stack)
  for (let i = fills.length - 1; i >= 0; i--) {
    const fill = fills[i];
    if (fill.visible === false) continue;
    if (fill.type !== "SOLID") return null; // gradient/image — cannot check
    return { r: fill.color.r, g: fill.color.g, b: fill.color.b, a: fill.opacity ?? 1 };
  }
  return null;
}

/**
 * Get the first visible solid fill color from any node.
 * Used for non-text contrast checks.
 */
function getNodeFillColor(node: BaseNode): { r: number; g: number; b: number } | null {
  if (!("fills" in node)) return null;
  const fills = (node as any).fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return null;

  for (let i = fills.length - 1; i >= 0; i--) {
    const fill = fills[i];
    if (fill.visible === false) continue;
    if (fill.type !== "SOLID") return null;
    return { r: fill.color.r, g: fill.color.g, b: fill.color.b };
  }
  return null;
}

/**
 * Resolve the effective background color behind a node by walking up
 * the ancestor chain and compositing solid fills.
 * Returns null if any ancestor has a gradient/image fill (cannot compute).
 */
function resolveBackgroundColor(node: BaseNode): { r: number; g: number; b: number } | null {
  // Start with white (WCAG default assumption for unknown background)
  let bgR = 1, bgG = 1, bgB = 1;

  // Collect ancestors from parent to root, then process root-to-leaf
  const ancestors: BaseNode[] = [];
  let current = node.parent;
  while (current) {
    ancestors.push(current);
    current = current.parent;
  }
  ancestors.reverse();

  for (const ancestor of ancestors) {
    if (!("fills" in ancestor)) continue;
    const fills = (ancestor as any).fills;
    if (fills === figma.mixed || !Array.isArray(fills)) continue;

    for (const fill of fills) {
      if (fill.visible === false) continue;

      if (fill.type === "SOLID") {
        const fillOpacity = fill.opacity ?? 1;
        const nodeOpacity = ("opacity" in ancestor) ? ((ancestor as any).opacity ?? 1) : 1;
        const effectiveAlpha = fillOpacity * nodeOpacity;

        if (effectiveAlpha >= 0.999) {
          bgR = fill.color.r;
          bgG = fill.color.g;
          bgB = fill.color.b;
        } else {
          const c = alphaComposite(fill.color.r, fill.color.g, fill.color.b, effectiveAlpha, bgR, bgG, bgB);
          bgR = c.r;
          bgG = c.g;
          bgB = c.b;
        }
      } else if (fill.type !== "SOLID") {
        // Gradient, image, video — cannot compute contrast reliably
        return null;
      }
    }
  }

  return { r: bgR, g: bgG, b: bgB };
}

/**
 * Walk from a node up to root, multiplying opacity at each level.
 * Figma's opacity is per-node and compounds visually.
 */
function getEffectiveOpacity(node: BaseNode): number {
  let opacity = 1;
  let current: BaseNode | null = node;
  while (current) {
    if ("opacity" in current) {
      opacity *= (current as any).opacity ?? 1;
    }
    current = current.parent;
  }
  return opacity;
}

// ── Auto-fix handlers ──

async function fixAutolayoutSingle(p: any) {
  const node = await figma.getNodeByIdAsync(p.nodeId);
  if (!node) throw new Error(`Node not found: ${p.nodeId}`);
  if (!isFrame(node)) throw new Error(`Node ${p.nodeId} is ${node.type}, not a FRAME`);
  if (node.layoutMode !== "NONE") return { skipped: true, reason: "Already has auto-layout" };

  const direction = p.layoutMode || detectLayoutDirection(node);
  node.layoutMode = direction;
  if (p.itemSpacing !== undefined) {
    node.itemSpacing = p.itemSpacing;
  }
  return { layoutMode: direction };
}

async function fixShapeToFrameSingle(p: any) {
  const shape = await figma.getNodeByIdAsync(p.nodeId);
  if (!shape) throw new Error(`Node not found: ${p.nodeId}`);
  if (!isShape(shape)) throw new Error(`Node ${p.nodeId} is ${shape.type}, not a shape (RECTANGLE, ELLIPSE, etc.)`);

  const parent = shape.parent;
  if (!parent || !("children" in parent)) throw new Error(`Shape has no valid parent`);

  const s = shape as any;
  const frame = figma.createFrame();
  frame.name = s.name || "Container";
  frame.x = s.x;
  frame.y = s.y;
  frame.resize(s.width, s.height);

  // Copy visual properties
  if (s.fills) frame.fills = s.fills;
  if (s.strokes) frame.strokes = s.strokes;
  if (s.strokeWeight !== undefined) frame.strokeWeight = s.strokeWeight;
  if (s.strokeAlign) frame.strokeAlign = s.strokeAlign;
  if (s.opacity !== undefined) frame.opacity = s.opacity;
  if (s.cornerRadius !== undefined && s.cornerRadius !== figma.mixed) {
    frame.cornerRadius = s.cornerRadius;
  } else if ("topLeftRadius" in s) {
    frame.topLeftRadius = s.topLeftRadius;
    frame.topRightRadius = s.topRightRadius;
    frame.bottomRightRadius = s.bottomRightRadius;
    frame.bottomLeftRadius = s.bottomLeftRadius;
  }
  if (s.effects) frame.effects = s.effects;
  if (s.blendMode) frame.blendMode = s.blendMode;
  frame.clipsContent = true;

  // Insert frame at the shape's position in parent
  const shapeIndex = (parent as any).children.indexOf(shape);
  (parent as any).insertChild(shapeIndex, frame);

  // Adopt overlapping siblings if requested (default: true)
  const adoptChildren = p.adoptChildren !== false;
  const adopted: string[] = [];
  if (adoptChildren) {
    const shapeBounds = { x: s.x, y: s.y, width: s.width, height: s.height };
    const siblings = (parent as any).children as SceneNode[];
    const toAdopt: SceneNode[] = [];
    for (const sib of siblings) {
      if (sib.id === shape.id || sib.id === frame.id) continue;
      if (!("x" in sib) || !("width" in sib)) continue;
      const sx = (sib as any).x, sy = (sib as any).y;
      const sw = (sib as any).width, sh = (sib as any).height;
      if (sx >= shapeBounds.x && sy >= shapeBounds.y
        && sx + sw <= shapeBounds.x + shapeBounds.width
        && sy + sh <= shapeBounds.y + shapeBounds.height) {
        toAdopt.push(sib);
      }
    }
    for (const child of toAdopt) {
      (child as any).x -= frame.x;
      (child as any).y -= frame.y;
      frame.appendChild(child);
      adopted.push(child.id);
    }
  }

  shape.remove();
  return { id: frame.id, adoptedChildren: adopted };
}

export const figmaHandlers: Record<string, (params: any) => Promise<any>> = {
  lint_node: lintNodeHandler,
  lint_fix_autolayout: (p) => batchHandler(p, fixAutolayoutSingle),
  lint_fix_replace_shape_with_frame: (p) => batchHandler(p, fixShapeToFrameSingle),
};
