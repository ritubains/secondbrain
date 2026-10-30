"use client";
import type { ReactNode } from "react";
import { usePopover } from "../lib/usePopover";

export type MenuItem =
  | { label: ReactNode; onClick: () => void; danger?: boolean; active?: boolean }
  | { heading: string }
  | "sep";

type Props = {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  width?: number;
  up?: boolean; // open above the trigger (toolbars pinned to the bottom)
};

// Small popover: closes on outside click, Esc, or picking an item.
export default function Menu({ trigger, items, align = "right", width = 180, up }: Props) {
  const { open, setOpen, box } = usePopover();

  return (
    <div ref={box} className="relative" onClick={e => e.stopPropagation()}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && (
        <div role="menu" style={{ width }}
          className={`anim-enter absolute z-40 ${up ? "bottom-full mb-1.5" : "mt-1.5"} ${align === "right" ? "right-0" : "left-0"} rounded-xl border border-line bg-bg p-1 shadow-[0_12px_32px_-12px_rgb(var(--shadow)/.3)]`}>
          {items.map((it, i) =>
            it === "sep" ? <div key={i} className="my-1 h-px bg-line" /> :
            "heading" in it ? <p key={i} className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-faint">{it.heading}</p> : (
              <button key={i} role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}
                className={`w-full flex items-center gap-2 text-left text-[13px] px-2.5 h-8 rounded-lg transition-colors ${it.danger ? "text-danger hover:bg-danger-50" : it.active ? "text-primary bg-primary-50" : "text-soft hover:bg-surface hover:text-ink"}`}>
                {it.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
