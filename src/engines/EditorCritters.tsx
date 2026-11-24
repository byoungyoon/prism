// Teammates walking over the editing screen: when a member edits this file through the engine's
// MCP tools, its critter walks to the node or slide it touched and taps away there, with a bubble
// saying what it's doing. When the change shows up in the editor it hops, then goes back to rest.
// The layer never takes a click (pointer-events: none) and follows the 캐릭터 보기 setting.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import type { Agent, EngineCall, Task } from "../lib/api";
import { CritterLayer, critters, type PlacedCritter } from "../components/critters";
import type { EditTarget } from "./editing";
import { deckSlide, describeCall, locate } from "./locate";

const LAYER = "editor";
/** an engine call older than this no longer counts as "editing now" */
const RECENT_MS = 90_000;
const DONE_MS = 2600;
const SIZE = 30;

interface Props {
  target: EditTarget;
  frame: React.RefObject<HTMLIFrameElement | null>;
  /** the editor is showing the file */
  ready: boolean;
  /** bumps each time the team's change was loaded into the editor */
  changed: number;
}

/** the member's newest call to this engine, if any, and the calls before it */
const lastCall = (a: Agent, engine: string) => {
  const calls = a.activity.filter((x) => x.engine?.engine === engine);
  const last = calls[calls.length - 1];
  return last ? { at: last.at, call: last.engine!, before: calls.slice(0, -1).map((x) => x.engine!) } : undefined;
};

export function EditorCritters({ target, frame, ready, changed }: Props) {
  const on = useApp((s) => s.critters);
  const team = useApp((s) => s.teams[target.projectId]);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // who shows up: the card's owner (and owners of its follow-ups), plus anyone calling this engine lately
  const crew = useMemo(() => {
    if (!team) return [] as { agent: Agent; task?: Task }[];
    const tasks = team.tasks.filter((t) => t.id === target.taskId || t.followOf === target.taskId);
    const owners = new Set(tasks.map((t) => t.assignee).filter(Boolean) as string[]);
    const now = Date.now();
    return team.agents
      .filter((a) => owners.has(a.id) || (a.status === "work" && (lastCall(a, target.engine.id)?.at ?? 0) > now - RECENT_MS))
      .filter((a) => a.status !== "off")
      .map((a) => ({ agent: a, task: tasks.find((t) => t.assignee === a.id) ?? (a.taskId ? team.tasks.find((t) => t.id === a.taskId) : undefined) }));
  }, [team, target.taskId, target.engine.id]);

  // rest spots: a row in the top-right corner under the editor's tab bar, clear of its toolbars
  const rest = (i: number) => ({ x: size.w - 34 - i * 42, y: 118 });

  // follow each member's newest engine call: walk there and work
  const seen = useRef<Record<string, number>>({});
  const active = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!ready || !on || !size.w) return;
    const w = frame.current?.contentWindow;
    if (!w) return;
    crew.forEach(({ agent }, i) => {
      const last = lastCall(agent, target.engine.id);
      if (!last || last.at <= (seen.current[agent.id] ?? 0)) return;
      seen.current[agent.id] = last.at;
      if (Date.now() - last.at > RECENT_MS) return;
      void goWork(agent.id, last.call, deckSlide(last.before), i);
    });
    async function goWork(id: string, call: EngineCall, slide: number | undefined, i: number) {
      const found = await locate(target.engine.id, w!, call, slide).catch(() => ({ spot: null, slide }));
      // nowhere to point at: work along the right edge instead
      const p = found.spot ? clampIn(found.spot) : { x: size.w - 80, y: Math.min(size.h - 10, 200 + i * 56) };
      active.current.add(id);
      critters.send(id, p.x, p.y, LAYER);
      critters.setState(id, "work", LAYER);
      critters.say(id, describeCall(call, found), LAYER);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crew, ready, on, size.w, size.h]);

  // the change landed in the editor: hop, then back to rest
  useEffect(() => {
    if (!changed || !active.current.size) return;
    const ids = [...active.current];
    ids.forEach((id) => {
      critters.setState(id, "done", LAYER);
      critters.say(id, "고쳤어요!", LAYER);
    });
    const t = setTimeout(() => {
      ids.forEach((id) => {
        active.current.delete(id);
        critters.release(id, LAYER);
      });
    }, DONE_MS);
    return () => clearTimeout(t);
  }, [changed]);

  // leaving the file: forget every override this layer made
  useEffect(
    () => () => {
      for (const id of active.current) critters.release(id, LAYER);
      active.current.clear();
    },
    [target.path],
  );

  const clampIn = (p: { x: number; y: number }) => ({ x: Math.min(size.w - 18, Math.max(18, p.x)), y: Math.min(size.h - 6, Math.max(SIZE + 8, p.y)) });

  const items: PlacedCritter[] = crew.map(({ agent, task }, i) => ({
    id: agent.id,
    agent,
    task,
    ...rest(i),
    // resting members keep quiet; working ones get their line from the override
    say: "",
  }));

  return (
    <div ref={box} style={{ position: "absolute", inset: 0, zIndex: 5, overflow: "hidden", pointerEvents: "none" }} aria-hidden={!on}>
      {on && size.w > 0 && <CritterLayer id={LAYER} items={items} size={SIZE} speed={160} names />}
    </div>
  );
}
