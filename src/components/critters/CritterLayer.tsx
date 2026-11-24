// Several critters over one area. Each one gets a target spot and walks there (a CSS transform
// transition, so nothing re-renders while it moves), with a one-line bubble over its head.
// Spots and states can also be changed from outside through `critters` (critterStore.ts).
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Agent, Task } from "../../lib/api";
import { Critter, type CritterLook } from "./Critter";
import { useOverride } from "./critterStore";
import { critterLine, critterState, type CritterState } from "./state";

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
  /** bubble text; defaults to what the agent is on */
  say?: string;
}

const RM = "(prefers-reduced-motion: reduce)";
const subscribeRM = (cb: () => void) => {
  const m = window.matchMedia(RM);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** true when the system asks for less motion */
export const useReducedMotion = () => useSyncExternalStore(subscribeRM, () => window.matchMedia(RM).matches, () => false);

const Walker = memo(function Walker({ item, layer, size, speed, bubble, name, still }: { item: PlacedCritter; layer?: string; size: number; speed: number; bubble: boolean; name: boolean; still: boolean }) {
  const o = useOverride(item.id, layer);
  const x = o?.x ?? item.x;
  const y = o?.y ?? item.y;
  const last = useRef<{ x: number; y: number } | null>(null);
  const [walk, setWalk] = useState<{ ms: number; flip: boolean }>({ ms: 0, flip: false });
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const prev = last.current;
    last.current = { x, y };
    if (!prev || still) return setWalk((w) => ({ ...w, ms: 0 }));
    const dx = x - prev.x;
    const dist = Math.hypot(dx, y - prev.y);
    if (dist < 1) return;
    const ms = Math.min(9000, Math.max(200, (dist / speed) * 1000));
    setWalk((w) => ({ ms, flip: Math.abs(dx) > 2 ? dx < 0 : w.flip }));
    setMoving(true);
    const t = setTimeout(() => setMoving(false), ms);
    return () => clearTimeout(t);
  }, [x, y, speed, still]);

  const real = item.state ?? (item.agent ? critterState(item.agent, item.task) : (item.look?.state ?? "idle"));
  const state: CritterState = moving ? "walk" : (o?.state ?? real);
  const say = o?.say ?? item.say ?? (item.agent ? critterLine(item.agent, item.task) : "");
  const label = item.agent?.name ?? item.look?.name ?? "";
  return (
    <div className="cr-mover" style={{ transform: `translate3d(${x}px, ${y}px, 0)`, transitionDuration: `${walk.ms}ms` }}>
      <div className="cr-anchor">
        {bubble && say && (
          <span className="cr-say" title={say} style={{ marginBottom: -size * 0.2 }}>
            {say}
          </span>
        )}
        <Critter agent={item.agent} task={item.task} look={item.look} colorKey={item.colorKey} state={state} size={size} flip={walk.flip} labelled />
        {name && label && <span className="cr-name">{label}</span>}
      </div>
    </div>
  );
});

/** `<CritterLayer items={[{ id, agent, x, y }]} />` inside a `position: relative` box. */
export function CritterLayer({ id, items, size = 32, speed = 70, bubbles = true, names = false, className }: { id?: string; items: PlacedCritter[]; size?: number; speed?: number; bubbles?: boolean; names?: boolean; className?: string }) {
  const still = useReducedMotion();
  return (
    <div className={`cr-layer${className ? ` ${className}` : ""}`} data-critter-layer={id}>
      {items.map((it) => (
        <Walker key={it.id} item={it} layer={id} size={size} speed={speed} bubble={bubbles} name={names} still={still} />
      ))}
    </div>
  );
}
