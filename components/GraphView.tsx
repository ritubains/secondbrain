"use client";
// Knowledge graph panel: a note, person/place/office/group/word, or idea in the middle, everything one step away on a
// ring around it, a label on every line ("mentions", "idea", "via Kheri Kalan", "is MC of"). Tap a node to make it
// the centre; Back retraces; Open shows the full details. Plain SVG, no graph library.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { KIND } from "../lib/kinds";
import type { GraphData, GraphNode } from "../lib/types";
import IconButton, { I } from "./IconButton";

export type GraphTarget = { kind: "note" | "entity" | "topic"; id: string };

type Props = {
  start: GraphTarget | null;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  onOpenEntity: (id: string) => void;
  onOpenTopic: (id: string) => void;
};

const W = 760, H = 560, CX = W / 2, CY = H / 2;
// The letter in each circle, and the order around the ring (so the same kinds sit together).
const LETTER: Record<string, string> = { person: "P", place: "L", official: "O", group: "G", issue: "!", term: "W", topic: "#", note: "N", value: "·" };
const ORDER = ["person", "official", "group", "place", "issue", "term", "topic", "note", "value"];

/** A node's colour: entity kinds use their own, ideas the primary colour, notes and plain values quiet tones. */
function colour(kind: GraphNode["kind"]): { fg: string; bg: string } {
  if (kind === "topic") return { fg: "var(--primary)", bg: "var(--primary-50)" };
  if (kind === "note") return { fg: "var(--t-note)", bg: "var(--t-note-bg)" };
  if (kind === "value") return { fg: "var(--faint)", bg: "var(--surface)" };
  return KIND[kind];
}

/** "note:…" → { kind: "note", id } (values aren't navigable). */
function target(gid: string): GraphTarget | null {
  const [k, id] = gid.split(":");
  return k === "note" || k === "entity" || k === "topic" ? { kind: k, id } : null;
}

/** Positions: the centre in the middle, the rest on one ring (two when crowded), grouped by kind. */
function layout(g: GraphData): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = { [g.center]: { x: CX, y: CY } };
  const rest = g.nodes.filter(n => n.id !== g.center).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const rings = rest.length > 14 ? 2 : 1;
  rest.forEach((n, i) => {
    const ring = rings === 2 ? i % 2 : 0;
    const r = ring ? 245 : 185;
    const angle = (i / rest.length) * 2 * Math.PI - Math.PI / 2;
    pos[n.id] = { x: CX + r * Math.cos(angle) * 1.25, y: CY + r * Math.sin(angle) * 0.92 };
  });
  return pos;
}

export default function GraphView({ start, onClose, onOpenNote, onOpenEntity, onOpenTopic }: Props) {
  const [trail, setTrail] = useState<GraphTarget[]>([]);
  const [data, setData] = useState<GraphData | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const current = trail[trail.length - 1];

  useEffect(() => { setTrail(start ? [start] : []); }, [start]);
  useEffect(() => {
    if (!current) return;
    setData(null);
    api(`/graph?kind=${current.kind}&id=${current.id}`).then(setData, () => setData({ center: "", nodes: [], edges: [] }));
  }, [current?.kind, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!start) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [start, onClose]);

  if (!start || !current) return null;

  /** Open the full details of what's at the centre. */
  const open = () => {
    if (current.kind === "note") onOpenNote(current.id);
    else if (current.kind === "entity") onOpenEntity(current.id);
    else onOpenTopic(current.id);
    onClose();
  };
  const pos = data ? layout(data) : {};
  const center = data?.nodes.find(n => n.id === data.center);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 anim-fade" style={{ background: "rgb(var(--shadow) / .35)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section role="dialog" aria-label="Knowledge graph" className="card w-full max-w-[880px] p-3 sm:p-4" style={{ borderRadius: 20 }}>
        <header className="flex items-center gap-1 mb-1">
          {trail.length > 1 && <IconButton label="Back" onClick={() => setTrail(t => t.slice(0, -1))}>{I.back}</IconButton>}
          <h2 className="flex-1 min-w-0 truncate font-display text-[18px] font-semibold px-1">{center?.label || "…"}</h2>
          <button onClick={open} className="btn btn-ghost h-8 px-3 text-[13px]">Open</button>
          <IconButton label="Close" onClick={onClose}>{I.x}</IconButton>
        </header>
        <p className="text-[12px] text-faint px-1 mb-1">Tap anything to put it in the middle. Lines say how things are connected.</p>
        {!data ? <div className="skeleton h-[420px] rounded-xl" aria-busy="true" /> : !data.nodes.length ? (
          <p className="text-sm text-muted p-6 text-center">Nothing connected yet.</p>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`What ${center?.label} is connected to`}>
            {data.edges.map(e => {
              const a = pos[e.source], b = pos[e.target];
              if (!a || !b) return null;
              const fromCenter = e.source === data.center || e.target === data.center;
              const lit = hover && (e.source === hover || e.target === hover);
              // Lines between two outer nodes (facts) bend outward so they don't run through the middle.
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              const bend = fromCenter ? 0 : 0.25;
              const qx = mx + (mx - CX) * bend, qy = my + (my - CY) * bend;
              return (
                <g key={`${e.source}-${e.target}`} opacity={hover && !lit ? 0.25 : 1}>
                  <path d={`M${a.x},${a.y} Q${qx},${qy} ${b.x},${b.y}`} fill="none" stroke={fromCenter ? "var(--line-strong)" : "var(--primary)"}
                    strokeWidth={fromCenter ? 1.2 : 1.6} strokeDasharray={fromCenter ? "" : "4 3"} />
                  <text x={(mx + qx) / 2} y={(my + qy) / 2 - 3} textAnchor="middle" fontSize="10.5" fill={fromCenter ? "var(--faint)" : "var(--primary)"}
                    style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 }}>{e.label}</text>
                </g>
              );
            })}
            {data.nodes.map(n => {
              const p = pos[n.id];
              if (!p) return null;
              const c = colour(n.kind), isCenter = n.id === data.center, go = target(n.id);
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`} style={{ cursor: go && !isCenter ? "pointer" : "default" }}
                  onClick={() => { if (go && !isCenter) setTrail(t => [...t, go]); }}
                  onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
                  <circle r={isCenter ? 26 : 15} fill={c.bg} stroke={c.fg} strokeWidth={isCenter ? 2.5 : 1.5} />
                  <text y={isCenter ? 42 : 29} textAnchor="middle" fontSize={isCenter ? 13 : 11.5} fontWeight={isCenter ? 600 : 500} fill="var(--ink)"
                    style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 }}>{n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label}</text>
                  <text y={4} textAnchor="middle" fontSize="10" fontWeight={700} fill={c.fg}>
                    {LETTER[n.kind]}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-faint px-1 mt-1">
          <span><b style={{ color: "var(--k-person)" }}>P</b> person</span><span><b style={{ color: "var(--k-place)" }}>L</b> place</span>
          <span><b style={{ color: "var(--k-official)" }}>O</b> office</span><span><b style={{ color: "var(--k-group)" }}>G</b> group</span>
          <span><b style={{ color: "var(--primary)" }}>#</b> idea</span>
          <span><b style={{ color: "var(--t-note)" }}>N</b> note</span><span><span style={{ color: "var(--primary)" }}>- - -</span> a fact between two</span>
        </p>
      </section>
    </div>
  );
}
