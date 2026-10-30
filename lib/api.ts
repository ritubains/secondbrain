// api: the only way the UI talks to the backend (cookie auth included).
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
// Identical plain GETs in flight at the same moment share one request (Home's panels ask for the same data).
const inflight = new Map<string, Promise<any>>();

// Fetch JSON from the API with cookies; throws with .status so callers can spot 401s.
export function api(path: string, opts: RequestInit = {}) {
  if (Object.keys(opts).length) return request(path, opts);
  const hit = inflight.get(path);
  if (hit) return hit;
  const p = request(path, opts).finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

async function request(path: string, opts: RequestInit) {
  const headers: Record<string, string> = { ...((opts.headers as Record<string, string>) || {}) };
  // Only default to JSON for string bodies — FormData sets its own multipart boundary.
  if (typeof opts.body === "string" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const r = await fetch(`${API}${path}`, { credentials: "include", ...opts, headers });
  if (!r.ok) {
    // Surface HTTP status so callers can tell 401 (logged out) from outages.
    // Body too: e.g. 502 {error:"transcribe_failed", recording_id} → the UI can offer Retry.
    const err = new Error(`http ${r.status}`) as Error & { status: number; body?: any };
    err.status = r.status;
    err.body = await r.json().catch(() => null);
    throw err;
  }
  return r.json();
}
