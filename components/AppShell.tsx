"use client";
// App frame: a sidebar on wide screens (name, Record, the screens, theme + account) and, on phones, a slim top
// bar with a bottom tab bar whose middle button records — capturing is always one tap away.
import Brand, { BRAND_NAME } from "./Brand";
import Menu from "./Menu";
import IconButton, { I } from "./IconButton";

export type View = "home" | "notes" | "map" | "chat" | "people" | "projects" | "memory"; // memory: from the account menu

const NAV: { v: View; label: string; icon: React.ReactNode; hint: string }[] = [
  { v: "home", label: "Home", icon: I.sparkle, hint: "What needs you, your topics" },
  { v: "notes", label: "Notes", icon: I.list, hint: "Everything you've said" },
  { v: "map", label: "Map", icon: I.map, hint: "How your notes connect" },
  { v: "chat", label: "Chat", icon: I.search, hint: "Ask your notes anything" },
  { v: "people", label: "People", icon: I.users, hint: "People, places, words" },
  { v: "projects", label: "Projects", icon: I.board, hint: "Notes and chats by context" },
];

type Props = {
  view: View;
  onView: (v: View) => void;
  onRecord: () => void;
  onType: () => void;
  noteCount: number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  email: string | null;
  onLogout: () => void;
  children: React.ReactNode;
};

const mic = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.9" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

function Account({ email, onLogout, onView, up }: { email: string | null; onLogout: () => void; onView: (v: View) => void; up?: boolean }) {
  return (
    <Menu width={220} up={up} align={up ? "left" : "right"}
      items={[...(email ? [{ heading: email }, "sep" as const] : []),
        { label: <>{I.sparkle} What I know about you</>, onClick: () => onView("memory") },
        { label: <>{I.map} Map of your notes</>, onClick: () => onView("map") },
        { label: <>{I.board} Projects</>, onClick: () => onView("projects") }, "sep" as const,
        { label: "Log out", onClick: onLogout, danger: true }]}
      trigger={({ open, toggle }) => (
        <button onClick={toggle} aria-label="Account" aria-haspopup="menu" aria-expanded={open}
          className="w-9 h-9 rounded-full bg-primary-100 text-primary font-semibold text-[14px] flex items-center justify-center hover:ring-2 hover:ring-primary-100 transition-shadow shrink-0">
          {email ? email[0].toUpperCase() : I.user}
        </button>
      )} />
  );
}

export default function AppShell({ view, onView, onRecord, onType, noteCount, theme, onToggleTheme, email, onLogout, children }: Props) {
  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar (wide screens) */}
      <aside className="hidden lg:flex flex-col w-[248px] shrink-0 h-screen sticky top-0 border-r border-line bg-bg px-4 py-5">
        <div className="flex items-center gap-2.5 px-1">
          <Brand size={34} />
          <span className="font-display text-[18px] font-semibold tracking-tight">{BRAND_NAME}</span>
        </div>

        <button onClick={onRecord} className="mt-7 btn btn-primary h-12 rounded-2xl text-[15px] font-semibold gap-2 shadow-[0_10px_24px_-12px_rgb(var(--primary-rgb)/.8)]">
          {mic} Record a thought
        </button>
        <button onClick={onType} className="mt-2 btn btn-ghost h-10 rounded-xl text-[13.5px]">
          {I.edit} Type instead <kbd className="kbd ml-1">N</kbd>
        </button>

        <nav className="mt-7 flex flex-col gap-1" aria-label="Main">
          {NAV.map(n => (
            <button key={n.v} onClick={() => onView(n.v)} aria-current={view === n.v ? "page" : undefined}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${view === n.v ? "bg-primary-50 text-primary" : "text-soft hover:bg-surface hover:text-ink"}`}>
              <span className="shrink-0">{n.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-medium">{n.label}</span>
                <span className={`block text-[11.5px] truncate ${view === n.v ? "text-primary/70" : "text-faint"}`}>{n.hint}</span>
              </span>
              {n.v === "notes" && noteCount > 0 && <span className="text-[12px] tabular-nums text-faint">{noteCount}</span>}
            </button>
          ))}
        </nav>

        <div className="mt-auto pt-4 border-t border-line flex items-center gap-2">
          <Account email={email} onLogout={onLogout} onView={onView} up />
          <span className="flex-1 min-w-0 text-[12.5px] text-muted truncate">{email}</span>
          <IconButton label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={onToggleTheme} size={34}>
            {theme === "dark" ? I.sun : I.moon}
          </IconButton>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {/* Top bar (phones, tablets) */}
        <header className="lg:hidden sticky top-0 z-30 backdrop-blur-md border-b border-line px-4 h-14 flex items-center gap-2.5"
          style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}>
          <Brand size={30} />
          <span className="font-display text-[17px] font-semibold tracking-tight flex-1">{BRAND_NAME}</span>
          <IconButton label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={onToggleTheme} size={36}>
            {theme === "dark" ? I.sun : I.moon}
          </IconButton>
          <Account email={email} onLogout={onLogout} onView={onView} />
        </header>

        <main className="px-4 sm:px-6 lg:px-10 pt-5 lg:pt-8 pb-28 lg:pb-12 max-w-[1240px] mx-auto">{children}</main>
      </div>

      {/* Bottom tab bar (phones, tablets) — the middle button records */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
        style={{ background: "color-mix(in srgb, var(--bg) 92%, transparent)" }} aria-label="Main">
        <div className="grid grid-cols-5 items-end h-16 max-w-[520px] mx-auto">
          {[NAV[0], NAV[1], null, NAV[3], NAV[4]].map(n => n === null ? (
            <div key="rec" className="flex justify-center">
              <button onClick={onRecord} aria-label="Record a thought"
                className="-mt-7 w-[60px] h-[60px] rounded-full btn btn-primary shadow-[0_12px_26px_-10px_rgb(var(--primary-rgb)/.9)] ring-4 ring-[var(--bg)]">
                {mic}
              </button>
            </div>
          ) : (
            <button key={n.v} onClick={() => onView(n.v)} aria-current={view === n.v ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 h-full ${view === n.v ? "text-primary" : "text-muted"}`}>
              {n.icon}<span className="text-[11px] font-medium">{n.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
