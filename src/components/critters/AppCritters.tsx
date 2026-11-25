// The critters' home: one layer over the whole app window (pointer-events: none). Each teammate on
// the clock walks to where its work shows on screen, found by `data-critter-anchor` marks:
//   working  → its card on the board or in the report feed (task:<project>:<task>), tapping away
//   reporting → the report card that just came in (report:<project>:<task>), a happy hop
//   asking   → the permission/question card above the chat box (ask:<project>:<agent>), hand up
//   총괄      → near its chat (lead:<project> or lead); when it hands out work it walks to the worker
//   resting  → ambles about the empty parts of the screen
// An open editing screen takes its own team over (EditorCritters claims them). A mark scrolled out
// of view: the critter waits at the edge and points that way. Critters keep clear of the mouse,
// the box being typed in and selected text, and stay small (fewer and smaller on a phone).
import { useEffect, useMemo, useRef, useState } from "react";
import { isLive, useApp } from "../../store";
import type { Agent, Task } from "../../lib/api";
import { CritterLayer, useReducedMotion, type PlacedCritter } from "./CritterLayer";
import { critters, useCritterStore } from "./critterStore";
import { critterState } from "./state";

export const APP_LAYER = "app";
const ROLE_ORDER = { lead: 0, mgr: 1, worker: 2 } as const;
/** a report this fresh still gets carried to the feed */
const REPORT_MS = 15_000;
/** work handed out this recently: the 총괄 walks it over */
const HANDOFF_MS = 9_000;
const TICK_MS = 1000;
const FOLLOW = 220;
const AMBLE = 42;

type Box = { x: number; y: number; w: number; h: number };
type Spot = { x: number; y: number };
const inBox = (p: Spot, b: Box, pad: number) => p.x > b.x - pad && p.x < b.x + b.w + pad && p.y > b.y - pad && p.y < b.y + b.h + pad;
const boxOf = (r: DOMRect): Box => ({ x: r.left, y: r.top, w: r.width, h: r.height });

function useViewport() {
  const [v, setV] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return v;
}

/** the part of an element that can be seen: clipped by scrolling ancestors and the window */
function visible(el: Element): { rect: Box; clip: Box } {
  const r = el.getBoundingClientRect();
  let clip: Box = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const st = getComputedStyle(p);
    if (/(auto|scroll|hidden)/.test(st.overflowY + st.overflowX)) {
      const c = p.getBoundingClientRect();
      const x = Math.max(clip.x, c.left);
      const y = Math.max(clip.y, c.top);
      clip = { x, y, w: Math.max(0, Math.min(clip.x + clip.w, c.right) - x), h: Math.max(0, Math.min(clip.y + clip.h, c.bottom) - y) };
    }
  }
  return { rect: boxOf(r), clip };
}

