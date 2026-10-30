"use client";
import { useEffect, useRef } from "react";

type Props = { stream: MediaStream | null; active: boolean };

// Scrolling level meter: newest bar on the right, quiet history as dots — like ChatGPT dictation.
// Uses the recorder's stream when given; otherwise opens its own mic tap just for the meter.
export default function Waveform({ stream, active }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const el = canvas.current;
    if (!el) return;
    let raf = 0, stopped = false;
    let own: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    const levels: number[] = [];
    let last = 0;

    const setup = async () => {
      let src = stream;
      if (!src) {
        try { src = own = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { src = null; }
      }
      if (stopped || !src) return;
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(src).connect(analyser);
    };
    void setup();

    const buf = new Uint8Array(512);
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth, h = el.clientHeight;
      if (el.width !== w * dpr) { el.width = w * dpr; el.height = h * dpr; }
      const g = el.getContext("2d");
      if (!g) return;
      if (now - last > 60) { // ~16 samples/s
        last = now;
        let level = 0;
        if (analyser) {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          level = Math.min(1, Math.sqrt(sum / buf.length) * 4.5);
        } else {
          level = 0.15 + 0.12 * Math.sin(now / 180) * Math.sin(now / 470); // no mic tap: gentle idle pulse
        }
        levels.push(level);
        if (levels.length > 400) levels.shift();
      }
      const css = getComputedStyle(el);
      const on = css.getPropertyValue("--primary").trim() || "#0E8C7E";
      const off = css.getPropertyValue("--line-strong").trim() || "#DCD9E6";
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const step = 4, bw = 2, mid = h / 2;
      const n = Math.floor(w / step);
      for (let i = 0; i < n; i++) {
        const lv = levels[levels.length - n + i];
        const x = i * step;
        if (lv === undefined || lv < 0.04) {
          g.fillStyle = off;
          g.fillRect(x, mid - 1, bw, 2);
        } else {
          const bh = Math.max(3, lv * (h - 2));
          g.fillStyle = on;
          g.beginPath();
          g.roundRect(x, mid - bh / 2, bw, bh, 1);
          g.fill();
        }
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      try { ctx?.close(); } catch { /* noop */ }
      own?.getTracks().forEach(t => t.stop());
    };
  }, [stream, active]);

  return <canvas ref={canvas} className="block w-full h-8" aria-hidden />;
}
