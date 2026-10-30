"use client";
// Home: what needs you and what's moving, from GET /home. Ask a question to start a chat; tick off what's done;
// tap anything to open it. The mind map shows categories → ideas → notes as a tree. "Picks up from" shows new notes that continue something from weeks ago.
import { Children, useEffect, useState } from "react";
import { api } from "../lib/api";
import { ago, day, plural } from "../lib/format";
import { KIND } from "../lib/kinds";
import type { HomeData, MovingEntity } from "../lib/types";
import IconButton, { I } from "./IconButton";
import MindTree from "./MindTree";

type Props = {
  reloadKey: number;
  onAsk: (question: string) => void;       // start a chat with this question
  onOpenChat: (id: string) => void;
  onOpenNote: (id: string) => void;
  onOpenEntity: (id: string) => void;
  onOpenProject: (id: string) => void;
  onShowProjects: () => void;
  onSearch: (q: string) => void;           // show matching notes
  onOpenTopic: (id: string) => void;       // show a topic's notes
  onShowMap: () => void;                   // the full map of connections
  onRecord: () => void;
  onType: () => void;
  onNotice: (msg: string) => void;
};

/** "Good morning" … by the hour. */
function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** "Today 11:00", "Tomorrow", "Thu 23 Oct" — when an event is. */
function when(iso: string, hasTime: boolean): string {
  const d = new Date(iso), today = new Date();
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86400000);
  const date = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return hasTime ? `${date} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : date;
}

export default function HomeView(p: Props) {
  const [data, setData] = useState<HomeData | null>(null);
  const [failed, setFailed] = useState(false);
  const [question, setQuestion] = useState("");
  const [today, setToday] = useState<Date | null>(null); // set in the browser: the server's clock may differ
  useEffect(() => setToday(new Date()), []);

  // Load; while the briefing is still being written, look again a few times.
  useEffect(() => {
    let tries = 0, timer: ReturnType<typeof setTimeout>;
    const load = () => api("/home").then((r: HomeData) => {
      setData(r); setFailed(false);
      if (r.briefing_pending && tries++ < 8) timer = setTimeout(load, 3500);
    }, () => setFailed(true));
    load();
    return () => clearTimeout(timer);
  }, [p.reloadKey]);

  /** Tick an event or promise done; it leaves the list. */
  const tick = async (id: string) => {
    if (!data) return;
    setData({ ...data, coming_up: data.coming_up.filter(c => c.id !== id), waiting: data.waiting.filter(w => w.id !== id) });
    try { await api("/items", { method: "PATCH", body: JSON.stringify({ ids: [id], done: true }) }); }
    catch { p.onNotice("Couldn't save that. Is the API running?"); }
  };

  const ask = () => { if (question.trim()) { p.onAsk(question.trim()); setQuestion(""); } };

  return (
    <div className="anim-fade flex flex-col gap-5">
      <header>
        <p className="text-[13px] text-muted min-h-[19px]">{today?.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="font-display text-[32px] font-semibold tracking-tight min-h-[40px]">{today && greeting(today)}</h1>
      </header>

      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <button onClick={p.onRecord} className="card text-left p-5 btn-primary rounded-[20px] flex flex-col justify-end min-h-[130px]"
          style={{ background: "linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 70%, #000))", color: "#fff", border: 0 }}>
          <span className="text-[17px] font-semibold">Record a thought</span>
          <span className="text-[13px] opacity-80">Just talk. It files and connects itself.</span>
        </button>
        <section className="card p-4 flex flex-col gap-3" style={{ borderRadius: 20 }}>
          <p className="text-[14px] font-semibold flex items-center gap-1.5">{I.sparkle} Ask your notes</p>
          <form onSubmit={e => { e.preventDefault(); ask(); }} className="flex gap-2">
            <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="What did I promise in Massewal? What's pending with the EO?"
              aria-label="Ask your notes" className="field flex-1 min-w-0 h-11 px-3.5 text-[14px] bg-bg border border-line rounded-xl placeholder:text-faint" />
            <button type="submit" disabled={!question.trim()} className="btn btn-primary h-11 w-11 rounded-xl" aria-label="Ask">{I.arrow}</button>
          </form>
          {!!data?.conversations.length && (
            <div className="flex flex-wrap gap-1.5">
              {data.conversations.map(c => (
                <button key={c.id} onClick={() => p.onOpenChat(c.id)} className="chip-lift h-7 px-2.5 rounded-full border border-line text-[12.5px] text-soft hover:border-line-strong truncate max-w-[260px]">
                  ↺ {c.title}{c.project ? ` · ${c.project}` : ""}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {failed && !data ? <p className="text-[14px] text-muted">Couldn't reach the API. Start it and reload.</p> : !data ? (
        <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[180px] rounded-[20px]" />)}</div>
      ) : !data.overview.notes ? (
        <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
          <h2 className="text-[18px]">Nothing here yet</h2>
          <p className="text-sm text-muted mt-1.5 max-w-sm mx-auto">Record or type what's on your mind. Each note is read, filed and connected to the others, and this page fills up.</p>
          <button onClick={p.onType} className="btn btn-primary h-9 px-4 text-[13px] mt-5">Write your first note</button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
            <section className="card p-5" style={{ borderRadius: 20 }} aria-label="Your briefing">
              <p className="text-[12px] font-semibold uppercase tracking-[.08em] text-primary flex items-center gap-1.5">{I.sparkle} Your briefing</p>
              {data.briefing ? <p className="text-[16px] text-ink leading-relaxed mt-2.5">{data.briefing}</p>
                : data.briefing_pending ? <div className="mt-3 flex flex-col gap-2" aria-busy="true">{[94, 86, 60].map(w => <div key={w} className="skeleton h-4 rounded" style={{ width: `${w}%` }} />)}</div>
                : <p className="text-[15px] text-muted mt-2.5">Here's where things stand.</p>}
            </section>
            <div className="grid grid-cols-2 gap-3">
              <Stat value={data.overview.notes_month} label="notes this month" sub={`${data.overview.notes_prev} the month before`} color="var(--primary)" />
              <Stat value={data.overview.open_promises} label="promises open" sub="waiting on you" color="var(--t-idea)" />
              <Stat value={data.overview.upcoming_7d} label="this week" sub="dated in notes" color="var(--k-place)" />
              <Stat value={data.overview.people} label="people" sub={`${data.overview.places} places`} color="var(--k-person)" />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2 items-start">
            <Panel title="Coming up" hint="Dates said in your notes" empty="Nothing dated in the next three weeks.">
              {data.coming_up.map(c => (
                <Line key={c.id} onOpen={() => p.onOpenNote(c.note_id)} lead={<span className="text-[12px] font-semibold text-primary tabular-nums w-[92px] shrink-0">{when(c.due_at, c.due_has_time)}</span>}
                  text={c.text} sub={c.place || c.title} action={<IconButton label={`Mark "${c.text}" done`} size={28} onClick={() => tick(c.id)}>{I.check}</IconButton>} />
              ))}
            </Panel>
            <Panel title="Waiting on you" hint="Promises not yet kept, oldest first" empty="No open promises.">
              {data.waiting.map(w => (
                <Line key={w.id} onOpen={() => p.onOpenNote(w.note_id)} text={w.text}
                  sub={[w.who.length ? `to ${w.who.join(", ")}` : "", w.place || "", `${w.days} days`].filter(Boolean).join(" · ")}
                  action={<IconButton label={`Mark "${w.text}" kept`} size={28} onClick={() => tick(w.id)}>{I.check}</IconButton>} />
              ))}
            </Panel>
          </div>

          {!!data.picked_up.length && (
            <Panel title="Picks up from" hint="New notes that continue something from weeks ago">
              {data.picked_up.map(x => (
                <div key={`${x.new_id}${x.old_id}`} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-[14px]">
                  <button onClick={() => p.onOpenNote(x.new_id)} className="text-left font-medium text-ink hover:underline truncate">{x.new_title}</button>
                  <span className="text-faint text-[12.5px] shrink-0">continues ({x.gap_days} days earlier)</span>
                  <button onClick={() => p.onOpenNote(x.old_id)} className="text-left text-soft hover:underline truncate">{x.old_title}</button>
                  {!!x.shared.length && <span className="text-[12px] text-faint sm:ml-auto shrink-0">via {x.shared.slice(0, 2).join(", ")}</span>}
                </div>
              ))}
            </Panel>
          )}

          <Panel title="Mind map" hint="Your categories, the ideas in them, and their notes"
            action={<button onClick={p.onShowMap} className="text-[13px] text-primary hover:underline">See connections</button>}>
            <MindTree reloadKey={p.reloadKey} onOpenNote={p.onOpenNote} onOpenTopic={p.onOpenTopic} />
          </Panel>

          <div className="grid gap-3 lg:grid-cols-2 items-start">
            <Panel title="Keeps coming up" hint="Issues raised in more than one note" empty="No issue has come up twice yet.">
              {data.recurring.map(r => (
                <Line key={r.topic} onOpen={() => p.onSearch(r.topic)} text={`${r.topic} · ${plural(r.notes, "note")}`}
                  sub={[r.places.join(", "), r.people ? plural(r.people, "person", "people") : "", r.trend === "growing" ? "growing" : `last ${ago(r.last)}`].filter(Boolean).join(" · ")} />
              ))}
            </Panel>
            <Panel title="What's moving" hint="Mentioned more lately, or gone quiet" empty="Nothing stands out yet.">
              {!!data.moving.growing.length && <Chips label="More lately" items={data.moving.growing} onOpen={p.onOpenEntity} />}
              {!!data.moving.quiet.length && <Chips label="Gone quiet" items={data.moving.quiet} onOpen={p.onOpenEntity} />}
            </Panel>
          </div>

          <Panel title="Projects" hint="Context you keep notes and chats in" action={<button onClick={p.onShowProjects} className="text-[13px] text-primary hover:underline">All projects</button>}
            empty="No projects yet. Make one to keep related notes and chats together.">
            <div className="grid gap-2 sm:grid-cols-2">
              {data.projects.map(pr => (
                <button key={pr.id} onClick={() => p.onOpenProject(pr.id)} className="card text-left p-3 hover:border-line-strong" style={{ borderRadius: 14 }}>
                  <span className="block text-[14.5px] font-semibold text-ink truncate">{pr.name}</span>
                  <span className="block text-[12.5px] text-muted truncate">{plural(pr.notes, "note")} · active {ago(pr.active_at)}</span>
                </button>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

/** A number tile. */
function Stat({ value, label, sub, color }: { value: number; label: string; sub: string; color: string }) {
  return (
    <div className="card p-3.5" style={{ borderRadius: 16 }}>
      <p className="font-display text-[26px] font-semibold tabular-nums" style={{ color }}>{value}</p>
      <p className="text-[13px] text-ink">{label}</p>
      <p className="text-[11.5px] text-faint">{sub}</p>
    </div>
  );
}

/** A titled card with a list; shows `empty` when the list has nothing. */
function Panel({ title, hint, empty, action, children }: { title: string; hint: string; empty?: string; action?: React.ReactNode; children: React.ReactNode }) {
  const has = Children.toArray(children).length > 0;
  return (
    <section className="card p-4" style={{ borderRadius: 20 }}>
      <div className="flex items-baseline gap-2 mb-2.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-[12px] text-faint truncate">{hint}</span>
        {action && <span className="ml-auto shrink-0">{action}</span>}
      </div>
      <div className="flex flex-col gap-2">{has ? children : <p className="text-[13.5px] text-faint">{empty}</p>}</div>
    </section>
  );
}

/** One row: optional lead, text with a quiet second line (tappable), optional action on the right. */
function Line({ text, sub, lead, onOpen, action }: { text: string; sub?: string; lead?: React.ReactNode; onOpen?: () => void; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {lead}
      <button onClick={onOpen} className="flex-1 min-w-0 text-left hover:opacity-80">
        <span className="block text-[14px] text-ink leading-snug">{text}</span>
        {sub && <span className="block text-[12px] text-faint truncate">{sub}</span>}
      </button>
      {action}
    </div>
  );
}

/** Entity chips under a small label. */
function Chips({ label, items, onOpen }: { label: string; items: MovingEntity[]; onOpen: (id: string) => void }) {
  return (
    <div>
      <p className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-faint mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map(e => (
          <button key={e.id} onClick={() => onOpen(e.id)} title={`${e.recent} notes lately, ${e.before} before · last ${day(e.last_seen)}`}
            className="chip-lift h-7 px-2.5 rounded-lg text-[13px] inline-flex items-center gap-1.5 [&_svg]:w-3.5 [&_svg]:h-3.5"
            style={{ background: KIND[e.kind].bg, color: KIND[e.kind].fg }}>{KIND[e.kind].icon}{e.name}</button>
        ))}
      </div>
    </div>
  );
}
