// Buckets: each name gets a stable tint (globals.css --c-* tokens), so chips/badges re-theme in dark mode.
import { nameHash } from "./format";

const TINTS = ["coral", "peach", "sand", "lemon", "mint", "sage", "sky", "mist", "lavender", "blush"];

export const OTHER = "Other";
export const bucketOf = (b?: string) => b || OTHER; // "" = not enriched yet

export function bucketTint(name: string): { background: string; borderColor: string } {
  if (name === OTHER) return { background: "var(--surface)", borderColor: "var(--line-strong)" };
  const k = TINTS[nameHash(name.toLowerCase()) % TINTS.length];
  return { background: `var(--c-${k}-bg)`, borderColor: `var(--c-${k}-line)` };
}

// Strong accent per bucket — the thick left edge + dot on note cards (pastel tints all look alike at a glance).
const ACCENTS = ["var(--k-place)", "var(--k-issue)", "var(--t-person)", "var(--t-idea)", "var(--k-person)", "var(--k-official)", "var(--t-expense)", "var(--k-group)"];
export function bucketAccent(name: string): string {
  if (name === OTHER) return "var(--faint)";
  return ACCENTS[nameHash(name.toLowerCase()) % ACCENTS.length];
}
