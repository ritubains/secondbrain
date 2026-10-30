"use client";
// Bucket badge: the note's life area (Technology, Shopping, …) in its stable preset tint.
import { bucketOf, bucketTint } from "../lib/buckets";

export default function BucketPill({ bucket, size = "md" }: { bucket?: string; size?: "sm" | "md" }) {
  const b = bucketOf(bucket);
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 font-medium rounded-full border text-soft ${size === "sm" ? "text-[11px] h-5 px-1.5" : "text-xs h-6 px-2"}`}
      style={bucketTint(b)}>
      {b}
    </span>
  );
}
