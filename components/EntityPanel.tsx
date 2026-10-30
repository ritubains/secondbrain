"use client";
// Side panel: everything about one person, place, office, group or word — opens over whatever screen you're on.
// Promises still open (tick them kept), issues raised, dates, the notes, and who/where it goes with.
// Edit the name, meaning and other spellings, or merge it into another entry; your edits are kept.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ago, day, plural } from "../lib/format";
import { KIND } from "../lib/kinds";
import type { Entity, EntityDetail, EntityKind } from "../lib/types";
import IconButton, { I } from "./IconButton";

type Props = {
  entityId: string | null;
  reloadKey: number;
  onClose: () => void;
  onOpenEntity: (id: string) => void;
  onOpenNote: (id: string) => void;
  onChanged: () => void;            // after an edit, merge or delete — lists refresh
  onNotice: (msg: string) => void;
  onGraph: (id: string) => void;    // show this entry in the knowledge graph
};

const TREND: Record<string, string> = { new: "New", growing: "Coming up more", quiet: "Gone quiet", steady: "", "": "" };

export default function EntityPanel({ entityId, reloadKey, onClose, onOpenEntity, onOpenNote, onChanged, onNotice, onGraph }: Props) {
  const [e, setE] = useState<EntityDetail | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!entityId) { setE(null); return; }
    setEditing(false);
    api(`/entities/${entityId}`).then(setE, () => { onNotice("That entry no longer exists."); onClose(); });
  }, [entityId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!entityId) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !document.querySelector("[role=dialog][aria-modal=true]")) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [entityId, onClose]);

  if (!entityId) return null;

  /** Mark a promise kept (or an issue dealt with); it leaves the open list. */
  const keep = async (id: string) => {
    if (!e) return;
    setE({ ...e, items: e.items.filter(i => i.id !== id) });
    try { await api("/items", { method: "PATCH", body: JSON.stringify({ ids: [id], done: true }) }); onChanged(); }
    catch { onNotice("Couldn't save that. Is the API running?"); }
  };

  /** Add or remove a fact on this entry's profile. */
  const addFact = async (relation: string, object: string) => {
    if (!e) return;
    try { const r = await api(`/entities/${e.id}/facts`, { method: "POST", body: JSON.stringify({ relation, object }) }); setE({ ...e, facts: r.facts }); onChanged(); }
    catch { onNotice("Couldn't add the fact. Is the API running?"); }
  };
  const removeFact = async (id: string) => {
    if (!e) return;
    setE({ ...e, facts: e.facts.filter(f => f.id !== id) });
    try { await api(`/relations/${id}`, { method: "DELETE" }); onChanged(); } catch { onNotice("Couldn't remove it. Is the API running?"); }
  };

  const remove = async () => {
    if (!e || !confirm(`Forget "${e.name}"? Its notes stay; a later note may teach it again.`)) return;
    try { await api(`/entities/${e.id}`, { method: "DELETE" }); onChanged(); onClose(); }
    catch { onNotice("Couldn't delete that. Is the API running?"); }
  };

  const promises = e?.items.filter(i => i.kind === "promise") || [];
  const issues = e?.items.filter(i => i.kind === "issue") || [];
  const k = e ? KIND[e.kind] : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" style={{ background: "rgb(var(--shadow) / .22)" }}
      onMouseDown={ev => { if (ev.target === ev.currentTarget) onClose(); }}>
      <aside aria-label="Details" className="panel-in h-full w-full sm:w-[560px] overflow-y-auto bg-[var(--page)] border-l border-line p-4 sm:p-5
        shadow-[-24px_0_60px_-30px_rgb(var(--shadow)/.5)]">
        <div className="flex items-center gap-1 mb-3">
          <IconButton label="Close" onClick={onClose}>{I.back}</IconButton>
          <span className="flex-1" />
          {e && <button onClick={() => onGraph(e.id)} className="btn h-8 px-2.5 text-[13px] text-soft gap-1.5 hover:bg-surface">{I.map} Graph</button>}
          {e && <IconButton label="Edit" onClick={() => setEditing(v => !v)}>{I.edit}</IconButton>}
          {e && <IconButton label="Forget this entry" tone="danger" onClick={remove}>{I.trash}</IconButton>}
        </div>

        {!e || !k ? <div className="skeleton h-[420px] rounded-[14px]" aria-busy="true" aria-label="Loading" /> : (
          <div className="anim-fade flex flex-col gap-4">
            <header className="flex items-start gap-3">
              <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 [&_svg]:w-5 [&_svg]:h-5" style={{ background: k.bg, color: k.fg }}>{k.icon}</span>
              <div className="min-w-0">
                <h2 className="font-display text-[22px] font-semibold tracking-tight leading-tight">{e.name}</h2>
                <p className="text-[13px] text-muted mt-0.5">
                  {k.label}{e.meaning && <> · {e.meaning}</>} · {plural(e.mentions, "note")} · last {ago(e.last_seen)}
                  {TREND[e.trend] && <span className="text-primary"> · {TREND[e.trend]}</span>}
                </p>
                {!!e.aliases.length && <p className="text-[12.5px] text-faint mt-0.5">Also written: {e.aliases.join(", ")}</p>}
              </div>
            </header>

            {editing && <EditEntity e={e} onSaved={next => { setE({ ...e, ...next }); setEditing(false); onChanged(); }}
              onMerged={id => { onChanged(); onOpenEntity(id); }} onNotice={onNotice} />}

            <Section title="Profile">
              {e.facts.map(f => (
                <Row key={f.id} text={f.text} onOpen={f.note_id ? () => onOpenNote(f.note_id!) : undefined}
                  action={<IconButton label={`Remove "${f.text}"`} tone="danger" size={26} onClick={() => removeFact(f.id)}>{I.x}</IconButton>} />
              ))}
              {!e.facts.length && <p className="text-[13px] text-faint">No facts yet. They're picked up from notes ("Saroj is MC of Ward 18"), or add one.</p>}
              <AddFact name={e.name} onAdd={addFact} />
            </Section>

            {!!promises.length && (
              <Section title="Waiting on you">
                {promises.map(p => (
                  <Row key={p.id} onOpen={() => onOpenNote(p.note_id)} text={p.text} sub={`${ago(p.created_at)} · ${p.title}`}
                    action={<IconButton label={`Mark "${p.text}" kept`} size={28} onClick={() => keep(p.id)}>{I.check}</IconButton>} />
                ))}
              </Section>
            )}
            {!!issues.length && (
              <Section title={e.kind === "place" ? "Issues raised here" : "Raised by them"}>
                {issues.map(i => <Row key={i.id} onOpen={() => onOpenNote(i.note_id)} text={i.text} sub={`${day(i.created_at)}${i.who.length ? ` · ${i.who.join(", ")}` : ""}`} />)}
              </Section>
            )}
            {!!e.events.length && (
              <Section title="Dates">
                {e.events.map(ev => <Row key={ev.id} text={ev.text} sub={new Date(ev.due_at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", ...(ev.due_has_time ? { hour: "numeric", minute: "2-digit" } : {}) })} />)}
              </Section>
            )}
            {!!e.related.length && (
              <Section title="Comes up with">
                <div className="flex flex-wrap gap-1.5">
                  {e.related.map(r => (
                    <button key={r.id} onClick={() => onOpenEntity(r.id)} className="chip-lift h-7 px-2.5 rounded-lg text-[13px] inline-flex items-center gap-1.5 [&_svg]:w-3.5 [&_svg]:h-3.5"
                      style={{ background: KIND[r.kind].bg, color: KIND[r.kind].fg }}>{KIND[r.kind].icon}{r.name}<span className="opacity-60 tabular-nums">{r.notes}</span></button>
                  ))}
                </div>
              </Section>
            )}
            <Section title={`Notes (${e.notes.length})`}>
              {e.notes.map(n => <Row key={n.id} onOpen={() => onOpenNote(n.id)} text={n.title || n.raw_text.slice(0, 60)} sub={`${day(n.created_at!)} · ${n.raw_text.slice(0, 90)}`} />)}
            </Section>
          </div>
        )}
      </aside>
    </div>
  );
}

/** A titled block in the panel. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-3.5" style={{ borderRadius: 14 }}>
      <h3 className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-faint mb-2">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

/** One line: text, a quiet second line, optionally tappable and with an action on the right. */
function Row({ text, sub, onOpen, action }: { text: string; sub?: string; onOpen?: () => void; action?: React.ReactNode }) {
  const body = (
    <span className="flex-1 min-w-0">
      <span className="block text-[14px] text-ink leading-snug">{text}</span>
      {sub && <span className="block text-[12px] text-faint truncate">{sub}</span>}
    </span>
  );
  return (
    <div className="flex items-center gap-2">
      {onOpen ? <button onClick={onOpen} className="flex-1 min-w-0 text-left hover:opacity-80">{body}</button> : body}
      {action}
    </div>
  );
}

/** Correct an entry: name, kind, meaning, other spellings — or merge it into another one. */
function EditEntity({ e, onSaved, onMerged, onNotice }: { e: EntityDetail; onSaved: (e: Entity) => void; onMerged: (id: string) => void; onNotice: (m: string) => void }) {
  const [name, setName] = useState(e.name);
  const [kind, setKind] = useState<EntityKind>(e.kind);
  const [meaning, setMeaning] = useState(e.meaning);
  const [aliases, setAliases] = useState(e.aliases.join(", "));
  const [mergeQuery, setMergeQuery] = useState("");
  const [others, setOthers] = useState<Entity[]>([]);
  const field = "field h-9 px-3 text-[13.5px] bg-bg border border-line rounded-xl placeholder:text-faint w-full";

  useEffect(() => {
    const group = e.kind === "place" ? "places" : e.kind === "issue" ? "issues" : e.kind === "term" ? "words" : "people";
    api(`/entities?group=${group}`).then((r: { items: Entity[] }) => setOthers(r.items.filter(x => x.id !== e.id)), () => {});
  }, [e.id, e.kind]);

  const save = async () => {
    try {
      const next = await api(`/entities/${e.id}`, { method: "PUT", body: JSON.stringify({
        name, kind, meaning, aliases: aliases.split(",").map(a => a.trim()).filter(Boolean) }) });
      onSaved(next);
    } catch (err) {
      onNotice((err as { status?: number })?.status === 409 ? "Another entry already has that name. Merge them instead." : "Couldn't save. Is the API running?");
    }
  };
  const merge = async (into: Entity) => {
    if (!confirm(`Merge "${e.name}" into "${into.name}"? Its notes and spellings move there.`)) return;
    try { await api(`/entities/${e.id}/merge`, { method: "POST", body: JSON.stringify({ into: into.id }) }); onMerged(into.id); }
    catch { onNotice("Couldn't merge. Is the API running?"); }
  };
  const matches = mergeQuery.trim() ? others.filter(o => o.name.toLowerCase().includes(mergeQuery.trim().toLowerCase())).slice(0, 5) : [];

  return (
    <div className="card p-3.5 flex flex-col gap-2" style={{ borderRadius: 14 }}>
      <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
        <input value={name} onChange={ev => setName(ev.target.value)} aria-label="Name" className={field} />
        <select value={kind} onChange={ev => setKind(ev.target.value as EntityKind)} aria-label="Kind" className={field}>
          {(Object.keys(KIND) as EntityKind[]).map(k => <option key={k} value={k}>{KIND[k].label}</option>)}
        </select>
      </div>
      <input value={meaning} onChange={ev => setMeaning(ev.target.value)} placeholder="What it means (for words like XEN)" aria-label="Meaning" className={field} />
      <input value={aliases} onChange={ev => setAliases(ev.target.value)} placeholder="Other spellings, comma-separated" aria-label="Other spellings" className={field} />
      <div className="flex justify-end"><button onClick={save} className="btn btn-primary h-8 px-4 text-[13px]">Save</button></div>
      <div className="pt-2 border-t border-line">
        <input value={mergeQuery} onChange={ev => setMergeQuery(ev.target.value)} placeholder="Same as… (find the entry to merge into)" aria-label="Merge into" className={field} />
        {matches.map(o => (
          <button key={o.id} onClick={() => merge(o)} className="w-full text-left text-[13.5px] px-2 h-8 rounded-lg hover:bg-surface">Merge into <b>{o.name}</b></button>
        ))}
      </div>
    </div>
  );
}

/** "<name> [is MC of] [Ward 18]" — a fact to add to the profile. */
function AddFact({ name, onAdd }: { name: string; onAdd: (relation: string, object: string) => void }) {
  const [relation, setRelation] = useState("");
  const [object, setObject] = useState("");
  const field = "field h-8 px-2.5 text-[13px] bg-bg border border-line rounded-lg min-w-0";
  return (
    <form onSubmit={ev => { ev.preventDefault(); if (relation.trim() && object.trim()) { onAdd(relation.trim(), object.trim()); setRelation(""); setObject(""); } }}
      className="flex flex-wrap items-center gap-1.5 pt-1">
      <span className="text-[13px] text-muted">{name}</span>
      <input value={relation} onChange={ev => setRelation(ev.target.value)} placeholder="is MC of" aria-label="Relation" className={`${field} w-[120px]`} />
      <input value={object} onChange={ev => setObject(ev.target.value)} placeholder="Ward 18" aria-label="Related to" className={`${field} flex-1`} />
      <button disabled={!relation.trim() || !object.trim()} className="btn btn-ghost h-8 px-2.5 text-[13px]">Add</button>
    </form>
  );
}
