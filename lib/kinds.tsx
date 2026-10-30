// How each kind of entity and item looks, everywhere in the app. Colors are CSS tokens (globals.css --k-*).
import type { EntityKind, ItemKind } from "./types";
import { I } from "../components/IconButton";

const tok = (k: string) => ({ fg: `var(--k-${k})`, bg: `var(--k-${k}-bg)` });

export const KIND: Record<EntityKind, { label: string; many: string; icon: React.ReactNode; fg: string; bg: string }> = {
  person: { label: "Person", many: "People", icon: I.user, ...tok("person") },
  place: { label: "Place", many: "Places", icon: I.pin, ...tok("place") },
  official: { label: "Official", many: "Officials and offices", icon: I.badge, ...tok("official") },
  group: { label: "Group", many: "Groups", icon: I.users, ...tok("group") },
  issue: { label: "Issue", many: "Issues", icon: I.alert, ...tok("issue") },
  term: { label: "Word", many: "Words", icon: I.tag, ...tok("topic") },
};

export const ITEM: Record<ItemKind, { label: string; many: string }> = {
  promise: { label: "Promise", many: "Promises" },
  issue: { label: "Issue", many: "Issues raised" },
  event: { label: "Event", many: "Dates" },
  task: { label: "To do", many: "To do" },
};
