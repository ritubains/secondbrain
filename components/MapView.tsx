"use client";
// Map: your notes and what they mention. Each note is a card in the box of the category it's filed under; the people,
// places, offices, groups and issues it mentions are dots joined to it, sized by how many notes mention them. A thing
// mentioned in notes from different categories sits between their boxes, so you see how your areas connect. Facts
// stated between things ("is MC of") show when one is lit. Things only one note mentions are left out until you ask
// for everything, unless a fact names them. Tap a note or a dot for details; hover lights up what it's joined to; drag
// to rearrange (the layout is live); scroll, pinch or +/- to zoom.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { day, plural } from "../lib/format";
import { KIND } from "../lib/kinds";
import type { EntityKind } from "../lib/types";
import { useFullscreen } from "../lib/useFullscreen";
import IconButton, { I } from "./IconButton";

type Props = {
  reloadKey: number;
  onOpenNote: (id: string) => void;
  onOpenEntity: (id: string) => void;
};

type Data = {
  nodes: { id: string; name: string; kind: EntityKind; meaning: string; notes: number }[];
  edges: { a: string; b: string; notes: number; note_ids: string[] }[];
  facts: { a: string; b: string; relation: string }[];
  notes: { id: string; title: string; created_at: string; category: string; preview: string; entities: string[] }[];
  stats: { notes: number; linked: number; things: number; connections: number };
};
/** A note card or a thing's dot on the map; hw/hh are half the room it takes (its label included). */
type Item = {
  id: string; name: string; kind: EntityKind | "note"; notes: number; area: string;
  x: number; y: number; vx: number; vy: number; hw: number; hh: number; r: number; pinned?: boolean;
};
type Link = { s: Item; t: Item };
type Box = { x: number; y: number; w: number; h: number };
type Area = { name: string; x0: number; y0: number; x1: number; y1: number; notes: number };

const W = 1000, H = 680, GAP = 10, TITLE = 26;
const KINDS: EntityKind[] = ["place", "person", "official", "group", "issue"];
const KIND_LABEL: Record<string, string> = { place: "Places", person: "People", official: "Officials and departments", group: "Groups", issue: "Issues" };
const short = (t: string, n = 30) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);

/** A centre for each category (biggest first, round an oval sized to how many there are; things shared between
 * categories start in the middle), and starting spots on a small spiral round it — the same notes give the same picture. */
function seed(items: Item[]): Record<string, { x: number; y: number }> {
  const size: Record<string, number> = {};
  items.forEach(n => { if (n.area) size[n.area] = (size[n.area] || 0) + 1; });
  const names = Object.keys(size).sort((a, b) => size[b] - size[a]);
  const rx = names.length > 1 ? 150 + 60 * names.length : 0;
  const centres: Record<string, { x: number; y: number }> = { "": { x: W / 2, y: H / 2 } };
  names.forEach((name, i) => {
    const a = (2 * Math.PI * i) / names.length - Math.PI / 2;
    centres[name] = { x: W / 2 + rx * Math.cos(a), y: H / 2 + rx * 0.5 * Math.sin(a) };
  });
  const placed: Record<string, number> = {};
  [...items].sort((a, b) => b.notes - a.notes).forEach(n => {
    const i = (placed[n.area] = (placed[n.area] || 0) + 1), a = i * 2.39996, d = 34 * Math.sqrt(i);
    n.x = centres[n.area].x + d * Math.cos(a); n.y = centres[n.area].y + d * Math.sin(a);
  });
  return centres;
}

/** The box round each category's notes and things, with room for its title on top. */
function areas(items: Item[]): Area[] {
  const out: Record<string, Area> = {};
  for (const n of items) {
    if (!n.area) continue;
    const a = (out[n.area] ||= { name: n.area, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, notes: 0 });
    a.x0 = Math.min(a.x0, n.x - n.hw - 16); a.x1 = Math.max(a.x1, n.x + n.hw + 16);
    a.y0 = Math.min(a.y0, n.y - n.hh - 16 - TITLE); a.y1 = Math.max(a.y1, n.y + n.hh + 14);
    if (n.kind === "note") a.notes++;
  }
  return Object.values(out);
}

/** One step of the layout (scaled by alpha): nothing overlaps, each note pulls what it mentions close, each item is
 * drawn towards its category's centre, and category boxes push each other apart so they never overlap. */
