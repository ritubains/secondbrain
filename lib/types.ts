// Shapes the API returns (apps/api/routes/*). One place, so every screen agrees.

export type EntityKind = "person" | "place" | "official" | "group" | "issue" | "term";
export type ItemKind = "promise" | "issue" | "event" | "task";

// A promise / issue / event / task found in a note.
export type Item = {
  id: string; kind: ItemKind; text: string; who: string[]; topic: string;
  due_at: string | null; due_has_time: boolean; done_at: string | null;
};

// Another note connected to this one, and why: how close overall, by meaning and by names, on the user's own scale
// (0 = like a typical pair of their notes, 1 = like a note and its closest), and the names both mention.
export type Connected = {
  id: string; title: string; raw_text: string; created_at: string;
  score: number; meaning: number; names: number; shared: string[];
};

export type Note = {
  id: string;
  raw_text: string;
  title?: string;
  summary?: string;
  form?: string;             // what kind of note it is, in the AI's words
  formatted?: string;       // the note laid out for reading (bullets for lists); "" = show raw_text as written
  tags?: string[];
  place?: string;            // the place the note is about ("" = none)
  people?: string[];         // the people it mentions
  topics?: TopicRef[];       // the subjects it's part of
  project_id?: string | null;
  pinned?: boolean;
  starred?: boolean;         // important
  done_at?: string | null;   // dealt with (card fades, title struck)
  mentions?: { id: string; name: string; kind: EntityKind; seen_as: string }[];   // everyone and everything it mentions
  open_items?: { id: string; kind: "promise" | "event"; text: string; due_at: string | null; due_has_time: boolean }[];
  bucket?: string;           // life area ("" until the pipeline has run → shown as Other)
  source?: "typed" | "voice" | "demo";
  enrich_state?: "pending" | "done"; // "pending" after a save or text edit until the pipeline has run
  created_at?: string;
  updated_at?: string;
  why?: string;              // search / chat: why it matched
  // GET /notes/{id} only:
  entities?: { id: string; kind: EntityKind; name: string; meaning: string; seen_as: string; main: boolean }[];
  items?: Item[];
  connected?: Connected[];
  recordings?: { id: string; duration_ms: number; recorded_at: string }[];
};

export type NotesPage = { items: Note[]; next_cursor?: string | null };

// A subject the notes keep coming back to ("Election strategy"); a note can be in several.
export type TopicRef = { id: string; name: string; parent_id?: string | null };  // parent_id: set on a sub-idea
export type Topic = TopicRef & { parent_id: string | null; origin: "auto" | "you"; notes: number; last: string | null; trend: string };
export type TopicDetail = Topic & {
  note_list: Note[];
  entities: { id: string; name: string; kind: EntityKind; notes: number }[];
  related: { id: string; name: string; notes: number }[];
};
export type NoteStats = { total: number; buckets?: Record<string, number>; bucket_names?: string[] };

// GET /entities?group= — a person, place, office, group or term the notes mention.
export type Entity = {
  id: string; kind: EntityKind; name: string; meaning: string; origin: "auto" | "you"; aliases: string[];
  mentions: number; first_seen: string; last_seen: string; trend: "" | "new" | "growing" | "steady" | "quiet";
  with?: string[];            // places a person comes up in, or people at a place
  role?: string;              // a fact about them, e.g. "is MC of Ward 18"
  waiting?: EntityItem[];     // promises to them not yet kept
  raised?: EntityItem[];      // issues they raised (or raised at this place)
};
export type EntityItem = { id: string; kind: ItemKind; text: string; who: string[]; note_id: string; created_at: string; title: string };
export type Fact = { id: string; subject_id: string; subject: string; relation: string; object_id: string | null; object: string; note_id: string | null; text: string };
export type EntityDetail = Entity & {
  facts: Fact[];              // its profile: "Saroj is MC of Ward 18", either side
  notes: Note[];
  items: EntityItem[];
  events: { id: string; text: string; due_at: string; due_has_time: boolean; done_at: string | null }[];
  related: { id: string; name: string; kind: EntityKind; notes: number }[];
};

export type Project = {
  id: string; name: string; description: string; instructions: string;
  notes: number; conversations: number; created_at: string; updated_at: string; active_at: string;
};
export type ProjectDetail = Omit<Project, "notes"> & { notes: Note[]; conversation_list: { id: string; title: string; updated_at: string }[] };

export type ConversationSummary = { id: string; title: string; project_id: string | null; project: string | null; updated_at: string };
export type Message = { role: "user" | "assistant"; content: string; created_at?: string; notes: Note[] };
export type Conversation = { id: string; title: string; project_id: string | null; messages: Message[] };

// GET /home
export type HomeData = {
  overview: { notes: number; notes_month: number; notes_prev: number; open_promises: number; upcoming_7d: number; people: number; places: number };
  briefing: string; briefing_pending: boolean;
  coming_up: { id: string; text: string; due_at: string; due_has_time: boolean; note_id: string; title: string; place: string | null }[];
  waiting: { id: string; text: string; who: string[]; note_id: string; title: string; place: string | null; days: number }[];
  recurring: { topic: string; notes: number; last: string; people: number; places: string[]; examples: string[]; note_ids: string[]; trend: string }[];
  moving: { growing: MovingEntity[]; quiet: MovingEntity[] };
  topics: { id: string; name: string; notes: number; last: string; trend: string }[];
  picked_up: { score: number; shared: string[]; new_id: string; new_title: string; new_at: string; old_id: string; old_title: string; old_at: string; gap_days: number }[];
  projects: { id: string; name: string; description: string; notes: number; active_at: string }[];
  conversations: { id: string; title: string; updated_at: string; project: string | null }[];
};
export type MovingEntity = { id: string; name: string; kind: EntityKind; recent: number; before: number; last_seen: string; trend: string };

// GET /memory — a lasting fact memory keeps about the user.
export type MemoryFact = {
  id: string; memory: string; created_at: string | null; updated_at: string | null;
  note_id: string | null; source: string; project_id: string | null; project: string;
};

// GET /graph?kind=&id= — everything one step from the centre, with a label on every line.
export type GraphNodeKind = "note" | "topic" | "value" | EntityKind;
export type GraphNode = { id: string; kind: GraphNodeKind; label: string; sub: string };  // id: "note:…", "entity:…", "topic:…"
// The whole map (/graph/map): notes with their ideas, the ideas, connections with why, people and places with their notes.
export type MapData = {
  notes: { id: string; title: string; bucket: string; created_at: string; preview: string; ideas: string[] }[];  // preview: summary or first words
  ideas: { id: string; name: string; parent_id: string | null; level: "category" | "topic" | "sub"; notes: number }[];  // a tree: category › topic › sub
  entities: { id: string; kind: EntityKind; name: string; notes: string[] }[];   // every person, place, office, group
};
export type GraphData = { center: string; nodes: GraphNode[]; edges: { source: string; target: string; label: string }[] };
