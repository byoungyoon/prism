// Teammates living on the editing screen. While a file is open in an outside editor, the team's
// critters roam the whole canvas: idle ones amble about, stop and look around, keep apart, and stay
// clear of the person's mouse and selection. A member editing the file through the engine's MCP
// tools walks to the node or slide it touched and taps away there (bubble: what it's doing). When
// the team's change is loaded, drawShow.ts plays it as if that critter drew it.
// The layer never takes a click (pointer-events: none) and follows 캐릭터 보기 / 동작 줄이기.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import type { Agent, EngineCall, Task } from "../lib/api";
import { CritterLayer, colorOf, critters, useCritterStore, useReducedMotion, type PlacedCritter } from "../components/critters";
import type { EditTarget } from "./editing";
import { stageDirector, type ShowCast } from "./drawShow";
import { arr, deckApi, deckSlide, describeCall, engineView, figApi, locate, num, obj, type Box, type Spot } from "./locate";

const LAYER = "editor";
/** an engine call older than this no longer counts as "editing now" */
const RECENT_MS = 90_000;
const DONE_MS = 2600;
const SIZE = 30;
const MAX_CREW = 6;
/** how far critters keep from each other, from the mouse, and around the selection */
const APART = 58;
const MOUSE = 120;
const AROUND_SELECTION = 34;
const AMBLE = 38;
const HURRY = 150;

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

const dist = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.y - b.y);
const inBox = (p: Spot, b: Box, pad: number) => p.x > b.x - pad && p.x < b.x + b.w + pad && p.y > b.y - pad && p.y < b.y + b.h + pad + SIZE;

/** the person's selection on screen (figcraft nodes, deckcraft shapes on the shown slide) */
async function selectionBoxes(engine: string, w: Window): Promise<Box[]> {
  const view = await engineView(engine, w);
  if (!view) return [];
  const toBox = (x: number, y: number, bw: number, bh: number) => {
    const p = view.toScreen(x, y);
    return { x: p.x, y: p.y, w: bw * view.unit, h: bh * view.unit };
  };
  if (engine === "figcraft") {
    const fc = figApi(w)!;
    const ids = arr(obj(await fc.request("document.inspect", { depth: 0 })).selection).slice(0, 12);
    const nodes = await Promise.all(ids.map((id) => fc.request("node.get", { id, depth: 0 }).then(obj).catch(() => obj(null))));
    return nodes.map((n) => obj(n.absoluteBounds)).filter((b) => num(b.x) != null).map((b) => toBox(num(b.x)!, num(b.y)!, num(b.width) ?? 0, num(b.height) ?? 0));
  }
  const dc = deckApi(w)!;
  const sel = obj(obj(await dc.docInspect({})).selection);
  const ids = new Set(arr(sel.shapes).map(String));
  if (!ids.size) return [];
  const slide = obj(await dc.execute("slide.inspect", { index: view.shown ?? 0 }));
  return arr(slide.shapes)
    .map(obj)
    .filter((s) => ids.has(String(s.id)))
    .map((s) => {
      const [x, y, bw, bh] = arr(s.box).map(Number);
      return toBox(x, y, bw, bh);
    });
}

