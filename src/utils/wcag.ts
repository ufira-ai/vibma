// ─── WCAG 2.2 Accessibility Utilities ────────────────────────────
// Shared functions for contrast checking, luminance calculation, and
// accessibility heuristics. Used by lint rules and creation-time recommendations.

import { rgbaToHex } from "./color";

// ─── Types ──────────────────────────────────────────────────────

export interface SolidColor {
  r: number; g: number; b: number; a: number;
}

export interface ContrastResult {
  ratio: number;
  passesAA: boolean;
  passesAAA: boolean;
  aaRequired: number;
  aaaRequired: number;
}

// ─── Core WCAG Calculations ─────────────────────────────────────

/**
 * WCAG 2.2 relative luminance from sRGB channels (0-1 float).
 * https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */
export function srgbRelativeLuminance(r: number, g: number, b: number): number {
  const linearize = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * WCAG contrast ratio between two relative luminances.
 * Always returns a value >= 1.0.
 */
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Composite a foreground RGBA color over an opaque background RGB.
 * Returns the resulting opaque RGB (0-1 float).
 */
export function alphaComposite(
  fgR: number, fgG: number, fgB: number, fgA: number,
  bgR: number, bgG: number, bgB: number,
): { r: number; g: number; b: number } {
  return {
    r: fgR * fgA + bgR * (1 - fgA),
    g: fgG * fgA + bgG * (1 - fgA),
    b: fgB * fgA + bgB * (1 - fgA),
  };
}

/**
 * Check contrast between two colors for both AA and AAA levels.
 * `large` = true for large text (relaxed requirements).
 */
export function checkContrastPair(
  fg: { r: number; g: number; b: number },
  bg: { r: number; g: number; b: number },
  large = false,
): ContrastResult {
  const fgLum = srgbRelativeLuminance(fg.r, fg.g, fg.b);
  const bgLum = srgbRelativeLuminance(bg.r, bg.g, bg.b);
  const ratio = contrastRatio(fgLum, bgLum);
  const aaRequired = large ? 3.0 : 4.5;
  const aaaRequired = large ? 4.5 : 7.0;
  return {
    ratio: Math.round(ratio * 100) / 100,
    passesAA: ratio >= aaRequired,
    passesAAA: ratio >= aaaRequired,
    aaRequired,
    aaaRequired,
  };
}

// ─── Text Helpers ───────────────────────────────────────────────

/**
 * WCAG "large text": >= 24px regular, or >= 18.66px bold (>= 700).
 */
export function isLargeText(fontSize: number, fontWeight: number): boolean {
  if (fontSize >= 24) return true;
  if (fontSize >= 18.66 && fontWeight >= 700) return true;
  return false;
}

/**
 * Infer numeric font weight from Figma's FontName.style string.
 * Returns 400 if unknown.
 */
export function inferFontWeight(fontStyle: string): number {
  const s = fontStyle.toLowerCase();
  if (s.includes("thin") || s.includes("hairline")) return 100;
  if (s.includes("extralight") || s.includes("extra light") || s.includes("ultralight")) return 200;
  if (s.includes("light")) return 300;
  if (s.includes("regular") || s.includes("normal") || s === "roman") return 400;
  if (s.includes("medium")) return 500;
  if (s.includes("semibold") || s.includes("semi bold") || s.includes("demibold")) return 600;
  if (s.includes("extrabold") || s.includes("extra bold") || s.includes("ultrabold")) return 800;
  if (s.includes("bold")) return 700; // must come after extrabold/semibold
  if (s.includes("black") || s.includes("heavy")) return 900;
  return 400;
}

// ─── Interactive Element Heuristic ──────────────────────────────

const INTERACTIVE_NAME_PATTERN = /\b(button|btn|link|tab|toggle|switch|checkbox|radio|chip|badge|tag|cta|menu[-_]?item|nav[-_]?item|input|select|dropdown|close|action|icon[-_]?button)\b/i;

/**
 * Heuristic: does this node look like an interactive element?
 * Figma has no click handler concept, so we check type + name patterns.
 */
export function looksInteractive(node: { type: string; name: string }): boolean {
  if (node.type === "COMPONENT" || node.type === "INSTANCE") return true;
  if (node.type === "FRAME" && INTERACTIVE_NAME_PATTERN.test(node.name)) return true;
  return false;
}

// ─── Color extraction for contrast report ───────────────────────

/**
 * Format a contrast failure report for color style/variable creation.
 * Only reports failing AA pairs. Returns null if all pass.
 */
export function formatContrastFailures(
  newColor: { r: number; g: number; b: number },
  existingColors: Array<{ name: string; color: { r: number; g: number; b: number } }>,
): string | null {
  const failures: string[] = [];

  for (const existing of existingColors) {
    const result = checkContrastPair(newColor, existing.color);
    if (!result.passesAA) {
      const newHex = rgbaToHex({ ...newColor, a: 1 });
      failures.push(`${result.ratio}:1 vs '${existing.name}' (need ${result.aaRequired}:1)`);
    }
  }

  // Also check against white and black for non-text contrast (3:1)
  const whiteResult = checkContrastPair(newColor, { r: 1, g: 1, b: 1 });
  const blackResult = checkContrastPair(newColor, { r: 0, g: 0, b: 0 });
  if (whiteResult.ratio < 3 && blackResult.ratio < 3) {
    failures.push(`<3:1 vs both white & black`);
  }

  if (failures.length === 0) return null;
  return "WCAG contrast: " + failures.join("; ");
}