function tick(items: Item[], links: Link[], alpha: number, centres: Record<string, { x: number; y: number }>): void {
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const p = items[i], q = items[j];
    let dx = q.x - p.x, dy = q.y - p.y;
    if (Math.abs(dx) + Math.abs(dy) < 0.1) { dx = 0.1 + i * 0.01; dy = 0.1; }
    const d2 = Math.max(dx * dx + dy * dy, 100), d = Math.sqrt(d2), f = (600 * alpha) / d2;
    p.vx -= f * dx / d; p.vy -= f * dy / d; q.vx += f * dx / d; q.vy += f * dy / d;
    const ox = p.hw + q.hw + GAP - Math.abs(dx), oy = p.hh + q.hh + GAP - Math.abs(dy);
    if (ox > 0 && oy > 0) {  // overlapping: part them along the shorter way out
      if (ox < oy) { const m = (ox / 2) * (Math.sign(dx) || 1) * 0.5; p.x -= m; q.x += m; }
      else { const m = (oy / 2) * (Math.sign(dy) || 1) * 0.5; p.y -= m; q.y += m; }
    }
  }
  for (const { s, t } of links) {
    const dx = t.x - s.x, dy = t.y - s.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 70) * 0.03 * alpha;
    s.vx += f * dx / d; s.vy += f * dy / d; t.vx -= f * dx / d; t.vy -= f * dy / d;
  }
  for (const n of items) {
    const home = centres[n.area] || centres[""], k = n.area ? 0.025 : 0.008;
    n.vx += (home.x - n.x) * k * alpha; n.vy += (home.y - n.y) * k * alpha;
  }
  const boxes = areas(items);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 30, oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 30;
    if (ox <= 0 || oy <= 0) continue;
    const sx = Math.sign((b.x0 + b.x1) - (a.x0 + a.x1)) || 1, sy = Math.sign((b.y0 + b.y1) - (a.y0 + a.y1)) || 1;
    const [mx, my] = ox < oy ? [(ox / 2) * sx * 0.3, 0] : [0, (oy / 2) * sy * 0.3];
    for (const n of items) {
      if (n.pinned) continue;
      if (n.area === a.name) { n.x -= mx; n.y -= my; } else if (n.area === b.name) { n.x += mx; n.y += my; }
    }
  }
  for (const n of items) {
    if (n.pinned) { n.vx = n.vy = 0; continue; }
    n.x += Math.max(-20, Math.min(20, n.vx)); n.y += Math.max(-20, Math.min(20, n.vy));
    n.vx *= 0.6; n.vy *= 0.6;
  }
}

/** The view that shows everything (category boxes included), at the screen's shape. */
function fit(items: Item[], ratio: number): Box {
  if (!items.length) return { x: 0, y: 0, w: W, h: W / ratio };
  const boxes = areas(items);
  const x0 = Math.min(...items.map(n => n.x - n.hw), ...boxes.map(a => a.x0)) - 24, x1 = Math.max(...items.map(n => n.x + n.hw), ...boxes.map(a => a.x1)) + 24;
  const y0 = Math.min(...items.map(n => n.y - n.hh), ...boxes.map(a => a.y0)) - 24, y1 = Math.max(...items.map(n => n.y + n.hh), ...boxes.map(a => a.y1)) + 24;
  const w = Math.max(x1 - x0, (y1 - y0) * ratio, 400), h = w / ratio;
  return { x: (x0 + x1 - w) / 2, y: (y0 + y1 - h) / 2, w, h };
}

