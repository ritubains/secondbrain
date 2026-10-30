"use client";
// Mind map tree for Home: You → your categories (buckets) → main ideas → sub-ideas → notes, growing left to right
// (the same folders as the Notes folder view, lib/ideaTree.ts).
//   hover   a branch lights the path back to You; a note shows a preview of what it says
//   tap     a category or idea (or its +/− handle) to fold or unfold it, a note to open it, ↗ to see an idea's notes
//   chips   show one category only;  search  opens and highlights the branches that match;  ⤢  full screen
// Plain SVG; branches glide when the tree reshapes.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { day } from "../lib/format";
import { folders, type Folder } from "../lib/ideaTree";
import type { MapData } from "../lib/types";
import { useFullscreen } from "../lib/useFullscreen";
import { I } from "./IconButton";

type Props = {
  reloadKey: number;
  onOpenNote: (id: string) => void;
  onOpenTopic: (id: string) => void;
};

type Node = Folder | { id: "root"; kind: "root"; ref: ""; label: string; colour: string; count: number; children: Folder[] };
type Placed = { n: Node; x: number; y: number; parent?: Placed; folded: boolean };

// Sizes on wide screens and on phones: x of each level, pill widths, and how many letters a label keeps.
type Size = { col: number[]; pill: Record<"bucket" | "main" | "sub", number>; chars: Record<"bucket" | "main" | "sub" | "note", number> };
const WIDE: Size = { col: [0, 116, 268, 478, 696], pill: { bucket: 104, main: 172, sub: 180 }, chars: { bucket: 11, main: 17, sub: 19, note: 36 } };
const NARROW: Size = { col: [0, 58, 158, 310, 484], pill: { bucket: 88, main: 128, sub: 144 }, chars: { bucket: 8, main: 12, sub: 15, note: 24 } };
const ROW = 32;                   // height of one leaf row
const FOLD_OVER = 30;             // with more notes than this, ideas start folded

/** Positions: leaves one row apart top to bottom, each parent level with the middle of its children. */
function place(root: Node, folded: Set<string>, col: number[]): Placed[] {
  const out: Placed[] = [];
  placeBranch(root, 0, undefined, { folded, col, out, rows: 0 });
  return out;
}