/** the first shown element carrying any of these marks */
function findAnchor(tokens: string[]) {
  for (const t of tokens) {
    for (const el of document.querySelectorAll(`[data-critter-anchor~="${CSS.escape(t)}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

/** nothing to read or click right under this point (a gap between panels, a panel's empty part) */
function emptyAt(x: number, y: number) {
  for (const dy of [-4, -14]) {
    const el = document.elementFromPoint(x, y + dy);
    if (!el) return false;
    if (el.closest("input, textarea, button, a, select, iframe, [contenteditable=true], pre, code, img, canvas, summary")) return false;
    for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) return false;
  }
  return true;
}

interface Member {
  key: string;
  pid: string;
  agent: Agent;
  task?: Task;
  team: string;
}

export function AppCritters() {
  const on = useApp((s) => s.critters);
  const projects = useApp((s) => s.projects);
  const teams = useApp((s) => s.teams);
  const current = useApp((s) => s.projectId);
  const view = useApp((s) => s.view.name);
  const claims = useCritterStore((s) => s.claims);
  const still = useReducedMotion();
  const vp = useViewport();
  const phone = vp.w < 820;
  const size = phone ? 20 : 24;
  const cap = phone ? 4 : 8;

  // teammates of the teams on screen; the most interesting first, up to the cap
  const crew = useMemo(() => {
    const list: Member[] = [];
    for (const p of projects) {
      const t = teams[p.id];
      if (!t || !(isLive(t) || p.id === current)) continue;
      for (const a of t.agents)
        if (claims[`${p.id}:${a.id}`] || (a.status !== "off" && (a.status !== "done" || a.role === "lead" || recentReport(a, t.tasks))))
          list.push({ key: `${p.id}:${a.id}`, pid: p.id, agent: a, task: a.taskId ? t.tasks.find((x) => x.id === a.taskId) : undefined, team: p.name });
    }
    const rank = (m: Member) => (claims[m.key] ? -1 : m.agent.status === "block" ? 0 : recentReport(m.agent, teams[m.pid]?.tasks ?? []) ? 1 : m.agent.status === "work" ? 2 : m.agent.role === "lead" ? 3 : 4);
    // the cats live in the office now (Office.tsx); this window-wide layer only carries the ones an
    // editing screen has taken over (its drawing show), which walk over the editor
    const picked = [...list].sort((x, y) => rank(x) - rank(y) || ROLE_ORDER[x.agent.role] - ROLE_ORDER[y.agent.role]).filter((m) => claims[m.key]);
    return picked;
  }, [projects, teams, current, claims, cap]);

  // where things are that critters keep away from
  const mouse = useRef<Spot | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => (mouse.current = { x: e.clientX, y: e.clientY });
    const out = () => (mouse.current = null);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", out);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", out);
    };
  }, []);
  const avoid = (): Box[] => {
    const out: Box[] = [];
    const a = document.activeElement;
    if (a && a.matches("input, textarea, [contenteditable=true]")) out.push(boxOf(a.getBoundingClientRect()));
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) for (let i = 0; i < Math.min(sel.rangeCount, 3); i++) out.push(boxOf(sel.getRangeAt(i).getBoundingClientRect()));
    return out;
  };
  const clear = (p: Spot, zones: Box[]) => !zones.some((z) => inBox(p, z, 18 + size)) && !(mouse.current && Math.hypot(p.x - mouse.current.x, p.y - mouse.current.y) < 100);

  // first spots: scattered over empty parts of the screen
  const home = useRef<Record<string, Spot>>({});
  const roamSpot = (taken: Spot[], near?: Spot): Spot => {
    const zones = avoid();
    let best: Spot | null = null;
    for (let k = 0; k < 24; k++) {
      const p = near
        ? { x: near.x + (Math.random() - 0.5) * 360, y: near.y + (Math.random() - 0.5) * 220 }
        : { x: 30 + Math.random() * (vp.w - 60), y: 70 + Math.random() * (vp.h - 90) };
      p.x = Math.min(vp.w - 24, Math.max(24, p.x));
      p.y = Math.min(vp.h - 6, Math.max(size + 30, p.y));
      if (!clear(p, zones) || taken.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < size * 2.4)) continue;
      if (emptyAt(p.x, p.y)) return p;
      best ??= p;
    }
    return best ?? { x: 30 + Math.random() * (vp.w - 60), y: vp.h - 12 };
  };
  for (const m of crew) home.current[m.key] ??= roamSpot(Object.values(home.current));

  const [says, setSays] = useState<Record<string, string>>({});
  const crewRef = useRef(crew);
  crewRef.current = crew;

  // the brain: every second (and right after a scroll or resize) pick each critter's spot
  useEffect(() => {
    if (!on) return;
    let pending = 0;
    const plan = () => {
      pending = 0;
      if (document.hidden) return;
      const now = Date.now();
      const zones = avoid();
      const over = useCritterStore.getState().over;
      const posOf = (k: string): Spot => {
        const o = over[`${APP_LAYER}:${k}`];
        return o?.x != null && o?.y != null ? { x: o.x, y: o.y } : home.current[k];
      };
      const taken: Spot[] = [];
      const perch = new Map<Element, number>();
      // one bubble per spot (the most urgent critter's: the list is sorted that way), so they don't pile up
      const bubbled = new Set<Element>();
      const nextSays: Record<string, string> = {};
      for (const m of crewRef.current) {
        if (useCritterStore.getState().claims[m.key]) continue; // an editing screen moves this one
        const { agent: a, pid } = m;
        const team = teams[pid];
        let want: { el: Element; tip?: string } | null = null;
        let state: ReturnType<typeof critterState> | null = null;
        const report = recentReport(a, team?.tasks ?? []);
        const handoff = a.role === "lead" ? team?.tasks.find((t) => t.requestedBy === a.id && t.assignee && now - t.createdAt < HANDOFF_MS) : undefined;
        if (a.status === "block") {
          const el = findAnchor([`ask:${pid}:${a.id}`, `member:${pid}:${a.id}`, ...(m.task ? [`task:${pid}:${m.task.id}`] : [])]);
          if (el) want = { el, tip: "허락을 기다려요" };
        } else if (report) {
          const el = findAnchor([`report:${pid}:${report.id}`, `task:${pid}:${report.id}`, `member:${pid}:${a.id}`]);
          if (el) {
            want = { el, tip: `${report.id} 보고!` };
            state = "done";
          }
        } else if (handoff) {
          const el = findAnchor([`member:${pid}:${handoff.assignee}`, `task:${pid}:${handoff.id}`]);
          if (el) want = { el, tip: `${handoff.id} 맡겨요` };
        } else if (a.status === "work" && m.task) {
          const el = findAnchor([`report:${pid}:${m.task.id}`, `member:${pid}:${a.id}`, `task:${pid}:${m.task.id}`]);
          if (el) want = { el };
        } else if (a.role === "lead") {
          const el = findAnchor([`lead:${pid}`, "lead"]);
          if (el) want = { el };
        }

        let spot: Spot | null = null;
        // a short row with no icon to sit on (a sub-task line in a report card): perch on the card
        // around it instead, so the critter doesn't cover the row above
        if (want && want.el.getBoundingClientRect().height < 56 && !want.el.querySelector(".critter")) {
          const card = want.el.parentElement?.closest("[data-critter-anchor]");
          if (card) want = { ...want, el: card };
        }
        if (want) {
          const { rect, clip } = visible(want.el);
          const k = perch.get(want.el) ?? 0;
          perch.set(want.el, k + 1);
          // a board row has the member's little icon: sit right on it (its desk). A card: perched on
          // its top edge toward the right end. The 총괄: on its chat's top edge.
          const lead = a.role === "lead" && !handoff;
          const seat = rect.h < 56 ? want.el.querySelector(".critter")?.getBoundingClientRect() : undefined;
          let p: Spot = seat && k === 0
            ? { x: seat.left + seat.width / 2, y: seat.bottom - 1 }
            : lead
              ? { x: rect.x + rect.w * 0.55 + k * (size + 6), y: rect.y + 3 }
              : { x: rect.x + rect.w - 22 - k * (size + 6), y: rect.y + 3 };
          const inside = clip.w > 0 && clip.h > 0 && rect.y + 4 >= clip.y && rect.y + 4 <= clip.y + clip.h && rect.x < clip.x + clip.w && rect.x + rect.w > clip.x;
          if (!inside && clip.w > 0 && clip.h > 0) {
            // scrolled away: wait at the edge of its panel and point that way
            const up = rect.y < clip.y;
            p = { x: Math.min(clip.x + clip.w - 20, Math.max(clip.x + 20, p.x)), y: up ? clip.y + size + 8 : clip.y + clip.h - 4 };
            nextSays[m.key] = `${up ? "↑" : "↓"} ${want.tip ?? m.task?.id ?? ""}`.trim();
          } else if (want.tip && !bubbled.has(want.el)) {
            nextSays[m.key] = want.tip;
            bubbled.add(want.el);
          }
          // out of the person's way: step up and aside
          for (let t = 0; t < 4 && !clear(p, zones); t++) p = { x: p.x - (size + 10), y: p.y };
          spot = p;
        }
        if (!spot) {
          // resting (or its mark isn't on screen): amble about the empty parts
          const cur = posOf(m.key);
          const blocked = !clear(cur, zones) || !emptyAt(cur.x, cur.y);
          if (blocked || (!still && Math.random() < 0.14)) spot = roamSpot(taken, blocked ? undefined : cur);
        }
        if (spot) {
          const cur = over[`${APP_LAYER}:${m.key}`];
          if (!cur || cur.x == null || Math.hypot((cur.x ?? 0) - spot.x, (cur.y ?? 0) - spot.y) > 6) critters.send(m.key, spot.x, spot.y, APP_LAYER, want ? FOLLOW : AMBLE);
          taken.push(spot);
        } else taken.push(posOf(m.key));
        if ((over[`${APP_LAYER}:${m.key}`]?.state ?? null) !== state) critters.setState(m.key, state, APP_LAYER);
      }
      setSays((s) => (JSON.stringify(s) === JSON.stringify(nextSays) ? s : nextSays));
    };
    plan();
    const t = setInterval(plan, TICK_MS);
    const soon = () => {
      if (!pending) pending = window.setTimeout(plan, 160);
    };
    window.addEventListener("scroll", soon, true);
    window.addEventListener("resize", soon);
    return () => {
      clearInterval(t);
      clearTimeout(pending);
      window.removeEventListener("scroll", soon, true);
      window.removeEventListener("resize", soon);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, teams, view, vp.w, vp.h, still]);

  if (!on || !crew.length) return null;
  const items: PlacedCritter[] = crew.map((m) => ({
    id: m.key,
    agent: m.agent,
    task: m.task,
    colorKey: m.agent.role === "lead" ? m.team : undefined,
    ...home.current[m.key],
    say: says[m.key] ?? "",
  }));
  return (
    <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 45, pointerEvents: "none", overflow: "hidden" }}>
      <CritterLayer id={APP_LAYER} items={items} size={size} speed={AMBLE} width={vp.w} />
    </div>
  );
}

/** the card this member finished moments ago, if any (it carries the report to the feed) */
function recentReport(a: Agent, tasks: Task[]) {
  if (a.role === "lead") return undefined;
  const now = Date.now();
  return tasks.find((t) => t.assignee === a.id && (t.stage === "review" || t.stage === "done") && now - t.updatedAt < REPORT_MS);
}
