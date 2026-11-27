// Several critters over one area. Each one gets a target spot and walks there (a CSS transform
// transition, so nothing re-renders while it moves), with a one-line bubble over its head.
// Spots and states can also be changed from outside through `critters` (critterStore.ts).
import { memo, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { Agent, Task } from "../../lib/api";
import { Critter, type CritterLook, type WalkDir } from "./Critter";
import { useOverride } from "./critterStore";
import { critterLine, critterState, type CritterState, type Pose } from "./state";
import { catName } from "./pixel/coats";

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
  /** the spot moved because the room's layout shifted (the cat stays at the same desk): jump with it instead of walking behind it.
   *  Ignored while it is still on its way somewhere — then it just heads for the new spot */
  snap?: boolean;
  /** held by a person: it is wherever x/y say, right now */
  drag?: boolean;
  /** a small sign over its head for a moment (it was just given work, or sent to rest) */
  flag?: string;
  /** where it comes in from when it first appears: it starts there and walks to its spot */
  from?: { x: number; y: number };
  /** held by a person and struggling (wiggles in the hand) */
  struggle?: boolean;
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

type Point = { x: number; y: number };
/** the places a walk goes through on its way (around a wall, through a doorway) */
export type Route = (from: Point, to: Point) => Point[];
/** one walk: from where, to where, when it set off and how long it takes. A walk with places to go
 *  through is made of several such legs, one after another: `goal` is its end, `rest` what is left */
interface Leg {
  from: Point;
  to: Point;
  at: number;
  ms: number;
  flip: boolean;
  dir: WalkDir;
  goal: Point;
  rest: Point[];
}
/** where a walking critter is right now (the CSS transition is linear, so this matches the screen) */
const along = (l: Leg, now = Date.now()): Point => {
  const t = l.ms > 0 ? Math.min(1, Math.max(0, (now - l.at) / l.ms)) : 1;
  return { x: l.from.x + (l.to.x - l.from.x) * t, y: l.from.y + (l.to.y - l.from.y) * t };
};
/** the last walk of every critter on a layer that remembers (`remember`): a layer taken off the screen
 *  and put back (another tab) shows each one where it had got to, not jumped to its spot */
const memory = new Map<string, Leg>();

const Walker = memo(function Walker({ item, layer, size, speed, bubble, name, still, width, leaving, remember, route }: { item: PlacedCritter; layer?: string; size: number; speed: number; bubble: boolean; name: boolean; still: boolean; width?: number; leaving?: number; remember?: boolean; route?: Route }) {
  const o = useOverride(item.id, layer);
  // a critter that comes in from somewhere (the door, or where it was when the layer went away)
  // starts there for one painted frame, then heads for its spot
  const memoryKey = remember ? `${layer}:${item.id}` : "";
  const [past] = useState(() => (memoryKey ? memory.get(memoryKey) : undefined));
  const [from] = useState(() => (past ? along(past) : item.from));
  const [entered, setEntered] = useState(!from || still);
  /** the first walk after starting at `from` is always walked, never snapped */
  const entering = useRef(!entered);
  useEffect(() => {
    if (entered) return;
    let b = 0;
    const a = requestAnimationFrame(() => (b = requestAnimationFrame(() => setEntered(true))));
    return () => (cancelAnimationFrame(a), cancelAnimationFrame(b));
  }, [entered]);
  const start = !entered && from;
  const x = start ? start.x : (o?.x ?? item.x);
  const y = start ? start.y : (o?.y ?? item.y);
  const tracing = !!o?.draw;
  const pace = o?.speed ?? item.speed ?? speed;
  // The walk is worked out while rendering, so the new spot and the time to get there reach the
  // DOM together. (Set from an effect, the transform landed one paint before the duration: the
  // cat jumped instead of walking.) The leg is the walk it is on; re-rendering with the same spot
  // changes nothing (also under StrictMode's double render). A new spot while still on the way
  // starts from where it has got to, so a small shift of the room never makes it dash the rest.
  const leg = useRef<Leg | null>(null);
  /** the next leg, from `here` toward the first of `stops` */
  const setOff = (here: Point, stops: Point[], last: Leg | null, now: number, onTheWay: boolean): Leg => {
    const [to, ...rest] = stops;
    const dx = to.x - here.x;
    const dy = to.y - here.y;
    const dist = Math.hypot(dx, dy);
    // a time in proportion to the distance, facing the way it goes: mostly down = toward you,
    // mostly up = away, otherwise sideways
    const next: Leg = { from: here, to, at: now, ms: Math.min(12000, Math.max(200, (dist / pace) * 1000)), flip: last?.flip ?? past?.flip ?? false, dir: last?.dir ?? past?.dir ?? "side", goal: stops[stops.length - 1], rest };
    // a last little correction keeps the way it was facing
    if (!onTheWay || dist > 24) {
      if (Math.abs(dx) > 2) next.flip = dx < 0;
      next.dir = Math.abs(dy) > Math.abs(dx) * 1.3 ? (dy > 0 ? "front" : "back") : "side";
    }
    return next;
  };
  const prev = leg.current;
  const now = Date.now();
  if (!prev || prev.goal.x !== x || prev.goal.y !== y) {
    const to = { x, y };
    const here = prev ? along(prev, now) : to;
    const onTheWay = !!prev && (now < prev.at + prev.ms || prev.rest.length > 0);
    const dx = x - here.x;
    const dist = Math.hypot(dx, y - here.y);
    const jump = item.drag || (item.snap && !onTheWay && !entering.current);
    if (prev) entering.current = false;
    const stand: Leg = { from: to, to, at: now, ms: 0, flip: prev?.flip ?? past?.flip ?? false, dir: prev?.dir ?? past?.dir ?? "side", goal: to, rest: [] };
    if (!prev || still || dist < 1 || jump) {
      leg.current = stand;
    } else if (tracing) {
      // traced frame by frame: no transition, just face the way the pen goes
      if (Math.abs(dx) > 0.6) stand.flip = dx < 0;
      leg.current = stand;
    } else {
      // (a place it is already at is no leg of its own)
      const via = (route?.(here, to) ?? []).filter((q, i) => i > 0 || Math.hypot(q.x - here.x, q.y - here.y) >= 1);
      leg.current = setOff(here, [...via, to], prev, now, onTheWay);
    }
  } else if (prev.rest.length && now >= prev.at + prev.ms) {
    // one leg done, the walk isn't: on to the next
    leg.current = setOff(prev.to, prev.rest, prev, now, false);
  }
  const w = leg.current!;
  useEffect(() => {
    // before it has set off from `from`, the remembered walk stays as it was
    if (memoryKey && entered && !leaving) memory.set(memoryKey, w);
  }, [memoryKey, entered, leaving, w]);
  useEffect(() => {
    if (entered) entering.current = false;
  }, [entered]);
  // walking pose while on the way, its own pose again once there
  const [, arrived] = useState(0);
  const until = w.at + w.ms;
  const left = until - Date.now();
  const moving = left > 0 && !tracing && !still;
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => arrived((n) => n + 1), left + 20);
    return () => clearTimeout(t);
  }, [until, left > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const real = item.state ?? (item.agent ? critterState(item.agent, item.task) : (item.look?.state ?? "idle"));
  const state: CritterState = moving ? "walk" : (o?.state ?? real);
  const say = o?.say ?? item.say ?? (item.agent ? critterLine(item.agent, item.task) : "");
  // the sign of a change takes the bubble's place for its moment
  const flag = leaving ? "" : item.flag;
  const label = (item.agent ? catName(item.agent) : item.look?.name) ?? "";
  const h = hash(item.id);
  // fidgets come every 9–16 s, each cat on its own beat
  const fidget = item.fidget && !moving ? { "--fd": `${-(h % 9000)}ms`, "--fdur": `${9 + (h % 8)}s` } : undefined;
  return (
    <div
      className={`cr-mover${leaving ? " cr-leaving" : ""}${item.drag ? " cr-held" : ""}`}
      data-critter={item.id}
      style={{ transform: `translate3d(${w.to.x}px, ${w.to.y}px, 0)`, transitionDuration: `${moving ? w.ms : 0}ms`, animationDuration: leaving ? `${leaving}ms` : undefined }}
    >
      <div className={`cr-anchor${fidget ? " cr-fidget" : ""}`} style={fidget as CSSProperties | undefined}>
        {bubble && (flag || say) && (
          <span key={flag ? "flag" : "say"} className={`cr-say${flag ? " cr-flag" : ""}`} title={flag || say} style={{ marginBottom: -size * 0.1, transform: width ? `translateX(${Math.max(0, 78 - x) - Math.max(0, x + 78 - width)}px)` : undefined }}>
            {flag || say}
          </span>
        )}
        <span className={`cr-in${item.struggle ? " cr-struggle" : ""}`}>
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
/** `remember`: keep every critter's walk, so a layer put back on the screen goes on from there (needs `id`) */
/** `width`: the layer's width, so bubbles near its edges shift inward instead of being cut off */
/** `route`: places a walk has to go through on its way (keep the same function while the layout is the same) */
/** `door`: where a critter that leaves (clocks out) walks to while it fades; without one it fades in place */
export function CritterLayer({ id, items, size = 32, speed = 70, bubbles = true, names = false, className, width, door, remember, route }: { id?: string; items: PlacedCritter[]; size?: number; speed?: number; bubbles?: boolean; names?: boolean; className?: string; width?: number; door?: { x: number; y: number }; remember?: boolean; route?: Route }) {
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
      gone.current.set(id, { item: { ...it, ...(door ? { x: door.x, y: door.y } : {}), snap: false, drag: false, flag: undefined, say: "", fidget: false, speed: undefined }, ms, until: Date.now() + ms });
    }
  }
  // one that left comes in afresh next time (kept in an effect: a render may be thrown away)
  const idsKey = JSON.stringify(items.map((it) => it.id));
  const had = useRef<string[]>([]);
  useEffect(() => {
    const ids: string[] = JSON.parse(idsKey);
    if (remember) for (const k of had.current) if (!ids.includes(k)) memory.delete(`${id}:${k}`);
    had.current = ids;
  }, [idsKey, remember, id]);
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
        ...items.map((it) => ({ id: it.id, el: <Walker key={it.id} item={it} layer={id} size={size} speed={speed} bubble={bubbles} name={names} still={still} width={width} remember={remember} route={route} /> })),
        ...leavers
          .filter((g) => !shown.has(g.item.id))
          .map((g) => ({ id: g.item.id, el: <Walker key={g.item.id} item={g.item} layer={id} size={size} speed={speed} bubble={false} name={names} still={still} width={width} remember={remember} route={route} leaving={g.ms} /> })),
      ]
        .sort((a, b) => seq(a.id) - seq(b.id))
        .map((x) => x.el)}
    </div>
  );
}
