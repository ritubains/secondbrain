"use client";
// People, Places and Words: everything the notes mention, from the entities the pipeline stores.
// People: whoever is waiting on a promise first. Places: what's raised there. Words: the user's vocabulary.
// A card opens the side panel with everything about it.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ago, nameHash, plural } from "../lib/format";
import { KIND } from "../lib/kinds";
import type { Entity, EntityKind } from "../lib/types";
import IconButton, { I } from "./IconButton";

type Group = "people" | "places" | "issues" | "words";
type Props = { reloadKey: number; onOpenEntity: (id: string) => void; onNotice: (msg: string) => void; onChanged: () => void };

const TABS: [Group, string][] = [["people", "People"], ["places", "Places"], ["issues", "Issues"], ["words", "Words"]];
const TREND: Record<string, string> = { new: "new", growing: "coming up more", quiet: "gone quiet" };
// Stable avatar colour per person name.
const SWATCH = ["var(--k-person)", "var(--k-place)", "var(--k-issue)", "var(--t-person)", "var(--t-idea)", "var(--k-official)", "var(--t-expense)"];

export default function PeopleView({ reloadKey, onOpenEntity, onNotice, onChanged }: Props) {
  const [group, setGroup] = useState<Group>("people");
  const [items, setItems] = useState<Entity[] | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setItems(null);
    api(`/entities?group=${group}`).then((r: { items: Entity[] }) => setItems(r.items), () => setItems([]));
  }, [group, reloadKey]);

  /** Mark a promise kept, right on the card. */
  const keep = async (e: Entity, id: string) => {
    setItems(list => (list || []).map(x => (x.id === e.id ? { ...x, waiting: (x.waiting || []).filter(w => w.id !== id) } : x)));
    try { await api("/items", { method: "PATCH", body: JSON.stringify({ ids: [id], done: true }) }); onChanged(); }
    catch { onNotice("Couldn't save that. Is the API running?"); }
  };

  const needle = q.trim().toLowerCase();
  const shown = (items || []).filter(e => !needle || [e.name, e.meaning, ...e.aliases].some(s => s.toLowerCase().includes(needle)));

  return (
    <div className="anim-fade">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h1 className="font-display text-[26px] font-semibold tracking-tight mr-2 hidden md:block">People</h1>
        <div className="seg" role="tablist" aria-label="Show">
          <span className="seg-pill" aria-hidden style={{ width: "calc(33.33% - 2px)", transform: `translateX(${TABS.findIndex(t => t[0] === group) * 100}%)` }} />
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={group === k} onClick={() => setGroup(k)}
              className={`relative z-10 px-4 h-8 rounded-[7px] text-[13px] font-medium transition-colors ${group === k ? "text-ink" : "text-muted hover:text-soft"}`}>{label}</button>
          ))}
        </div>
        <div className="relative basis-full sm:basis-auto sm:w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none">{I.search}</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find…" aria-label="Find"
            className="field w-full h-9 pl-9 pr-3 text-[13.5px] bg-bg border border-line rounded-xl placeholder:text-faint" />
        </div>
        {group === "words" && !adding && (
          <button onClick={() => setAdding(true)} className="btn btn-primary h-8 px-3 text-[13px] gap-1.5 ml-auto">{I.plus} Add a word</button>
        )}
      </div>

      {group === "words" && adding && (
        <AddWord onDone={added => { setAdding(false); if (added) { setItems(l => [added, ...(l || [])]); onChanged(); } }} onNotice={onNotice} />
      )}

      {!items ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-[150px] rounded-[18px]" />)}</div>
      ) : !shown.length ? (
        <div className="text-center py-16 px-4">
          <h2 className="text-[18px]">{needle ? "Nothing matches" : "Nothing here yet"}</h2>
          <p className="text-sm text-muted mt-1.5 max-w-sm mx-auto">
            {group === "words" ? "Abbreviations and local words from your notes collect here, with what they mean. Add your own too."
              : "Write about who you met and where, and they show up here with what they asked for and what you promised."}
          </p>
        </div>
      ) : group === "words" ? (
        <ul className="card divide-y divide-line overflow-hidden" style={{ borderRadius: 16 }}>
          {shown.map(e => (
            <li key={e.id}>
              <button onClick={() => onOpenEntity(e.id)} className="w-full text-left px-4 py-3 hover:bg-surface">
                <span className="text-[14.5px] font-semibold text-ink">{e.name}</span>
                {e.meaning && <span className="text-[14px] text-soft"> · {e.meaning}</span>}
                <span className="block text-[12px] text-faint mt-0.5">
                  {e.aliases.length ? `Also: ${e.aliases.join(", ")} · ` : ""}{e.origin === "you" ? "Added by you" : plural(e.mentions, "note")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 items-start">
          {shown.map(e => <Card key={e.id} e={e} onOpen={() => onOpenEntity(e.id)} onKeep={id => keep(e, id)} />)}
        </div>
      )}
    </div>
  );
}

/** A person or place card: who/where, how often, promises waiting (tick kept), what was raised. */
function Card({ e, onOpen, onKeep }: { e: Entity; onOpen: () => void; onKeep: (itemId: string) => void }) {
  const k = KIND[e.kind];
  const color = e.kind === "person" ? SWATCH[nameHash(e.name) % SWATCH.length] : k.fg;
  return (
    <article onClick={onOpen} role="button" tabIndex={0} onKeyDown={ev => { if (ev.key === "Enter") onOpen(); }}
      className={`card p-4 cursor-pointer flex flex-col gap-3 hover:border-line-strong transition-shadow ${e.waiting?.length ? "ring-1 ring-[color-mix(in_srgb,var(--t-idea)_40%,transparent)]" : ""}`}
      style={{ borderRadius: 18 }}>
      <header className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-semibold text-[15px] [&_svg]:w-5 [&_svg]:h-5"
          style={{ background: `color-mix(in srgb, ${color} 22%, var(--bg))`, color }} aria-hidden>
          {e.kind === "person" ? initials(e.name) : k.icon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15.5px] font-semibold leading-tight truncate">{e.name}</h3>
          <p className="text-[12.5px] text-muted truncate">{e.role ? e.role.charAt(0).toUpperCase() + e.role.slice(1) : k.label}{e.with?.length ? ` · ${e.with.join(", ")}` : ""}</p>
        </div>
      </header>
      {!!e.waiting?.length && (
        <div className="rounded-xl px-3 py-2 flex flex-col gap-1.5" style={{ background: "var(--t-idea-bg)", color: "var(--t-idea)" }}>
          <p className="text-[11px] font-semibold uppercase tracking-[.06em]">Waiting on you</p>
          {e.waiting.map(w => (
            <div key={w.id} className="flex items-start gap-2">
              <span className="flex-1 min-w-0 text-[13.5px] font-medium leading-snug">{w.text} <span className="font-normal opacity-75">· {ago(w.created_at)}</span></span>
              <IconButton label={`Mark "${w.text}" kept`} size={26} onClick={ev => { ev.stopPropagation(); onKeep(w.id); }} className="!text-current -mr-1">{I.check}</IconButton>
            </div>
          ))}
        </div>
      )}
      {!!e.raised?.length && (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint">{e.kind === "place" ? "Raised here" : "Asked for"}</p>
          {e.raised.slice(0, 3).map(r => <span key={r.id} className="truncate text-[13.5px] text-soft">{r.text}</span>)}
        </div>
      )}
      <footer className="pt-2 border-t border-line flex items-center gap-2 text-[12px] text-muted">
        <span>Last {ago(e.last_seen)}{TREND[e.trend] ? ` · ${TREND[e.trend]}` : ""}</span>
        <span className="ml-auto tabular-nums text-faint">{plural(e.mentions, "note")}</span>
      </footer>
    </article>
  );
}

/** "Jaswant Kaur" → "JK"; titles like "Sarpanch" are skipped. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(w => !/^(sarpanch|master|baba|bibi|ssp|dr|mr|mrs|ms)$/i.test(w));
  return ((words[0]?.[0] || "") + (words.length > 1 ? words[words.length - 1][0] : words[0]?.[1] || "")).toUpperCase();
}

/** The form for a word the app should know: the word, what it means, other spellings. */
function AddWord({ onDone, onNotice }: { onDone: (e: Entity | null) => void; onNotice: (m: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<EntityKind>("term");
  const [meaning, setMeaning] = useState("");
  const [aliases, setAliases] = useState("");
  const field = "field h-9 px-3 text-[13.5px] bg-bg border border-line rounded-xl placeholder:text-faint";
  const save = async () => {
    try {
      onDone(await api("/entities", { method: "POST", body: JSON.stringify({
        name, kind, meaning, aliases: aliases.split(",").map(a => a.trim()).filter(Boolean) }) }));
    } catch { onNotice("Couldn't add that. Is the API running?"); }
  };
  return (
    <form onSubmit={ev => { ev.preventDefault(); if (name.trim()) save(); }} className="card p-3 mb-3 grid gap-2 sm:grid-cols-[1fr_150px]" style={{ borderRadius: 16 }}>
      <input value={name} onChange={ev => setName(ev.target.value)} autoFocus placeholder="Word or name, e.g. XEN" aria-label="Word" className={field} />
      <select value={kind} onChange={ev => setKind(ev.target.value as EntityKind)} aria-label="Kind" className={field}>
        {(Object.keys(KIND) as EntityKind[]).map(k => <option key={k} value={k}>{KIND[k].label}</option>)}
      </select>
      <input value={meaning} onChange={ev => setMeaning(ev.target.value)} placeholder="What it means, e.g. Executive Engineer" aria-label="Meaning" className={`${field} sm:col-span-2`} />
      <input value={aliases} onChange={ev => setAliases(ev.target.value)} placeholder="Other spellings, comma-separated" aria-label="Other spellings" className={`${field} sm:col-span-2`} />
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={() => onDone(null)} className="btn btn-ghost h-8 px-3 text-[13px]">Cancel</button>
        <button type="submit" disabled={!name.trim()} className="btn btn-primary h-8 px-4 text-[13px]">Add</button>
      </div>
    </form>
  );
}
