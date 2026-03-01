import { rgbaToHex } from "./color";

/**
 * Serialize a Figma plugin node to a plain object using only the plugin API.
 * This replaces the exportAsync({ format: "JSON_REST_V1" }) + filterFigmaNode
 * approach, which returned REST API IDs that could differ from plugin node.id.
 *
 * @param node      - A Figma plugin BaseNode
 * @param depth     - Child recursion depth. -1 = unlimited, 0 = stubs only.
 * @param budget    - Shared counter: { remaining: N }. Stops recursing when 0.
 */
export const DEFAULT_NODE_BUDGET = 200;

export async function serializeNode(
  node: BaseNode,
  depth: number = -1,
  currentDepth: number = 0,
  budget: { remaining: number } = { remaining: DEFAULT_NODE_BUDGET },
): Promise<any> {
  if (budget.remaining <= 0) {
    return { id: node.id, name: node.name, type: node.type, _truncated: true };
  }
  budget.remaining--;
  // VECTORs: always a stub — no useful extractable properties
  if (node.type === "VECTOR") {
    return { id: node.id, name: node.name, type: node.type };
  }

  const out: any = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  // Parent info at root level
  if (currentDepth === 0 && node.parent) {
    out.parentId = node.parent.id;
    out.parentName = node.parent.name;
    out.parentType = node.parent.type;
  }

  // ── Fills ──────────────────────────────────────────────────────
  if ("fills" in node) {
    const fills = (node as any).fills;
    if (fills !== figma.mixed && Array.isArray(fills) && fills.length > 0) {
      out.fills = fills.map(serializePaint);
    }
  }

  // ── Strokes ────────────────────────────────────────────────────
  if ("strokes" in node) {
    const strokes = (node as any).strokes;
    if (Array.isArray(strokes) && strokes.length > 0) {
      out.strokes = strokes.map(serializePaint);
    }
  }

  // ── Corner radius ─────────────────────────────────────────────
  if ("cornerRadius" in node) {
    const cr = (node as any).cornerRadius;
    if (cr !== undefined && cr !== figma.mixed) out.cornerRadius = cr;
  }

  // ── Bounding box ──────────────────────────────────────────────
  if ("absoluteBoundingBox" in node && (node as any).absoluteBoundingBox) {
    out.absoluteBoundingBox = (node as any).absoluteBoundingBox;
  } else if ("absoluteTransform" in node && "width" in node) {
    const t = (node as any).absoluteTransform;
    if (t) {
      out.absoluteBoundingBox = {
        x: t[0][2], y: t[1][2],
        width: (node as any).width,
        height: (node as any).height,
      };
    }
  }

  // ── Text content ──────────────────────────────────────────────
  if ("characters" in node) {
    out.characters = (node as any).characters;
  }

  // ── Instance → source component ───────────────────────────────
  if (node.type === "INSTANCE") {
    const inst = node as InstanceNode;
    try {
      const main = await inst.getMainComponentAsync();
      if (main) {
        out.componentId = main.id;
        out.componentName = main.name;
      }
    } catch {
      // mainComponent unavailable (e.g. remote library not loaded)
    }
    const cp = (inst as any).componentProperties;
    if (cp && typeof cp === "object" && Object.keys(cp).length > 0) out.componentProperties = cp;
  }

  // ── Component property references ──────────────────────────────
  if ("componentPropertyReferences" in node) {
    const refs = (node as any).componentPropertyReferences;
    if (refs && typeof refs === "object" && Object.keys(refs).length > 0) out.componentPropertyReferences = refs;
  }

  // ── Text style ────────────────────────────────────────────────
  if (node.type === "TEXT") {
    const t = node as TextNode;
    const style: any = {};
    if (t.fontName !== figma.mixed) {
      style.fontFamily = (t.fontName as FontName).family;
      style.fontStyle = (t.fontName as FontName).style;
    }
    if (t.fontSize !== figma.mixed) style.fontSize = t.fontSize;
    if (t.textAlignHorizontal) style.textAlignHorizontal = t.textAlignHorizontal;
    if (t.letterSpacing !== figma.mixed) {
      const ls = t.letterSpacing as LetterSpacing;
      style.letterSpacing = ls.unit === "PIXELS" ? ls.value : ls;
    }
    if (t.lineHeight !== figma.mixed) {
      const lh = t.lineHeight as LineHeight;
      if (lh.unit === "PIXELS") style.lineHeightPx = lh.value;
      else if (lh.unit !== "AUTO") style.lineHeight = lh;
    }
    if (Object.keys(style).length > 0) out.style = style;
  }

  // ── Effects ───────────────────────────────────────────────────
  if ("effects" in node) {
    const effects = (node as any).effects;
    if (Array.isArray(effects) && effects.length > 0) {
      out.effects = effects.map((e: any) => {
        const eff: any = { type: e.type, visible: e.visible };
        if (e.radius !== undefined) eff.radius = e.radius;
        if (e.color) eff.color = rgbaToHex(e.color);
        if (e.offset) eff.offset = e.offset;
        if (e.spread !== undefined) eff.spread = e.spread;
        if (e.blendMode) eff.blendMode = e.blendMode;
        return eff;
      });
    }
  }

  // ── Layout ────────────────────────────────────────────────────
  if ("layoutMode" in node) {
    const lm = (node as any).layoutMode;
    if (lm && lm !== "NONE") out.layoutMode = lm;
  }
  if ("itemSpacing" in node) {
    const is = (node as any).itemSpacing;
    if (is !== undefined) out.itemSpacing = is;
  }
  if ("paddingLeft" in node) {
    const n = node as any;
    if (n.paddingLeft || n.paddingRight || n.paddingTop || n.paddingBottom) {
      out.padding = {
        left: n.paddingLeft, right: n.paddingRight,
        top: n.paddingTop, bottom: n.paddingBottom,
      };
    }
  }

  // ── Opacity / visibility ──────────────────────────────────────
  if ("opacity" in node) {
    const op = (node as any).opacity;
    if (op !== undefined && op !== 1) out.opacity = op;
  }
  if ("visible" in node) {
    out.visible = (node as any).visible;
  }

  // ── Constraints ───────────────────────────────────────────────
  if ("constraints" in node) {
    out.constraints = (node as any).constraints;
  }

  // ── Children ──────────────────────────────────────────────────
  if ("children" in node) {
    const children = (node as any).children as readonly BaseNode[];
    if ((depth >= 0 && currentDepth >= depth) || budget.remaining <= 0) {
      // Stubs only (depth limit reached or budget exhausted)
      out.children = children.map((c: BaseNode) => ({
        id: c.id, name: c.name, type: c.type,
        ...(budget.remaining <= 0 ? { _truncated: true } : {}),
      }));
    } else {
      // Sequential to keep budget counter deterministic (shared mutable ref)
      const serialized: any[] = [];
      for (const c of children) {
        serialized.push(await serializeNode(c, depth, currentDepth + 1, budget));
      }
      out.children = serialized;
    }
  }

  return out;
}

// ── Paint serialization ───────────────────────────────────────────

function serializePaint(paint: any): any {
  const p: any = { type: paint.type };
  if (paint.visible !== undefined) p.visible = paint.visible;
  if (paint.opacity !== undefined) p.opacity = paint.opacity;
  if (paint.blendMode) p.blendMode = paint.blendMode;
  if (paint.color) {
    // Plugin API: color = {r,g,b}, opacity separate. Merge for hex.
    p.color = rgbaToHex({ ...paint.color, a: paint.opacity ?? 1 });
  }
  if (paint.gradientStops) {
    p.gradientStops = paint.gradientStops.map((stop: any) => ({
      position: stop.position,
      color: rgbaToHex(stop.color),
    }));
  }
  if (paint.gradientTransform) p.gradientTransform = paint.gradientTransform;
  if (paint.scaleMode) p.scaleMode = paint.scaleMode;
  return p;
}
