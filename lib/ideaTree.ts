// The folders of your notes, shared by the Home mind map and the Notes folder view:
//   folders()       category › topic › sub-topic › notes, all filed by the AI (api pipeline/clusters.py)
//   byEntity()      place (or person / office) › main idea › notes
// A note sits in its sub-topic, else straight in its topic; notes not placed yet sit in Other.
import { bucketAccent, OTHER } from "./buckets";
import { KIND } from "./kinds";
import type { EntityKind, MapData } from "./types";

export type Folder = {
  id: string;                                   // unique in the tree (a note in two sub-ideas shows in both)
  kind: "bucket" | "entity" | "main" | "sub" | "note";
  ref: string;                                  // the bucket name, entity id, idea id or note id ("" = the "none" folder)
  label: string;
  colour: string;                               // the category's accent
  count: number;                                // notes inside
  date?: string;                                // notes: when written
  preview?: string;                             // notes: the summary or first words
  children: Folder[];
};

type Idea = MapData["ideas"][number];
type Notes = Record<string, MapData["notes"][number]>;  // by id

/** Note ids sorted newest first. */
function newestFirst(ids: string[], byNote: Notes): string[] {
  return ids.sort((a, b) => byNote[b].created_at.localeCompare(byNote[a].created_at));
}

/** A note as a leaf of the tree, under the folder with this id. */
function noteLeaf(id: string, byNote: Notes, colour: string, under: string): Folder {
  const n = byNote[id];
  return { id: `${under}/note:${id}`, kind: "note", ref: id, label: n.title, colour, count: 1, date: n.created_at, preview: n.preview, children: [] };
}

/** Biggest folder first, then by name. */
function bySize(x: Folder, y: Folder): number {
  return y.count - x.count || x.label.localeCompare(y.label);
}

/** A topic: its sub-topics, then its notes that are in none of them. */
function topicFolder(d: MapData, t: Idea, notesOf: Record<string, string[]>, byNote: Notes, colour: string): Folder {
  const subs: Folder[] = d.ideas.filter(st => st.parent_id === t.id && st.level === "sub").map(st => {
    const ids = newestFirst(notesOf[st.id] || [], byNote);
    return { id: `sub:${st.id}`, kind: "sub" as const, ref: st.id, label: st.name, colour, count: ids.length, children: ids.map(n => noteLeaf(n, byNote, colour, `sub:${st.id}`)) };
  }).filter(f => f.count).sort(bySize);
  const inSub = new Set(subs.flatMap(f => f.children.map(c => c.ref)));
  const own = newestFirst((notesOf[t.id] || []).filter(n => !inSub.has(n)), byNote).map(n => noteLeaf(n, byNote, colour, `main:${t.id}`));
  return { id: `main:${t.id}`, kind: "main" as const, ref: t.id, label: t.name, colour, count: new Set(notesOf[t.id] || []).size, children: [...subs, ...own] };
}

export function folders(d: MapData): Folder[] {
  const byNote: Notes = Object.fromEntries(d.notes.map(n => [n.id, n]));
  const notesOf: Record<string, string[]> = {};
  d.notes.forEach(n => n.ideas.forEach(t => (notesOf[t] ||= []).push(n.id)));
  const out: Folder[] = d.ideas.filter(c => c.level === "category").map(c => {
    const colour = bucketAccent(c.name);
    const topics = d.ideas.filter(t => t.parent_id === c.id && t.level === "topic").map(t => topicFolder(d, t, notesOf, byNote, colour)).filter(f => f.count).sort(bySize);
    return { id: `bucket:${c.id}`, kind: "bucket" as const, ref: c.name, label: c.name, colour, count: topics.reduce((n, f) => n + f.count, 0), children: topics };
  }).filter(f => f.count).sort(bySize);
  // Notes the AI hasn't filed yet (just saved).
  const placed = new Set(out.flatMap(c => c.children.flatMap(t => t.children.flatMap(x => (x.kind === "note" ? [x.ref] : x.children.map(y => y.ref))))));
  const loose = newestFirst(d.notes.map(n => n.id).filter(n => !placed.has(n)), byNote);
  if (loose.length) out.push({ id: "bucket:other", kind: "bucket", ref: OTHER, label: OTHER, colour: bucketAccent(OTHER), count: loose.length,
    children: loose.map(n => noteLeaf(n, byNote, bucketAccent(OTHER), "bucket:other")) });
  return out;
}

/** A folder's notes, grouped by main idea; notes in no idea after the groups. */
function groupedByIdea(ids: string[], byNote: Notes, mainOf: Record<string, Idea>, colour: string, under: string): Folder[] {
  const groups: Record<string, string[]> = {}, loose: string[] = [];
  ids.forEach(id => {
    const main = byNote[id].ideas.find(t => mainOf[t]);
    if (main) (groups[main] ||= []).push(id); else loose.push(id);
  });
  const mains: Folder[] = Object.entries(groups).map(([t, ns]) => ({
    id: `${under}/main:${t}`, kind: "main" as const, ref: t, label: mainOf[t].name, colour, count: ns.length,
    children: newestFirst(ns, byNote).map(n => noteLeaf(n, byNote, colour, `${under}/main:${t}`)),
  })).sort(bySize);
  return [...mains, ...newestFirst(loose, byNote).map(n => noteLeaf(n, byNote, colour, under))];
}

/** Notes arranged by who or where: one folder per place (or person and office) holding its notes grouped by their main
 * idea, biggest first, then a folder for notes that name none. A note naming two places is in both. */
export function byEntity(d: MapData, kinds: EntityKind[], none: string): Folder[] {
  const byNote: Notes = Object.fromEntries(d.notes.map(n => [n.id, n]));
  const mainOf = Object.fromEntries(d.ideas.filter(t => t.level === "topic").map(t => [t.id, t]));
  const named = new Set<string>();
  const out: Folder[] = d.entities.filter(e => kinds.includes(e.kind)).map(e => {
    const ids = Array.from(new Set(e.notes)).filter(n => byNote[n]);
    ids.forEach(n => named.add(n));
    const colour = KIND[e.kind].fg;
    return { id: `entity:${e.id}`, kind: "entity" as const, ref: e.id, label: e.name, colour, count: ids.length, children: groupedByIdea(ids, byNote, mainOf, colour, `entity:${e.id}`) };
  }).filter(f => f.count).sort(bySize);
  const rest = d.notes.map(n => n.id).filter(n => !named.has(n));
  if (rest.length) out.push({ id: "entity:none", kind: "entity", ref: "", label: none, colour: "var(--faint)", count: rest.length, children: groupedByIdea(rest, byNote, mainOf, "var(--faint)", "entity:none") });
  return out;
}