/** Place one node and (unless folded) everything under it; leaves take the next free row. */
function placeBranch(n: Node, depth: number, parent: Placed | undefined, at: { folded: Set<string>; col: number[]; out: Placed[]; rows: number }): Placed {
  const p: Placed = { n, x: at.col[depth], y: 0, parent, folded: at.folded.has(n.id) && n.children.length > 0 };
  at.out.push(p);
  const kids = p.folded ? [] : n.children.map(c => placeBranch(c, depth + 1, p, at));
  p.y = kids.length ? (kids[0].y + kids[kids.length - 1].y) / 2 : at.rows++ * ROW;
  return p;
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const ideasIn = (fs: Folder[]): string[] => fs.flatMap(f => (f.kind === "main" || f.kind === "sub" ? [f.id] : []).concat(ideasIn(f.children)));
/** Only the branches holding something whose name has q (those are kept whole when the branch itself matches). */
const prune = (fs: Folder[], q: string): Folder[] => fs.flatMap(f => {
  if (f.label.toLowerCase().includes(q)) return [f];
  const children = prune(f.children, q);
  return children.length ? [{ ...f, children }] : [];
});

export default function MindTree({ reloadKey, onOpenNote, onOpenTopic }: Props) {
  const [data, setData] = useState<MapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [folded, setFolded] = useState<Set<string> | null>(null);
  const [size, setSize] = useState<Size>(WIDE);
  const [only, setOnly] = useState<string | null>(null);    // one category's id, or all
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<Placed | null>(null);
  const { ref: shell, full, toggle: toggleFull } = useFullscreen<HTMLDivElement>();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { api("/graph/map").then(setData, () => setFailed(true)); }, [reloadKey]);
  const all = useMemo(() => (data ? folders(data) : []), [data]);
  useEffect(() => { // first look: everything open, unless there's a lot — then ideas start folded
    if (data && folded === null) setFolded(new Set(data.notes.length > FOLD_OVER ? ideasIn(all) : []));
  }, [data, all, folded]);
  useEffect(() => { // phones get the compact tree
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(el.clientWidth < 640 ? NARROW : WIDE));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!folded]); // eslint-disable-line react-hooks/exhaustive-deps — the box exists once the tree shows

  if (failed) return <p className="text-[13.5px] text-muted">Couldn&apos;t load the mind map.</p>;
  if (!data || !folded) return <div className="skeleton h-[260px] rounded-xl" aria-busy="true" />;
  if (!all.length) return null;

  const q = query.trim().toLowerCase();
  const children = prune(all.filter(b => !only || b.id === only), q);
  const root: Node = { id: "root", kind: "root", ref: "", label: "You", colour: "var(--primary)", count: data.notes.length, children };
  const nodes = place(root, q ? new Set() : folded, size.col);   // searching: everything that matches is open
  const height = Math.max(...nodes.map(p => p.y)) + ROW;
  const width = Math.max(...nodes.map(p => p.x)) + size.chars.note * 7 + 30;
  const toggle = (id: string) => setFolded(f => { const s = new Set(f); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const allOpen = folded.size === 0;
  // The lit path: the hovered node and everything up to You.
  const path = new Set<string>();
  for (let p: Placed | undefined = hover || undefined; p; p = p.parent) path.add(p.n.id);
  /** Where a line leaves a node: the right end of its pill (past the ↗ on ideas). */
  const right = (p: Placed) => p.x + (p.n.kind === "root" ? 44 : p.n.kind === "note" ? 4 : p.n.kind === "bucket" || p.n.kind === "entity" ? size.pill.bucket - 6 : size.pill[p.n.kind] + 16);
  const tipNote = hover?.n.kind === "note" ? (hover.n as Folder) : null;
  const scroller = box.current;

  return (
    <div ref={shell} className={full ? "bg-[var(--page)] p-5 h-screen flex flex-col" : ""}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <button onClick={() => setOnly(null)} aria-pressed={!only}
          className={`h-7 px-2.5 rounded-full text-[12px] font-semibold border transition-colors ${!only ? "bg-[var(--primary)] text-white border-transparent" : "border-line text-muted hover:text-soft"}`}>All</button>
        {all.map(b => (
          <button key={b.id} onClick={() => setOnly(only === b.id ? null : b.id)} aria-pressed={only === b.id}
            className="h-7 px-2.5 rounded-full text-[12px] font-semibold border transition-colors inline-flex items-center gap-1.5"
            style={only === b.id ? { background: b.colour, color: "#fff", borderColor: b.colour } : { color: b.colour, borderColor: "var(--line)" }}>
            {b.label}<span className="opacity-60 tabular-nums">{b.count}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none [&_svg]:w-3.5 [&_svg]:h-3.5">{I.search}</span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find in the map…" aria-label="Find in the mind map"
            onKeyDown={e => { if (e.key === "Escape") setQuery(""); }}
            className="field h-7 w-[170px] pl-8 pr-2 text-[12.5px] bg-bg border border-line rounded-full placeholder:text-faint" />
        </div>
        {!q && <button onClick={() => setFolded(allOpen ? new Set(all.map(b => b.id)) : new Set())} className="h-7 px-2 text-[12.5px] text-primary hover:underline">
          {allOpen ? "Fold all" : "Unfold all"}</button>}
        <button onClick={toggleFull} aria-label={full ? "Leave full screen" : "Full screen"} title={full ? "Leave full screen" : "Full screen"}
          className="w-7 h-7 rounded-full border border-line text-muted hover:text-soft flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            {full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />}</svg>
        </button>
      </div>

      {!children.length ? <p className="text-[13px] text-muted py-6 text-center">Nothing in the map matches &ldquo;{query.trim()}&rdquo;.</p> : (
        <div ref={box} className={`relative overflow-auto -mx-1 px-1 rounded-xl ${full ? "flex-1" : "max-h-[640px]"}`}
          style={{ backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
          <svg width={width} height={height + 16} viewBox={`-10 ${-ROW / 2 - 4} ${width} ${height + 16}`} role="tree" aria-label="Mind map of your notes" className="block">
            <defs>
              <filter id="tree-lift" x="-20%" y="-40%" width="140%" height="190%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" floodOpacity=".22" /></filter>
            </defs>
            {nodes.filter(p => p.parent).map(p => {
              const x0 = right(p.parent!), y0 = p.parent!.y, x1 = p.x - 8, k = p.n.kind, on = path.has(p.n.id);
              return <path key={`l${p.n.id}`} d={`M${x0},${y0} C${x0 + (x1 - x0) * 0.55},${y0} ${x1 - (x1 - x0) * 0.55},${p.y} ${x1},${p.y}`}
                fill="none" stroke={p.n.colour} strokeLinecap="round"
                strokeOpacity={hover ? (on ? 0.95 : 0.18) : k === "note" ? 0.4 : 0.6}
                strokeWidth={(k === "bucket" ? 3 : k === "main" || k === "entity" ? 2.4 : k === "sub" ? 1.9 : 1.4) + (on ? 1 : 0)}
                style={{ transition: "d .3s ease, stroke-opacity .2s" }} />;
            })}
            {nodes.map(p => <Branch key={p.n.id} p={p} size={size} q={q} lit={!hover || path.has(p.n.id)}
              onHover={setHover} onToggle={() => toggle(p.n.id)} onOpenNote={onOpenNote} onOpenTopic={onOpenTopic} />)}
          </svg>

          {/* A preview of the hovered note. */}
          {tipNote && hover && (() => {
            const sx = scroller?.scrollLeft || 0, sy = scroller?.scrollTop || 0, cw = scroller?.clientWidth || 800;
            const left = Math.min(hover.x + 10 + 26 + Math.min(tipNote.label.length, size.chars.note) * 7 - sx, cw - 290);
            return (
              <div className="absolute z-20 pointer-events-none card px-3 py-2.5 w-[280px] anim-fade" role="tooltip"
                style={{ left: Math.max(left, 8), top: hover.y + ROW / 2 + 4 - sy + 4, borderRadius: 12, borderLeft: `3px solid ${tipNote.colour}` }}>
                <p className="text-[13px] font-semibold text-ink leading-snug">{tipNote.label}</p>
                {tipNote.date && <p className="text-[11.5px] text-faint">{day(tipNote.date)}</p>}
                {tipNote.preview && <p className="mt-1 text-[12.5px] text-soft leading-relaxed line-clamp-4">{tipNote.preview}</p>}
                <p className="mt-1.5 text-[11px] text-faint">Tap to open</p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/** One node: You and the categories as filled pills, main ideas as outlined pills, sub-ideas as dashed ones, notes as
 * a dot and title; folders get a +/− handle. */
function Branch({ p, size, q, lit, onHover, onToggle, onOpenNote, onOpenTopic }: {
  p: Placed; size: Size; q: string; lit: boolean; onHover: (p: Placed | null) => void; onToggle: () => void;
  onOpenNote: (id: string) => void; onOpenTopic: (id: string) => void;
}) {
  const n = p.n;
  const move = { transform: `translate(${p.x}px, ${p.y}px)`, transition: "transform .3s ease, opacity .2s", opacity: lit ? 1 : 0.35 };
  const halo = { paintOrder: "stroke" as const, stroke: "var(--bg)", strokeWidth: 3.5, strokeLinejoin: "round" as const };
  const hit = !!q && n.label.toLowerCase().includes(q);
  const hoverOn = { onPointerEnter: () => onHover(p), onPointerLeave: () => onHover(null) };
  if (n.kind === "root") return (
    <g style={move}>
      <rect x={-8} y={-16} width={52} height={32} rx={16} fill="var(--primary)" filter="url(#tree-lift)" />
      <text x={18} y={5} textAnchor="middle" fontSize={13.5} fontWeight={700} fill="#fff">You</text>
    </g>
  );
  if (n.kind === "note") return (
    <g style={{ ...move, cursor: "pointer" }} role="treeitem" aria-label={n.label} tabIndex={0} {...hoverOn}
      onClick={() => onOpenNote(n.ref)} onKeyDown={e => { if (e.key === "Enter") onOpenNote(n.ref); }} className="group outline-none">
      <rect x={-6} y={-12} width={Math.min(n.label.length, size.chars.note) * 7 + 26} height={24} rx={8} className="fill-transparent group-hover:fill-[var(--surface)] group-focus-visible:fill-[var(--surface)]" />
      <circle cx={0} cy={0} r={4.5} fill={n.colour} />
      {hit && <rect x={8} y={-10} width={Math.min(n.label.length, size.chars.note) * 7 + 6} height={20} rx={5} fill="var(--primary)" opacity={0.18} />}
      <text x={12} y={4.5} fontSize={12.5} fontWeight={hit ? 650 : 500} fill="var(--ink)" style={halo}>{cut(n.label, size.chars.note)}</text>
    </g>
  );
  const top = n.kind === "bucket" || n.kind === "entity", w = top ? size.pill.bucket : size.pill[n.kind as "main" | "sub"];
  const can = n.children.length > 0;
  const label = top ? cut(n.label, size.chars.bucket - (can ? 1 : 0)) : `${n.kind === "main" ? "#" : "›"} ${cut(n.label, size.chars[n.kind as "main" | "sub"])}`;
  return (
    <g style={{ ...move, cursor: "pointer" }} role="treeitem" aria-expanded={can ? !p.folded : undefined} aria-label={`${n.label}, ${n.count} notes`} tabIndex={0}
      {...hoverOn} onClick={onToggle} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }} className="outline-none">
      <rect x={-8} y={-14} width={w} height={28} rx={14} filter={top || n.kind === "main" ? "url(#tree-lift)" : undefined}
        fill={top ? n.colour : n.kind === "main" ? `color-mix(in srgb, ${n.colour} 14%, var(--bg))` : "var(--bg)"}
        stroke={n.colour} strokeWidth={hit ? 2.6 : 1.5} strokeDasharray={n.kind === "sub" ? "4 3" : undefined} />
      <text x={5} y={4.5} fontSize={12.5} fontWeight={n.kind === "sub" ? 550 : 650} fill={top ? "#fff" : n.colour}>{label}</text>
      <text x={w - (can ? 22 : 16)} y={4.5} textAnchor="end" fontSize={11} fontWeight={600} fill={top ? "#fff" : "var(--faint)"} opacity={0.85}>{n.count}</text>
      {can && ( /* fold / unfold handle */
        <g transform={`translate(${w - 8}, 0)`}>
          <circle r={7.5} fill="var(--bg)" stroke={n.colour} strokeWidth={1.4} />
          <path d={p.folded ? "M-3.5,0 H3.5 M0,-3.5 V3.5" : "M-3.5,0 H3.5"} stroke={n.colour} strokeWidth={1.6} strokeLinecap="round" />
        </g>
      )}
      {!top && (
        <g transform={`translate(${w + 10}, 0)`} onClick={e => { e.stopPropagation(); onOpenTopic(n.ref); }} aria-label={`See the notes of ${n.label}`} role="button">
          <title>See its notes</title>
          <circle r={9} fill="var(--surface)" stroke="var(--line-strong)" />
          <path d="M-3,3 l6,-6 m-4,0 h4 v4" stroke="var(--soft)" strokeWidth={1.4} fill="none" strokeLinecap="round" />
        </g>
      )}
      {p.folded && <text x={w + (top ? 6 : 24)} y={4.5} fontSize={11.5} fill="var(--faint)">{n.count} inside</text>}
      <title>{p.folded ? "Unfold" : "Fold"} {n.label}</title>
    </g>
  );
}
