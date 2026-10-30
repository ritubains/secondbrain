// A popover that closes on an outside click or Escape (Menu, BucketChips).
import { useEffect, useRef, useState } from "react";

export function usePopover(onEscape?: () => void) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { onEscape?.(); setOpen(false); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return { open, setOpen, box };
}
