// Full screen for one element (the mind map, the knowledge graph): put `ref` on it; `full` says whether it's showing
// full screen, `toggle` goes in or out.
import { useEffect, useRef, useState } from "react";

export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = () => { if (document.fullscreenElement) document.exitFullscreen(); else ref.current?.requestFullscreen?.(); };
  return { ref, full, toggle };
}
