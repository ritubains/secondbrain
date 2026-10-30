"use client";
// Category filter row: the learned categories (api pipeline/clusters.py) with how many notes each holds.
import { bucketAccent } from "../lib/buckets";

type Props = {
  names: string[];                       // the categories, biggest first
  counts: Record<string, number>;
  active: string | null;                 // null = all
  onPick: (b: string | null) => void;
};

export default function BucketChips({ names, counts, active, onPick }: Props) {
  const shown = names.filter(b => (counts[b] || 0) > 0 || b === active);
  const base = "chip-lift btn-press shrink-0 inline-flex items-center gap-1.5 text-[13px] font-medium h-8 pl-3 pr-1.5 rounded-full border";
  const badge = "tabular-nums text-[11px] min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center bg-surface text-muted";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="no-scrollbar flex gap-2 overflow-x-auto min-w-0 py-0.5" role="group" aria-label="Filter by category">
        {shown.map(b => {
          const on = active === b;
          const accent = bucketAccent(b);
          return (
            <button key={b} onClick={() => onPick(on ? null : b)} aria-pressed={on}
              className={`${base} ${on ? "text-ink" : "bg-bg border-line text-soft hover:border-line-strong"}`}
              style={on ? { borderColor: accent, background: `color-mix(in srgb, ${accent} 14%, var(--bg))` } : undefined}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: accent }} aria-hidden />
              {b}
              <span className={badge}>{counts[b] || 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
