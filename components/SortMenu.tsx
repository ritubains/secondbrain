"use client";
import Menu from "./Menu";
import { I } from "./IconButton";

export type Sort = "new" | "old";
const LABEL: Record<Sort, string> = { new: "Newest first", old: "Oldest first" };

export default function SortMenu({ sort, onSort }: { sort: Sort; onSort: (s: Sort) => void }) {
  return (
    <Menu width={160}
      items={(Object.keys(LABEL) as Sort[]).map(k => ({ label: LABEL[k], active: k === sort, onClick: () => onSort(k) }))}
      trigger={({ open, toggle }) => (
        <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`Sort: ${LABEL[sort]}`}
          className="btn btn-ghost h-9 px-3 text-[13px] whitespace-nowrap">
          <span className="text-muted">{I.sort}</span>
          {LABEL[sort]}
          <span className={`text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}>{I.chevron}</span>
        </button>
      )} />
  );
}