export default function MapView({ reloadKey, onOpenNote, onOpenEntity }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());   // kinds switched off in the legend
  const [everything, setEverything] = useState(false);              // also things only one note mentions
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<Box>({ x: 0, y: 0, w: W, h: H });
  const [ratio, setRatio] = useState(W / H);
  const { ref: shell, full, toggle: toggleFull } = useFullscreen<HTMLDivElement>();
  const [, frame] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const alpha = useRef(0);
  const drag = useRef<{ item?: Item; x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => { setFailed(false); api("/graph/entities").then(setData, () => setFailed(true)); }, [reloadKey]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { const b = el.getBoundingClientRect(); if (b.width && b.height) setRatio(b.width / b.height); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!data, full]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every note, and the things of the kinds switched on that recur or that a fact names (all of them when asked).
  // A thing belongs to a category when all its notes are filed there; one shared between categories belongs to none.
  const graph = useMemo(() => {
    if (!data) return null;
    const inFact = new Set(data.facts.flatMap(f => [f.a, f.b]));
    const shown = data.nodes.filter(n => !hidden.has(n.kind));
    const main = shown.filter(n => n.notes > 1 || inFact.has(n.id));
    const things = everything || !main.length ? shown : main;
    const most = Math.max(1, ...things.map(n => n.notes));
    const items: Item[] = data.notes.map(n => {
      const name = short(n.title || "Untitled");
      return { id: n.id, name, kind: "note", notes: n.entities.length, area: n.category, x: 0, y: 0, vx: 0, vy: 0, hw: name.length * 3.9 + 14, hh: 15, r: 0 };
    });
    for (const n of things) {
      const cats = new Set(data.notes.filter(x => x.entities.includes(n.id)).map(x => x.category));
      const r = 5 + 9 * Math.sqrt(n.notes / most);
      items.push({ id: n.id, name: n.name, kind: n.kind, notes: n.notes, area: cats.size === 1 ? Array.from(cats)[0] : "",
        x: 0, y: 0, vx: 0, vy: 0, hw: Math.max(r, Math.min(n.name.length * 3.6, 66)), hh: r + 9, r });
    }
    const at = Object.fromEntries(items.map(n => [n.id, n]));
    const links: Link[] = data.notes.flatMap(n => n.entities.filter(e => at[e] && at[e].kind !== "note").map(e => ({ s: at[n.id], t: at[e] })));
    const facts = data.facts.filter(f => at[f.a] && at[f.b]);
    const centres = seed(items);
    for (let i = 0; i < 320; i++) tick(items, links, 1 - i / 360, centres);
    for (let i = 0; i < 160; i++) tick(items, links, 0.1, centres);  // settle, so nothing overlaps when it first shows
    return { items, links, facts, at, centres, left: shown.length - things.length };
  }, [data, hidden, everything]);
  useEffect(() => { if (graph) setView(fit(graph.items, ratio)); }, [graph, ratio]);  // laid out already; it moves again when dragged
  useEffect(() => { // the live layout: runs while there's life left in it, then rests
    if (!graph) return;
    let raf = 0;
    const loop = () => {
      if (alpha.current > 0.004) { tick(graph.items, graph.links, alpha.current, graph.centres); alpha.current *= 0.96; frame(f => f + 1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [graph]);

  const toMap = (e: { clientX: number; clientY: number }) => {
    const b = svg.current!.getBoundingClientRect(), v = viewRef.current;
    return { x: v.x + ((e.clientX - b.left) / b.width) * v.w, y: v.y + ((e.clientY - b.top) / b.height) * v.h };
  };
  const zoomAt = (k: number, cx: number, cy: number) =>
    setView(v => { const w = Math.min(Math.max(v.w * k, 200), 6000), s = w / v.w; return { x: cx - (cx - v.x) * s, y: cy - (cy - v.y) * s, w, h: v.h * s }; });
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const p = toMap(e); zoomAt(Math.exp(e.deltaY * 0.0015), p.x, p.y); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
  const down = (e: React.PointerEvent, item?: Item) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { item, ...toMap(e), moved: false };
    if (item) item.pinned = true;
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toMap(e);
    if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 3) d.moved = true;
    if (d.item) { d.item.x = p.x; d.item.y = p.y; alpha.current = Math.max(alpha.current, 0.08); frame(f => f + 1); }
    else setView(v => ({ ...v, x: v.x - (p.x - d.x), y: v.y - (p.y - d.y) }));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.item) d.item.pinned = false;
    if (!d.moved) setPicked(d.item ? d.item.id : null);
  };

  if (failed) return <p className="text-sm text-muted p-6">Couldn&apos;t load the map. Is the API running?</p>;

  const lit = hover || picked;
  const near = new Set<string>();
  if (graph && lit) {
    near.add(lit);
    graph.links.forEach(l => { if (l.s.id === lit) near.add(l.t.id); if (l.t.id === lit) near.add(l.s.id); });
    graph.facts.forEach(f => { if (f.a === lit) near.add(f.b); if (f.b === lit) near.add(f.a); });
  }
  const q = query.trim().toLowerCase();
  const match = (n: Item) => !q || n.name.toLowerCase().includes(q);
  const zoom = graph ? fit(graph.items, ratio).w / view.w : 1;
  const sel = picked && graph ? graph.at[picked] : null;

  return (
    <div>
      <div className="card p-5 sm:p-6 mb-4" style={{ borderRadius: 20 }}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[220px]">
            <h1 className="font-display text-[28px] font-semibold tracking-tight">Your second brain</h1>
            {data && (
              <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                {[[data.stats.notes, "notes"], [data.stats.linked, "records linked"], [data.stats.things, "people, places and issues"], [data.stats.connections, "connections"]].map(([v, l]) => (
                  <div key={String(l)}><p className="font-display text-[30px] leading-none font-semibold tabular-nums">{v}</p><p className="text-[13px] text-muted mt-1">{l}</p></div>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <p className="text-[13px] text-faint">Tap a note or a dot to see what it connects to</p>
            <div className="relative w-[240px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none">{I.search}</span>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a note, person, place…" aria-label="Find on the map"
                className="field w-full h-9 pl-9 pr-3 text-[13.5px] bg-bg border border-line rounded-xl placeholder:text-faint" />
            </div>
          </div>
        </div>

        {!graph ? <div className="skeleton h-[520px] rounded-2xl mt-4" aria-busy="true" /> : !graph.items.length ? (
          <p className="text-sm text-muted p-6 text-center">Nothing here yet. As you add notes, they show up here with the people, places and issues they mention.</p>
        ) : (
          <div ref={shell} className={`relative mt-4 overflow-hidden ${full ? "bg-[var(--page)]" : "rounded-2xl border border-line"}`}>
            <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className={`w-full touch-none select-none ${full ? "h-screen" : "h-[68vh] min-h-[460px]"}`}
              role="img" aria-label="Your notes by category, joined to the people, places, offices, groups and issues they mention"
              onPointerDown={e => down(e)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              style={{ cursor: drag.current && !drag.current.item ? "grabbing" : "grab" }}>
              {areas(graph.items).map(a => (
                <g key={a.name} opacity={lit ? 0.5 : 1} style={{ transition: "opacity .2s", pointerEvents: "none" }}>
                  <rect x={a.x0} y={a.y0} width={a.x1 - a.x0} height={a.y1 - a.y0} rx={18} fill="var(--surface)" stroke="var(--line)" />
                  <text x={a.x0 + 16} y={a.y0 + 21} fontSize={13} fontWeight={700} letterSpacing=".07em" fill="var(--soft)" style={{ textTransform: "uppercase" }}>
                    {a.name}<tspan fontWeight={500} fill="var(--faint)" letterSpacing="0">{`  ·  ${plural(a.notes, "note")}`}</tspan>
                  </text>
                </g>
              ))}
              {graph.links.map(l => {
                const on = !!lit && (l.s.id === lit || l.t.id === lit), dim = (!!lit && !on) || (!!q && !(match(l.s) || match(l.t)));
                return <line key={`${l.s.id}|${l.t.id}`} x1={l.s.x} y1={l.s.y} x2={l.t.x} y2={l.t.y} stroke={on ? KIND[l.t.kind as EntityKind].fg : "var(--line-strong)"}
                  strokeWidth={on ? 2 : 1} opacity={dim ? 0.1 : on ? 0.9 : 0.55} style={{ transition: "opacity .2s" }} />;
              })}
              {graph.facts.map(f => {
                const a = graph.at[f.a], b = graph.at[f.b], on = !!lit && (f.a === lit || f.b === lit);  // a fact shows with what it's about
                if (!on) return null;
                return (
                  <g key={`f${f.a}${f.b}${f.relation}`} style={{ pointerEvents: "none" }}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--soft)" strokeDasharray="4 3" strokeWidth={1.3} />
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" fontSize={11} fontStyle="italic"
                      fill="var(--ink)" style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 4 }}>{f.relation}</text>
                  </g>
                );
              })}
              {graph.items.map(n => {
                const dim = (!!lit && !near.has(n.id)) || !match(n), on = n.id === lit;
                const events = { onPointerDown: (e: React.PointerEvent) => down(e, n), onPointerEnter: () => setHover(n.id), onPointerLeave: () => setHover(h => (h === n.id ? null : h)) };
                if (n.kind === "note") return (
                  <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.22 : 1} style={{ cursor: "pointer", transition: "opacity .2s" }} {...events}>
                    <rect x={-n.hw} y={-n.hh} width={2 * n.hw} height={2 * n.hh} rx={9} fill="var(--card)" stroke={on ? "var(--accent)" : "var(--line-strong)"} strokeWidth={on ? 2 : 1}
                      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.12))" }} />
                    <text y={5} textAnchor="middle" fontSize={14} fontWeight={600} fill="var(--ink)">{n.name}</text>
                    <title>{data!.notes.find(x => x.id === n.id)?.title}</title>
                  </g>
                );
                const kind = n.kind as EntityKind;
                const showLabel = n.notes > 1 || on || near.has(n.id) || zoom > 1.6 || (!!q && match(n)) || graph.facts.some(f => f.a === n.id || f.b === n.id);
                return (
                  <g key={n.id} transform={`translate(${n.x},${n.y - 7})`} opacity={dim ? 0.18 : 1} style={{ cursor: "pointer", transition: "opacity .2s" }} {...events}>
                    <circle r={n.r + 8} fill="transparent" />
                    {on && <circle r={n.r + 5} fill="none" stroke={KIND[kind].fg} strokeOpacity={0.3} strokeWidth={5} />}
                    <circle r={n.r} fill={KIND[kind].fg} stroke="var(--bg)" strokeWidth={2} />
                    {showLabel && <text y={n.r + 14} textAnchor="middle" fontSize={12.5} fontWeight={on ? 650 : 500} fill="var(--soft)"
                      style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3.5, strokeLinejoin: "round" }}>{short(n.name, 24)}</text>}
                    <title>{`${n.name} · ${KIND[kind].label} · ${plural(n.notes, "note")}`}</title>
                  </g>
                );
              })}
            </svg>

            <div className="absolute left-2 bottom-2 flex flex-col gap-1 card p-1" style={{ borderRadius: 12 }}>
              <IconButton label="Zoom in" onClick={() => zoomAt(1 / 1.35, view.x + view.w / 2, view.y + view.h / 2)} size={32}>{I.plus}</IconButton>
              <IconButton label="Zoom out" onClick={() => zoomAt(1.35, view.x + view.w / 2, view.y + view.h / 2)} size={32}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg></IconButton>
              <IconButton label="Fit to screen" onClick={() => setView(fit(graph.items, ratio))} size={32}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg></IconButton>
              <IconButton label={full ? "Leave full screen" : "Full screen"} onClick={toggleFull} size={32}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  {full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />}</svg>
              </IconButton>
            </div>

            {sel && data && (sel.kind === "note"
              ? <NoteSide id={sel.id} data={data} onClose={() => setPicked(null)} onPick={setPicked} onOpenNote={onOpenNote} />
              : <Side id={sel.id} data={data} onClose={() => setPicked(null)} onPick={setPicked} onOpenNote={onOpenNote} onOpenEntity={onOpenEntity} />)}
          </div>
        )}

        {/* Legend: tap a kind to show or hide it. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2" role="group" aria-label="Show or hide kinds">
          <span className="inline-flex items-center gap-2 text-[14px] text-soft"><span className="w-5 h-3 rounded-[4px] border border-line-strong bg-[var(--card)]" aria-hidden />Notes</span>
          {KINDS.map(k => (
            <button key={k} onClick={() => setHidden(h => { const x = new Set(h); if (x.has(k)) x.delete(k); else x.add(k); return x; })} aria-pressed={!hidden.has(k)}
              className={`inline-flex items-center gap-2 text-[14px] ${hidden.has(k) ? "text-faint line-through" : "text-soft"}`}>
              <span className="w-3 h-3 rounded-full" style={{ background: KIND[k].fg, opacity: hidden.has(k) ? 0.35 : 1 }} aria-hidden />{KIND_LABEL[k]}
            </button>
          ))}
          {(graph?.left || everything) ? (
            <button onClick={() => setEverything(e => !e)} aria-pressed={everything} className="ml-auto text-[14px] text-soft underline underline-offset-2">
              {everything ? "Only what comes up more than once" : `Show everything (${graph?.left} more in one note each)`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const panel = "absolute top-2 right-2 bottom-2 w-[min(320px,calc(100%-16px))] card p-4 overflow-y-auto anim-fade";

/** One note: where it's filed, what it says, and everything it mentions. */
function NoteSide({ id, data, onClose, onPick, onOpenNote }: {
  id: string; data: Data; onClose: () => void; onPick: (id: string) => void; onOpenNote: (id: string) => void;
}) {
  const note = data.notes.find(n => n.id === id)!;
  const things = note.entities.map(e => data.nodes.find(n => n.id === e)).filter(Boolean) as Data["nodes"];
  return (
    <aside className={panel} style={{ borderRadius: 16 }}>
      <header className="flex items-start gap-1 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-faint">{note.category || "Note"} · {day(note.created_at)}</p>
          <h2 className="font-display text-[18px] font-semibold leading-snug">{note.title}</h2>
        </div>
        <IconButton label="Close" onClick={onClose} size={30}>{I.x}</IconButton>
      </header>
      {note.preview && <p className="text-[13px] text-muted mb-3">{note.preview}</p>}
      <button onClick={() => onOpenNote(id)} className="btn btn-primary h-8 px-3 text-[13px] mb-3">Open note</button>
      {!!things.length && (
        <section>
          <h3 className="text-[12px] font-semibold text-soft mb-1">Mentions · {things.length}</h3>
          <div className="flex flex-wrap gap-1">
            {things.map(t => (
              <button key={t.id} onClick={() => onPick(t.id)} className="h-7 px-2.5 rounded-full border border-line text-[12.5px] text-soft hover:border-line-strong inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: KIND[t.kind].fg }} aria-hidden />{t.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

/** Everything one thing connects to: what's stated about it, what comes up with it (and how often), and its notes. */
function Side({ id, data, onClose, onPick, onOpenNote, onOpenEntity }: {
  id: string; data: Data; onClose: () => void; onPick: (id: string) => void; onOpenNote: (id: string) => void; onOpenEntity: (id: string) => void;
}) {
  const node = data.nodes.find(n => n.id === id)!;
  const byId = Object.fromEntries(data.nodes.map(n => [n.id, n]));
  const ties = data.edges.filter(e => e.a === id || e.b === id).map(e => ({ other: byId[e.a === id ? e.b : e.a], w: e.notes })).filter(t => t.other).sort((a, b) => b.w - a.w);
  const facts = data.facts.filter(f => f.a === id || f.b === id);
  const notes = data.notes.filter(n => n.entities.includes(id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <aside className={panel} style={{ borderRadius: 16, borderTop: `3px solid ${KIND[node.kind].fg}` }}>
      <header className="flex items-start gap-1 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-faint">{KIND[node.kind].label} · {plural(node.notes, "note")}</p>
          <h2 className="font-display text-[18px] font-semibold leading-snug">{node.name}</h2>
          {node.meaning && <p className="text-[12.5px] text-muted">{node.meaning}</p>}
        </div>
        <IconButton label="Close" onClick={onClose} size={30}>{I.x}</IconButton>
      </header>
      <button onClick={() => onOpenEntity(id)} className="btn btn-primary h-8 px-3 text-[13px] mb-3">Open profile</button>
      {!!facts.length && (
        <section className="mb-3">
          <h3 className="text-[12px] font-semibold text-soft mb-1">Known facts</h3>
          {facts.map(f => <p key={`${f.a}${f.b}${f.relation}`} className="text-[13px] text-ink">{byId[f.a]?.name} <i className="text-muted">{f.relation}</i> {byId[f.b]?.name}</p>)}
        </section>
      )}
      {!!ties.length && (
        <section className="mb-3">
          <h3 className="text-[12px] font-semibold text-soft mb-1">Comes up with · {ties.length}</h3>
          <div className="flex flex-wrap gap-1">
            {ties.map(({ other, w }) => (
              <button key={other.id} onClick={() => onPick(other.id)} className="h-7 px-2.5 rounded-full border border-line text-[12.5px] text-soft hover:border-line-strong inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: KIND[other.kind].fg }} aria-hidden />{other.name}{w > 1 && <span className="text-faint tabular-nums">×{w}</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3 className="text-[12px] font-semibold text-soft mb-1">Notes · {notes.length}</h3>
        {notes.map(n => (
          <button key={n.id} onClick={() => onOpenNote(n.id)} className="w-full text-left px-2.5 py-2 -mx-1 rounded-lg hover:bg-surface">
            <span className="block text-[13px] font-medium text-ink truncate">{n.title}</span>
            <span className="block text-[11.5px] text-faint">{n.category ? `${n.category} · ` : ""}{day(n.created_at)}</span>
            {n.preview && <span className="block text-[12px] text-muted line-clamp-2 mt-0.5">{n.preview}</span>}
          </button>
        ))}
      </section>
    </aside>
  );
}
