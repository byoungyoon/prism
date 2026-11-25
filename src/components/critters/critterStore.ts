// Remote control for critters on a <CritterLayer>. An editor (figcraft, deckcraft…) can walk a
// teammate somewhere, change what it's doing, or put words over its head:
//
//   import { critters } from "./components/critters";
//   critters.send("w1", 320, 180);          // walk W1 to (320,180) in the layer's own pixels
//   critters.setState("w1", "work");        // tap tap tap (null: back to its real state)
//   critters.say("w1", "표 정리하는 중");   // bubble text (null: back to its real line)
//   critters.release("w1");                 // forget every override
//
// Each call takes an optional `layer` (the CritterLayer's `id`) to talk to one layer only;
// without it the override applies on every layer. Same thing without importing anything:
//   window.dispatchEvent(new CustomEvent("prism:critter", { detail: { id: "w1", x: 320, y: 180, state: "work", say: "…", layer: "editor" } }))
import { create } from "zustand";
import type { CritterState } from "./state";

export interface CritterOverride {
  x?: number;
  y?: number;
  state?: CritterState;
  say?: string;
  /** walking speed for this critter, px/s (default: the layer's) */
  speed?: number;
  /** follow x/y exactly, frame by frame (a pen being drawn), instead of walking there */
  draw?: boolean;
}

interface CritterStore {
  /** key: `${layer}:${id}`, layer "*" = every layer */
  over: Record<string, CritterOverride>;
  patch(id: string, p: Partial<Record<keyof CritterOverride, unknown>>, layer?: string): void;
  /** critters an editing screen is moving right now (the app layer leaves them alone): key → true */
  claims: Record<string, true>;
  claim(keys: string[], on: boolean): void;
}

const keyOf = (id: string, layer?: string) => `${layer ?? "*"}:${id}`;

export const useCritterStore = create<CritterStore>((set) => ({
  over: {},
  claims: {},
  claim: (keys, on) =>
    set((s) => {
      const claims = { ...s.claims };
      for (const k of keys) {
        if (on) claims[k] = true;
        else delete claims[k];
      }
      return { claims };
    }),
  patch: (id, p, layer) =>
    set((s) => {
      const k = keyOf(id, layer);
      const next: Record<string, unknown> = { ...s.over[k] };
      for (const [f, v] of Object.entries(p)) {
        if (v == null) delete next[f];
        else next[f] = v;
      }
      const over = { ...s.over };
      if (Object.keys(next).length) over[k] = next as CritterOverride;
      else delete over[k];
      return { over };
    }),
}));

const patch = (id: string, p: Partial<Record<keyof CritterOverride, unknown>>, layer?: string) => useCritterStore.getState().patch(id, p, layer);

export const critters = {
  /** walk to (x, y): the spot its feet land on, in the layer's pixels; `speed` in px/s */
  send: (id: string, x: number, y: number, layer?: string, speed?: number) => patch(id, speed ? { x, y, speed, draw: null } : { x, y, draw: null }, layer),
  /** put it at (x, y) right now, facing the way it moved (call every frame to trace a path) */
  trace: (id: string, x: number, y: number, layer?: string) => patch(id, { x, y, draw: true }, layer),
  /** show a state; null goes back to the one worked out from the agent */
  setState: (id: string, state: CritterState | null, layer?: string) => patch(id, { state }, layer),
  /** a one-line bubble; null goes back to its own line, "" hides it */
  say: (id: string, text: string | null, layer?: string) => patch(id, { say: text }, layer),
  /** drop every override for this critter */
  release: (id: string, layer?: string) => patch(id, { x: null, y: null, state: null, say: null, speed: null, draw: null }, layer),
};

/** The override for a critter on a given layer: that layer's own, on top of the every-layer one. */
export function useOverride(id: string, layer?: string): CritterOverride | undefined {
  const all = useCritterStore((s) => s.over[keyOf(id)]);
  const mine = useCritterStore((s) => (layer ? s.over[keyOf(id, layer)] : undefined));
  if (!all) return mine;
  if (!mine) return all;
  return { ...all, ...mine };
}

if (typeof window !== "undefined") {
  window.addEventListener("prism:critter", (e) => {
    const d = (e as CustomEvent).detail as ({ id?: string; layer?: string; release?: boolean } & Record<string, unknown>) | undefined;
    if (!d?.id) return;
    if (d.release) return critters.release(d.id, d.layer);
    const p: Partial<Record<keyof CritterOverride, unknown>> = {};
    for (const f of ["x", "y", "state", "say", "speed"] as const) if (f in d) p[f] = d[f];
    patch(d.id, p, d.layer);
  });
}
