// Several critters over one area. Each one gets a target spot and walks there (a CSS transform
// transition, so nothing re-renders while it moves), with a one-line bubble over its head.
// Spots and states can also be changed from outside through `critters` (critterStore.ts).
import { memo, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { Agent, Task } from "../../lib/api";
import { Critter, type CritterLook, type WalkDir } from "./Critter";
import { useOverride } from "./critterStore";
import { critterLine, critterState, type CritterState, type Pose } from "./state";

export interface PlacedCritter {
  /** key for overrides (critters.send(id, …)); usually the agent id */
  id: string;
  agent?: Agent;
  task?: Task;
  /** when there is no agent */
  look?: CritterLook;
  /** picks the color instead of the name */
  colorKey?: string;
  /** where its feet stand, in the layer's pixels */
  x: number;
  y: number;
  state?: CritterState;
  /** the body pose while standing still (a walking critter always walks); default: the state's */
  pose?: Pose;
  /** bubble text; defaults to what the agent is on */
  say?: string;
  /** its own walking pace (px/s), e.g. an unhurried stroll in the lounge; default: the layer's */
  speed?: number;
  /** now and then it stretches, sways in its chair or glances aside (a cat at its desk) */
  fidget?: boolean;
}

const RM = "(prefers-reduced-motion: reduce)";
const subscribeRM = (cb: () => void) => {
  const m = window.matchMedia(RM);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** true when the system asks for less motion */
export const useReducedMotion = () => useSyncExternalStore(subscribeRM, () => window.matchMedia(RM).matches, () => false);

/** a number from an id, so each critter keeps its own rhythm (fidget timing) */
const hash = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
};

// a hidden window doesn't need its critters moving: every critter animation pauses (critters.css)
if (typeof document !== "undefined") {
  const sync = () => document.documentElement.classList.toggle("cr-paused", document.hidden);
  document.addEventListener("visibilitychange", sync);
  sync();
}

const Walker = memo(function Walker({ item, layer, size, speed, bubble, name, still, width, leaving }: { item: PlacedCritter; layer?: string; size: number; speed: number; bubble: boolean; name: boolean; still: boolean; width?: number; leaving?: number }) {
  const o = useOverride(item.id, layer);
  const x = o?.x ?? item.x;
  const y = o?.y ?? item.y;
  const tracing = !!o?.draw;
  const pace = o?.speed ?? item.speed ?? speed;
  // The walk is worked out while rendering, so the new spot and the time to get there reach the
  // DOM together. (Set from an effect, the transform landed one paint before the duration: the
  // cat jumped instead of walking.) `walk.to` is the spot it is heading for; `walk.until` when it
  // arrives. Re-rendering with the same spot changes nothing (also under StrictMode's double render).
  const walk = useRef<{ to: { x: number; y: number } | null; ms: number; flip: boolean; dir: WalkDir; until: number }>({ to: null, ms: 0, flip: false, dir: "side", until: 0 });
  const w = walk.current;
  if (!w.to || w.to.x !== x || w.to.y !== y) {
    const prev = w.to;
    w.to = { x, y };
    const dx = prev ? x - prev.x : 0;
    const dist = prev ? Math.hypot(dx, y - prev.y) : 0;
    if (!prev || still || dist < 1) {
      w.ms = 0;
    } else if (tracing) {
      // traced frame by frame: no transition, just face the way the pen goes
      w.ms = 0;
      if (Math.abs(dx) > 0.6) w.flip = dx < 0;
    } else {
      // a time in proportion to the distance, facing the way it goes: mostly down = toward you,
      // mostly up = away, otherwise sideways
      w.ms = Math.min(12000, Math.max(200, (dist / pace) * 1000));
      if (Math.abs(dx) > 2) w.flip = dx < 0;
      const dy = y - prev.y;
      w.dir = Math.abs(dy) > Math.abs(dx) * 1.3 ? (dy > 0 ? "front" : "back") : "side";
      w.until = Date.now() + w.ms;
    }
  }
  // walking pose while on the way, its own pose again once there
  const [, arrived] = useState(0);
  const left = w.until - Date.now();
  const moving = left > 0 && !tracing && !still;
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => arrived((n) => n + 1), left + 20);
    return () => clearTimeout(t);
  }, [w.until, left > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const real = item.state ?? (item.agent ? critterState(item.agent, item.task) : (item.look?.state ?? "idle"));
  const state: CritterState = moving ? "walk" : (o?.state ?? real);
  const say = o?.say ?? item.say ?? (item.agent ? critterLine(item.agent, item.task) : "");
  const label = item.agent?.name ?? item.look?.name ?? "";
  const h = hash(item.id);
  // fidgets come every 9–16 s, each cat on its own beat
  const fidget = item.fidget && !moving ? { "--fd": `${-(h % 9000)}ms`, "--fdur": `${9 + (h % 8)}s` } : undefined;
  return (
    <div
      className={`cr-mover${leaving ? " cr-leaving" : ""}`}
      data-critter={item.id}
      style={{ transform: `translate3d(${x}px, ${y}px, 0)`, transitionDuration: `${moving ? w.ms : 0}ms`, animationDuration: leaving ? `${leaving}ms` : undefined }}
    >
      <div className={`cr-anchor${fidget ? " cr-fidget" : ""}`} style={fidget as CSSProperties | undefined}>
        {bubble && say && (
          <span className="cr-say" title={say} style={{ marginBottom: -size * 0.1, transform: width ? `translateX(${Math.max(0, 78 - x) - Math.max(0, x + 78 - width)}px)` : undefined }}>
            {say}
          </span>
        )}
        <span className="cr-in">
          <Critter agent={item.agent} task={item.task} look={item.look} colorKey={item.colorKey} state={state} pose={state === "walk" ? undefined : item.pose} size={size} flip={w.flip} dir={w.dir} labelled />
          {name && label && <span className="cr-name">{label}</span>}
        </span>
      </div>
    </div>
  );
});

