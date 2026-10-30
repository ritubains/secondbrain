"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode; tone?: "default" | "danger"; size?: number };

export default function IconButton({ label, children, tone = "default", size = 32, className = "", ...rest }: Props) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      style={{ width: size, height: size }}
      className={`btn shrink-0 rounded-lg ${tone === "danger" ? "text-danger hover:bg-danger-50" : "text-muted hover:text-ink hover:bg-surface"} ${className}`}>
      {children}
    </button>
  );
}

// Stroke icons, 16px, currentColor.
const s = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
export const I = {
  dots: <svg {...s}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></svg>,
  chevron: <svg {...s}><path d="m6 9 6 6 6-6" /></svg>,
  edit: <svg {...s}><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>,
  share: <svg {...s}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" /></svg>,
  trash: <svg {...s}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  copy: <svg {...s}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>,
  check: <svg {...s}><path d="m5 12 5 5 9-10" /></svg>,
  refresh: <svg {...s}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>,
  tag: <svg {...s}><path d="M3 12V4h8l10 10-8 8L3 12Z" /><circle cx="7.5" cy="8.5" r="1.3" /></svg>,
  sparkle: <svg {...s} fill="currentColor" stroke="none"><path d="M12 2c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z" /><path d="M19 14c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3Z" /></svg>,
  list: <svg {...s}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r=".8" fill="currentColor" /><circle cx="4.5" cy="12" r=".8" fill="currentColor" /><circle cx="4.5" cy="18" r=".8" fill="currentColor" /></svg>,
  pin: <svg {...s}><path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11Z" /><circle cx="12" cy="10" r="2.3" /></svg>,
  pin2: <svg {...s}><path d="M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7" /></svg>,
  phone: <svg {...s}><path d="M6.5 3.5h3l1.5 4-2 1.3a11 11 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z" /></svg>,
  whatsapp: <svg {...s}><path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8L4 20Z" /><path d="M9.2 8.6c.2-.5.5-.5.8-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .4-.1.6l-.5.6c-.1.1-.1.3 0 .5a5.4 5.4 0 0 0 2.4 2.1c.2.1.4.1.5-.1l.6-.7c.2-.2.4-.2.6-.1l1.6.8c.2.1.3.3.3.5 0 .6-.3 1.4-1.4 1.6-1 .2-2.5-.1-4.3-1.7-1.6-1.4-2.4-3-2.4-4 0-.7.2-1.2.4-1.6Z" fill="currentColor" stroke="none" /></svg>,
  grid: <svg {...s}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>,
  rows: <svg {...s}><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
  timeline: <svg {...s}><path d="M7 4v16" /><circle cx="7" cy="7" r="2" fill="currentColor" /><circle cx="7" cy="16" r="2" fill="currentColor" /><path d="M11 7h9M11 16h9" /></svg>,
  board: <svg {...s}><rect x="4" y="4" width="4.5" height="16" rx="1.2" /><rect x="10" y="4" width="4.5" height="11" rx="1.2" /><rect x="16" y="4" width="4.5" height="13" rx="1.2" /></svg>,
  badge: <svg {...s}><path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6l-7-3Z" /><path d="m9.5 12 1.8 1.8 3.4-3.6" /></svg>,
  users: <svg {...s}><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.2a5 5 0 0 1 5 5" /></svg>,
  alert: <svg {...s}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>,
  back: <svg {...s}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>,
  map: <svg {...s}><circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="18" r="2.2" /><path d="m7.6 7.6 8.8 8.8M16.4 7.6l-8.8 8.8" /></svg>,
  sort: <svg {...s}><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" /></svg>,
  search: <svg {...s}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  sun: <svg {...s}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: <svg {...s}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /></svg>,
  x: <svg {...s}><path d="M6 6l12 12M18 6 6 18" /></svg>,
  arrow: <svg {...s}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  user: <svg {...s}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  palette: <svg {...s}><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z" /><circle cx="7.5" cy="11.5" r="1" fill="currentColor" /><circle cx="10" cy="7.5" r="1" fill="currentColor" /><circle cx="14.5" cy="7.5" r="1" fill="currentColor" /><circle cx="17" cy="11" r="1" fill="currentColor" /></svg>,
  plus: <svg {...s}><path d="M12 5v14M5 12h14" /></svg>,
  mic: <svg {...s} width={13} height={13}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>,
  noColor: <svg {...s}><circle cx="12" cy="12" r="8" /><path d="m6.5 6.5 11 11" /></svg>,
};