export function EditorCritters({ target, frame, ready, changed }: Props) {
  const on = useApp((s) => s.critters);
  const team = useApp((s) => s.teams[target.projectId]);
  const still = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLCanvasElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const caret = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const visible = on && size.w > 0;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the critters live here while the editor is shown: the bottom strip steps aside
  useEffect(() => {
    if (!visible) return;
    useCritterStore.getState().stageOpen(true);
    return () => useCritterStore.getState().stageOpen(false);
  }, [visible]);

  // who shows up: the card's owner (and follow-ups'), anyone calling this engine lately, then the rest of the team
  const crew = useMemo(() => {
    if (!team) return [] as { agent: Agent; task?: Task }[];
    const tasks = team.tasks.filter((t) => t.id === target.taskId || t.followOf === target.taskId);
    const owners = new Set(tasks.map((t) => t.assignee).filter(Boolean) as string[]);
    const now = Date.now();
    const rank = (a: Agent) => (owners.has(a.id) ? 0 : (lastCall(a, target.engine.id)?.at ?? 0) > now - RECENT_MS ? 1 : a.status === "work" ? 2 : 3);
    return team.agents
      .filter((a) => a.status !== "off" && (a.status !== "done" || owners.has(a.id)))
      .sort((x, y) => rank(x) - rank(y))
      .slice(0, MAX_CREW)
      .map((a) => ({ agent: a, task: tasks.find((t) => t.assignee === a.id) ?? (a.taskId ? team.tasks.find((t) => t.id === a.taskId) : undefined) }));
  }, [team, target.taskId, target.engine.id]);

  // ── where things are ────────────────────────────────────────────────
  const area = useRef<Box | null>(null);
  const mouse = useRef<Spot | null>(null);
  const selection = useRef<Box[]>([]);
  const home = useRef<Record<string, Spot>>({});
  /** members walking to their work spot, or drawing: the wandering leaves them alone */
  const active = useRef<Set<string>>(new Set());
  const drawing = useRef<Set<string>>(new Set());

  const posOf = (id: string): Spot | undefined => {
    const o = useCritterStore.getState().over[`${LAYER}:${id}`];
    return o?.x != null && o?.y != null ? { x: o.x, y: o.y } : home.current[id];
  };

  // the canvas area (refreshed now and then: panels open and close), the selection, the mouse
  useEffect(() => {
    if (!ready || !visible) return;
    const w = frame.current?.contentWindow;
    if (!w) return;
    let alive = true;
    const look = async () => {
      const v = await engineView(target.engine.id, w).catch(() => null);
      if (!alive) return;
      const full = { x: 0, y: 0, w: size.w, h: size.h };
      const a = v?.area && v.area.w > 120 && v.area.h > 120 ? v.area : full;
      // feet stay inside, with room for the head and name
      area.current = { x: a.x + 22, y: a.y + SIZE + 18, w: Math.max(20, a.w - 44), h: Math.max(20, a.h - SIZE - 30) };
      selection.current = await selectionBoxes(target.engine.id, w).catch(() => []);
    };
    void look();
    const t = setInterval(look, 1500);
    // pointer events: the engine handles them, which keeps the old mouse events from firing
    const move = (e: PointerEvent) => (mouse.current = { x: e.clientX, y: e.clientY });
    const leave = () => (mouse.current = null);
    w.addEventListener("pointermove", move, true);
    w.document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      alive = false;
      clearInterval(t);
      w.removeEventListener("pointermove", move, true);
      w.document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [ready, visible, frame, target.engine.id, size.w, size.h]);

  /** a spot clear of everyone and everything, near `from` (within reach) when given */
  const freeSpot = (id: string, from?: Spot, reach = 200): Spot | null => {
    const a = area.current;
    if (!a) return null;
    const others = crew.map((c) => c.agent.id).filter((x) => x !== id).map(posOf).filter(Boolean) as Spot[];
    let best: Spot | null = null;
    let bestScore = -1;
    for (let k = 0; k < 16; k++) {
      let p: Spot;
      if (from) {
        const ang = Math.random() * Math.PI * 2;
        const r = 50 + Math.random() * reach;
        p = { x: from.x + Math.cos(ang) * r, y: from.y + Math.sin(ang) * r * 0.7 };
      } else p = { x: a.x + Math.random() * a.w, y: a.y + Math.random() * a.h };
      p = { x: Math.min(a.x + a.w, Math.max(a.x, p.x)), y: Math.min(a.y + a.h, Math.max(a.y, p.y)) };
      if (selection.current.some((b) => inBox(p, b, AROUND_SELECTION))) continue;
      const m = mouse.current ? dist(p, mouse.current) : 999;
      if (m < MOUSE) continue;
      const near = others.length ? Math.min(...others.map((o) => dist(o, p))) : 999;
      if (near < APART) continue;
      const score = Math.min(near, 300) + Math.min(m, 300);
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    return best;
  };

  // ── roaming ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !visible) return;
    const t = setInterval(() => {
      if (document.hidden || !area.current) return;
      for (const { agent } of crew) {
        const id = agent.id;
        if (active.current.has(id) || drawing.current.has(id)) continue;
        const p = posOf(id);
        if (!p) continue;
        const m = mouse.current;
        const crowded = (m && dist(p, m) < MOUSE) || selection.current.some((b) => inBox(p, b, AROUND_SELECTION));
        if (crowded) {
          // out of the person's way, briskly
          const q = freeSpot(id, p, 260) ?? freeSpot(id);
          if (q) critters.send(id, q.x, q.y, LAYER, HURRY);
          continue;
        }
        if (still) continue;
        const roll = Math.random();
        if (roll < 0.16) {
          const q = freeSpot(id, p);
          if (q) critters.send(id, q.x, q.y, LAYER, AMBLE);
        } else if (roll < 0.26) {
          // stop and look around: turn on the spot
          critters.send(id, p.x + (Math.random() < 0.5 ? -1.5 : 1.5), p.y, LAYER, AMBLE);
        }
      }
    }, 900);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, visible, crew, still]);

  // first spots: spread over the canvas
  for (const { agent } of crew) {
    if (home.current[agent.id] || !size.w) continue;
    home.current[agent.id] = freeSpot(agent.id) ?? { x: 40 + Math.random() * Math.max(10, size.w - 80), y: 120 + Math.random() * Math.max(10, size.h - 160) };
  }

  // ── following MCP calls: walk there and work ────────────────────────
  const seen = useRef<Record<string, number>>({});
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
      critters.send(id, p.x, p.y, LAYER, 220);
      critters.setState(id, "work", LAYER);
      critters.say(id, describeCall(call, found), LAYER);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crew, ready, on, size.w, size.h]);

  // ── the change landed ───────────────────────────────────────────────
  const lastChange = useRef(0);
  const showOn = () => on && !still && !!box.current?.clientWidth;
  useEffect(() => {
    if (!changed) return;
    const ids = [...active.current];
    active.current.clear();
    // the drawing show takes it from here (drawShow picks who draws); the rest go back to roaming
    if (showOn()) {
      ids.forEach((id) => {
        critters.setState(id, null, LAYER);
        critters.say(id, null, LAYER);
      });
      return;
    }
    // no show: a hop, then back to roaming
    ids.forEach((id) => {
      critters.setState(id, "done", LAYER);
      critters.say(id, "고쳤어요!", LAYER);
    });
    const t = setTimeout(() => {
      ids.forEach((id) => {
        if (drawing.current.has(id)) return;
        critters.setState(id, null, LAYER);
        critters.say(id, null, LAYER);
      });
    }, DONE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed]);

  // the drawing show's cast: our canvases, who draws, where they stand
  const crewRef = useRef(crew);
  crewRef.current = crew;
  const showOnRef = useRef(showOn);
  showOnRef.current = showOn;
  useEffect(() => {
    if (!box.current || !cover.current || !ink.current || !caret.current) return;
    const cast: ShowCast = {
      engine: target.engine.id,
      layer: LAYER,
      box: box.current,
      cover: cover.current,
      ink: ink.current,
      caret: caret.current,
      enabled: () => showOnRef.current(),
      drawer: (i) => {
        // whoever edited this file since the last change, newest first; else the card's owner
        const since = lastChange.current;
        const list = crewRef.current;
        const callers = list
          .map((c) => ({ c, at: lastCall(c.agent, target.engine.id)?.at ?? 0 }))
          .filter((x) => x.at > since - RECENT_MS)
          .sort((a, b) => b.at - a.at)
          .map((x) => x.c);
        const pool = callers.length ? callers : list.slice(0, 1);
        const pick = pool[i % Math.max(1, pool.length)];
        if (!pick) return null;
        return { id: pick.agent.id, color: colorOf(pick.agent.name, pick.agent.role)[1] };
      },
      where: (id) => posOf(id),
      busy: (id, b) => {
        if (b) drawing.current.add(id);
        else {
          drawing.current.delete(id);
          lastChange.current = Date.now();
        }
      },
    };
    stageDirector.attach(cast);
    return () => stageDirector.detach(cast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.engine.id, target.path]);

  // leaving the file: forget every override this layer made
  useEffect(
    () => () => {
      for (const { agent } of crewRef.current) critters.release(agent.id, LAYER);
      active.current.clear();
      drawing.current.clear();
    },
    [target.path],
  );

  const clampIn = (p: Spot) => ({ x: Math.min(size.w - 18, Math.max(18, p.x)), y: Math.min(size.h - 6, Math.max(SIZE + 8, p.y)) });

  const items: PlacedCritter[] = crew.map(({ agent, task }) => ({
    id: agent.id,
    agent,
    task,
    ...(home.current[agent.id] ?? { x: size.w / 2, y: size.h / 2 }),
    // roaming members keep quiet; working ones get their line from the override
    say: "",
  }));

  const layer: React.CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };
  return (
    <div ref={box} style={{ ...layer, zIndex: 5, overflow: "hidden" }} aria-hidden="true">
      <canvas ref={cover} style={{ ...layer, opacity: 0 }} />
      <canvas ref={ink} style={{ ...layer, opacity: 0 }} />
      <div ref={caret} style={{ position: "absolute", left: 0, top: 0, width: 2, borderRadius: 1, opacity: 0 }} />
      {visible && <CritterLayer id={LAYER} items={items} size={SIZE} speed={AMBLE} names />}
    </div>
  );
}