/** how long a critter that left takes to walk out and fade */
const leaveMs = (from: { x: number; y: number }, door: { x: number; y: number } | undefined, pace: number) =>
  door ? Math.min(4000, Math.max(700, (Math.hypot(door.x - from.x, door.y - from.y) / pace) * 1000)) + 300 : 600;

/** `<CritterLayer items={[{ id, agent, x, y }]} />` inside a `position: relative` box. */
/** `width`: the layer's width, so bubbles near its edges shift inward instead of being cut off */
/** `door`: where a critter that leaves (clocks out) walks to while it fades; without one it fades in place */
export function CritterLayer({ id, items, size = 32, speed = 70, bubbles = true, names = false, className, width, door }: { id?: string; items: PlacedCritter[]; size?: number; speed?: number; bubbles?: boolean; names?: boolean; className?: string; width?: number; door?: { x: number; y: number } }) {
  const still = useReducedMotion();
  // critters that just left: kept a moment, heading for the door. Worked out while rendering, so a
  // leaving critter never drops out of the list for a frame (it would come back at the door).
  const gone = useRef(new Map<string, { item: PlacedCritter; ms: number; until: number }>());
  const prev = useRef(new Map<string, PlacedCritter>());
  const now = new Set(items.map((it) => it.id));
  for (const id of now) gone.current.delete(id);
  if (!still) {
    for (const [id, it] of prev.current) {
      if (now.has(id) || gone.current.has(id)) continue;
      const ms = leaveMs(it, door, speed);
      gone.current.set(id, { item: { ...it, ...(door ? { x: door.x, y: door.y } : {}), say: "", fidget: false, speed: undefined }, ms, until: Date.now() + ms });
    }
  }
  prev.current = new Map(items.map((it) => [it.id, it]));
  const [, tick] = useState(0);
  const leavers = [...gone.current.values()];
  const next = leavers.length ? Math.min(...leavers.map((g) => g.until)) : 0;
  useEffect(() => {
    if (!next) return;
    const t = setTimeout(() => {
      for (const [id, g] of gone.current) if (g.until <= Date.now() + 20) gone.current.delete(id);
      tick((n) => n + 1);
    }, Math.max(0, next - Date.now()) + 30);
    return () => clearTimeout(t);
  }, [next]);
  const shown = new Set(items.map((it) => it.id));
  const order = useRef(new Map<string, number>());
  const seq = (k: string) => {
    if (!order.current.has(k)) order.current.set(k, order.current.size);
    return order.current.get(k)!;
  };
  return (
    <div className={`cr-layer${className ? ` ${className}` : ""}`} data-critter-layer={id}>
      {/* one list in a steady order (the order each critter first came in): a critter whose DOM
          node moved would lose its walk (a moved node starts over without a transition) */}
      {[
        ...items.map((it) => ({ id: it.id, el: <Walker key={it.id} item={it} layer={id} size={size} speed={speed} bubble={bubbles} name={names} still={still} width={width} /> })),
        ...leavers
          .filter((g) => !shown.has(g.item.id))
          .map((g) => ({ id: g.item.id, el: <Walker key={g.item.id} item={g.item} layer={id} size={size} speed={speed} bubble={false} name={names} still={still} width={width} leaving={g.ms} /> })),
      ]
        .sort((a, b) => seq(a.id) - seq(b.id))
        .map((x) => x.el)}
    </div>
  );
}
