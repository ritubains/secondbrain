"use client";
// Topics on the Notes page: one chip per idea the notes are about (later notes on the same idea join it). Tap one to see all its notes;
// the header above them shows who and where it involves, related topics, and lets you rename, merge, delete
// it or turn it into a project.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ago, plural } from "../lib/format";
import { KIND } from "../lib/kinds";
import type { Topic, TopicDetail } from "../lib/types";
import IconButton, { I } from "./IconButton";
import Menu from "./Menu";

type Props = {
  reloadKey: number;
  activeId: string | null;
  onPick: (id: string | null) => void;
  onOpenEntity: (id: string) => void;
  onOpenProject: (id: string) => void;
  onGraph: (id: string) => void;      // show this idea in the knowledge graph
  onChanged: () => void;
  onNotice: (msg: string) => void;
};

const TREND: Record<string, string> = { new: "new", growing: "growing", quiet: "gone quiet" };

export default function TopicBar({ reloadKey, activeId, onPick, onOpenEntity, onOpenProject, onGraph, onChanged, onNotice }: Props) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => { api("/topics").then((r: { topics: Topic[] }) => setTopics(r.topics), () => {}); }, [reloadKey]);
  useEffect(() => {
    setRenaming(false); setMerging(false);
    if (!activeId) { setDetail(null); return; }
    api(`/topics/${activeId}`).then(setDetail, () => { setDetail(null); onPick(null); });
  }, [activeId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!topics.length) return null;

  /** Run a topic action, then refresh. */
  const act = async (call: () => Promise<unknown>, fail: string) => {
    try { await call(); onChanged(); } catch { onNotice(fail); }
  };
  const rename = (name: string) => act(async () => {
    await api(`/topics/${activeId}`, { method: "PUT", body: JSON.stringify({ name }) }); setRenaming(false);
  }, "Couldn't rename it. Another topic may already have that name; merge them instead.");
  const merge = (into: string) => act(async () => {
    await api(`/topics/${activeId}/merge`, { method: "POST", body: JSON.stringify({ into }) }); onPick(into);
  }, "Couldn't merge. Is the API running?");
  const remove = () => {
    if (!detail || !confirm(`Delete the topic "${detail.name}"? Its notes stay.`)) return;
    act(async () => { await api(`/topics/${activeId}`, { method: "DELETE" }); onPick(null); }, "Couldn't delete it.");
  };
  const toProject = () => act(async () => {
    const r = await api(`/topics/${activeId}/project`, { method: "POST", body: "{}" });
    onOpenProject(r.project_id);
  }, "Couldn't make the project.");

  return (
    <div className="mb-4">
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="Topics">
        <span className="shrink-0 self-center text-[11.5px] font-semibold uppercase tracking-[.06em] text-faint mr-1">Topics</span>
        {topics.map(t => (
          <button key={t.id} role="radio" aria-checked={activeId === t.id} onClick={() => onPick(activeId === t.id ? null : t.id)}
            className={`chip-lift shrink-0 h-8 px-3 rounded-full border text-[13px] font-medium ${activeId === t.id ? "bg-primary-50 border-primary-100 text-primary" : "border-line text-soft hover:border-line-strong"}`}>
            {t.name} <span className="tabular-nums opacity-60">{t.notes}</span>
          </button>
        ))}
      </div>

      {detail && (
        <section className="card p-4 mt-2 anim-fade" style={{ borderRadius: 16 }}>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              {renaming ? (
                <form onSubmit={e => { e.preventDefault(); rename(String(new FormData(e.currentTarget).get("name") || "")); }} className="flex gap-2">
                  <input name="name" defaultValue={detail.name} autoFocus aria-label="Topic name" className="field h-9 px-3 text-[15px] bg-bg border border-line rounded-xl flex-1" />
                  <button className="btn btn-primary h-9 px-3 text-[13px]">Save</button>
                </form>
              ) : <h2 className="font-display text-[20px] font-semibold">{detail.name}</h2>}
              <p className="text-[12.5px] text-muted mt-0.5">
                {plural(detail.notes, "note")}{detail.last ? ` · last ${ago(detail.last)}` : ""}{TREND[detail.trend] ? ` · ${TREND[detail.trend]}` : ""}
              </p>
            </div>
            <Menu width={200}
              items={[
                { label: <>{I.map} See as a graph</>, onClick: () => onGraph(detail.id) },
                { label: <>{I.edit} Rename</>, onClick: () => setRenaming(true) },
                { label: <>{I.users} Merge into another…</>, onClick: () => setMerging(true) },
                { label: <>{I.board} Make it a project</>, onClick: toProject },
                "sep",
                { label: <>{I.trash} Delete topic</>, onClick: remove, danger: true },
              ]}
              trigger={({ open, toggle }) => <IconButton label="Topic actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>{I.dots}</IconButton>} />
          </div>

          {merging && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] text-muted">Same subject as:</span>
              {topics.filter(t => t.id !== detail.id).map(t => (
                <button key={t.id} onClick={() => merge(t.id)} className="chip-lift h-7 px-2.5 rounded-full border border-line text-[12.5px] hover:border-line-strong">{t.name}</button>
              ))}
              <button onClick={() => setMerging(false)} className="text-[12.5px] text-faint hover:underline ml-1">Cancel</button>
            </div>
          )}

          {(!!detail.entities.length || !!detail.related.length) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {detail.entities.map(e => (
                <button key={e.id} onClick={() => onOpenEntity(e.id)} className="chip-lift h-7 px-2.5 rounded-lg text-[12.5px] inline-flex items-center gap-1.5 [&_svg]:w-3.5 [&_svg]:h-3.5"
                  style={{ background: KIND[e.kind].bg, color: KIND[e.kind].fg }}>{KIND[e.kind].icon}{e.name}</button>
              ))}
              {detail.related.map(r => (
                <button key={r.id} onClick={() => onPick(r.id)} className="chip-lift h-7 px-2.5 rounded-full border border-line text-[12.5px] text-soft hover:border-line-strong">↔ {r.name}</button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
