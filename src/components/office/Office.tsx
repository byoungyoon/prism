// The office: every team on screen gets a pod of desks — the 총괄's big desk (two monitors, headset
// stand) up front, then the 팀장 desks (paper trays), then the 작업자 desks (monitor and toolbox).
// A cat at work sits at its own desk tapping away; a cat with nothing to do strolls about the lounge
// (sofa, coffee machine, plants) or naps there. A permission request pops up over the asking cat's
// head, with 허락 / 거절 right in the bubble (the same answer the chat's cards send).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as RMouse, type PointerEvent as RPointer } from "react";
import { useApp, useOfficeTeams, waitsForMe } from "../../store";
import type { Agent, ChatMsg, Project, Task, TeamSnapshot } from "../../lib/api";
import { plainAction } from "../../lib/plainAction";
import { currentCard, liveCrew, loungeOnlyCrew } from "../../lib/crew";
import { pickLine } from "./chatter";
import { ensurePixelOffice } from "./pixelOffice";
import { CritterLayer, critterState, useReducedMotion, type PlacedCritter } from "../critters";
import type { Pose } from "../critters/state";
import { catName, coatOf, temperOf, TEMPER_FLIP } from "../critters/pixel/coats";

type Spot = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

const ROLE_WORD = { lead: "총괄", mgr: "팀장", worker: "작업자" } as const;

interface Member {
  key: string;
  project: Project;
  team: TeamSnapshot;
  agent: Agent;
  task?: Task;
  /** reported, waiting for the 총괄 to check the card */
  reported?: boolean;
}

function useNarrow() {
  const q = "(max-width: 820px)";
  const [n, setN] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setN(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return n;
}

/** at the desk: working, stuck or asking — and the 총괄 of a team at work */
const atDesk = (a: Agent) => a.status === "work" || a.status === "block" || a.role === "lead";

/** how a lounging cat rests: coffee, a nap, or just sitting — by cat, shuffled now and then */
const REST_POSES: Pose[] = ["coffee", "sleep", "sit", "coffee", "sleep"];
const restPose = (key: string, turn: number): Pose => {
  let h = turn * 7;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return REST_POSES[Math.abs(h) % REST_POSES.length];
};

/** most cats shown in the lounge; the rest are a "+N" */
const LOUNGE_MAX = 10;

/** the furniture's places (fractions of the lounge's size) are kept in this browser */
const LAYOUT_KEY = "prism.lounge.layout";
function loadLayout(): Record<string, Spot> {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
/** a press that moves less than this is a click, not a drag */
const DRAG_PX = 6;
/** a piece of furniture is never dragged up under the lounge's name tag */
const LABEL_PAD = 30;
const within = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** how a lounging cat is for a while: a line it says, a pose it takes, or hurrying off */
interface Mood {
  say?: string;
  pose?: Pose;
  fast?: boolean;
}
/** a cat held up by the scruff, and where it is now (in the room's pixels) */
interface Lift {
  key: string;
  x: number;
  y: number;
  compliant: boolean;
}
interface CatGesture {
  key: string;
  desk: boolean;
  pid: number;
  sx: number;
  sy: number;
  /** the press's offset from the cat's feet, so it does not jump to the pointer */
  ox: number;
  oy: number;
  x: number;
  y: number;
  on: boolean;
  compliant: boolean;
  origin: Spot;
  box: Box;
  move: (e: PointerEvent) => void;
  up: (e: PointerEvent) => void;
}
interface PieceGesture {
  name: string;
  pid: number;
  sx: number;
  sy: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
  on: boolean;
  el: HTMLElement;
  move: (e: PointerEvent) => void;
  up: (e: PointerEvent) => void;
}
function stopGesture(g: { pid: number; move: (e: PointerEvent) => void; up: (e: PointerEvent) => void }) {
  window.removeEventListener("pointermove", g.move);
  window.removeEventListener("pointerup", g.up);
  window.removeEventListener("pointercancel", g.up);
}

function Desk({ m, onOpen }: { m: Member; onOpen: () => void }) {
  const role = m.agent.role;
  return (
    <button className={`of-desk of-desk-${role}`} onClick={onOpen} title={`${catName(m.agent)} · ${ROLE_WORD[role]} 작업 화면`} aria-label={`${catName(m.agent)} 책상 (${ROLE_WORD[role]})`}>
      <span className={`of-chair ${role === "lead" ? "px-chair-lead" : "px-chair"}`} />
      <span className="of-seat" data-seat={m.key} />
      <span className={`of-desk-top ${role === "lead" ? "px-desk-lead" : "px-desk"}`}>
        {role === "lead" ? (
          <>
            <span className="of-monitor px-monitor" />
            <span className="of-monitor of-monitor-2 px-monitor" />
            <span className="of-headset px-headset" />
          </>
        ) : role === "mgr" ? (
          <>
            <span className="of-monitor px-monitor" />
            <span className="of-papers px-papers" />
          </>
        ) : (
          <>
            <span className="of-monitor px-monitor" />
            <span className="of-toolbox px-toolbox" />
          </>
        )}
        <span className="of-keyboard px-keyboard" />
        <span className="of-mug px-mug" />
      </span>
      <span className="of-plate">{catName(m.agent)}</span>
    </button>
  );
}

/** widest a permission bubble gets, and the narrowest it is squeezed to between two asking neighbours */
const ASK_HALF = 104;
const ASK_HALF_MIN = 46;

/**
 * How wide each permission bubble may be: two cats asking side by side would get bubbles over each
 * other, so bubbles on the same row share the room between them.
 */
function askHalves(spots: { key: string; at: Spot }[], width: number): Record<string, number> {
  const max = Math.max(ASK_HALF_MIN, Math.min(ASK_HALF, (width - 16) / 2));
  const out: Record<string, number> = {};
  for (const s of spots) out[s.key] = max;
  const sorted = [...spots].sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (Math.abs(a.at.y - b.at.y) > 12) continue; // another row
    const room = (b.at.x - a.at.x - 6) / 2;
    if (room < out[a.key]) out[a.key] = Math.max(ASK_HALF_MIN, room);
    if (room < out[b.key]) out[b.key] = Math.max(ASK_HALF_MIN, room);
  }
  return out;
}

function AskBubble({ m, msgs, at, width, half: want }: { m: Member; msgs: ChatMsg[]; at: Spot; width: number; half: number }) {
  const answer = useApp((s) => s.answerPermission);
  const first = msgs[0];
  const p = first.permission!;
  const half = Math.min(want, (width - 16) / 2);
  const left = Math.min(width - half - 8, Math.max(half + 8, at.x));
  // a desk at the very top of the room: the bubble stays inside it (its top would be cut off)
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  const top = Math.max(at.y, h + 4);
  const what = plainAction(p.tool, p.detail);
  // the tail points at the cat, but never off the bubble's rounded corners
  const tail = Math.max(-half + 14, Math.min(half - 14, at.x - left));
  return (
    <div ref={box} className="of-ask" role="alertdialog" aria-label={`${catName(m.agent)} 허락 요청`} style={{ left, top, width: half * 2 }}>
      <span className="of-ask-text" title={`${catName(m.agent)} · ${what}${p.detail ? `\n${p.detail}` : ""}`}>
        <b>{catName(m.agent)}</b> · {what}
        {msgs.length > 1 && <span className="of-ask-more"> 외 {msgs.length - 1}건</span>}
      </span>
      <span className="of-ask-buttons">
        <button className="of-ask-yes" onClick={() => void answer(first.id, "allow", m.project.id)}>
          허락
        </button>
        <button className="of-ask-no" onClick={() => void answer(first.id, "deny", m.project.id)}>
          거절
        </button>
      </span>
      {top === at.y && <span className="of-ask-tail" style={{ left: `calc(50% + ${tail}px)` }} />}
    </div>
  );
}

export function Office(_props: { onTeam?: (projectId: string) => void } = {}) {
  // the furniture's pixel pictures (drawn once, kept in a <style>)
  ensurePixelOffice();
  const shown = useOfficeTeams();
  // the lounge's furniture: only what the person bought in the shop is drawn ("item:<이름>")
  const owned = useApp((s) => s.owned);
  const has = (name: string) => owned.includes(`item:${name}`);
  const openIn = useApp((s) => s.openIn);
  const narrow = useNarrow();
  const still = useReducedMotion();
  const size = narrow ? 46 : 58;
  const content = useRef<HTMLDivElement>(null);

  // the lounge's furniture can be dragged about; the places are kept (localStorage)
  const loungeRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Record<string, Spot>>(loadLayout);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // no storage: the places just aren't kept
    }
  }, [layout]);
  const layoutKey = JSON.stringify(layout);
  /** a piece of furniture moved by hand has its own place; the rest keep their place in the CSS */
  const pieceAt = (name: string): CSSProperties | undefined => {
    const p = layout[name];
    return p ? { left: `${p.x * 100}%`, top: `${p.y * 100}%`, right: "auto", bottom: "auto", transform: "translate(-50%, -50%)" } : undefined;
  };
  // how the lounging cats are for a while (a line, a pose, hurrying off), and a cat held up right now
  const [mood, setMood] = useState<Record<string, Mood>>({});
  const [held, setHeld] = useState<Lift | null>(null);
  const catG = useRef<CatGesture | null>(null);
  const pieceG = useRef<PieceGesture | null>(null);
  // a press on a cat (or over its desk) must not also open that desk when released
  const swallow = useRef(false);

  // permission requests waiting for the person, by the agent asking (that cat stays at its desk)
  const asks = useMemo(() => {
    const by: Record<string, ChatMsg[]> = {};
    for (const { project, team } of shown) for (const m of team.chat) if (m.permission && waitsForMe(m)) (by[`${project.id}:${m.permission.agentId}`] ??= []).push(m);
    return by;
  }, [shown]);

  // each team's live crew. A team with someone at work (or asking) gets desks: its 총괄 plus everyone
  // working; a team where nobody works gets no area at all, and its 팀장·작업자 between cards still rest in the lounge. Members who reported and
  // wait for the 총괄's check are in the lounge too ("보고함").
  const { pods, idle } = useMemo(() => {
    const pods: { project: Project; desks: Member[]; waiting: Member[] }[] = [];
    const idle: Member[] = [];
    for (const { project, team } of shown) {
      const member = (a: Agent): Member => ({ key: `${project.id}:${a.id}`, project, team, agent: a, task: currentCard(team, a) });
      const crew = liveCrew(team).map(member);
      // reported 작업자, and resting ones while nobody is in: in the lounge with or without the 총괄
      const reported = loungeOnlyCrew(team).map(({ agent, reported }): Member => ({ ...member(agent), reported }));
      const busy = crew.some((m) => m.agent.status === "work" || m.agent.status === "block" || asks[m.key]?.length);
      if (!busy) {
        const waiting = [...crew.filter((m) => m.agent.role !== "lead"), ...reported];
        idle.push(...waiting);
        continue;
      }
      const seated = (m: Member) => atDesk(m.agent) || !!asks[m.key]?.length;
      pods.push({ project, desks: crew.filter(seated), waiting: [...crew.filter((m) => !seated(m)), ...reported] });
    }
    return { pods, idle };
  }, [shown, asks]);
  const deskMembers = pods.flatMap((p) => p.desks);
  const waitingAll = [...pods.flatMap((p) => p.waiting), ...idle];
  const lounging = waitingAll.slice(0, LOUNGE_MAX);
  const extra = waitingAll.length - lounging.length;
  const members = [...deskMembers, ...lounging];
  // what the layout depends on: who is where (a permission bubble floats over the room and moves nothing)
  const shape = members.map((m) => m.key).join("|");

  // where the seats, the lounge (and its sofa, coffee machine and plants) and the door are,
  // measured from the laid-out room
  const [room, setRoom] = useState<{ seats: Record<string, Spot>; lounge: Box; marks: Spot[]; blocks: Box[]; door: Spot; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const measure = () => {
      const o = el.getBoundingClientRect();
      const seats: Record<string, Spot> = {};
      el.querySelectorAll<HTMLElement>("[data-seat]").forEach((s) => {
        const r = s.getBoundingClientRect();
        seats[s.dataset.seat!] = { x: r.left - o.left + r.width / 2, y: r.top - o.top };
      });
      const le = el.querySelector("[data-lounge]");
      const l = le?.getBoundingClientRect();
      const lounge = l ? { x: l.left - o.left + 24, y: l.top - o.top + size + 26, w: Math.max(10, l.width - 48), h: Math.max(10, l.height - size - 40) } : { x: 20, y: 60, w: 100, h: 60 };
      // a cat goes to the sofa, the coffee machine or a plant: it stands just in front of it
      const clamp = (p: Spot) => ({ x: Math.min(lounge.x + lounge.w, Math.max(lounge.x, p.x)), y: Math.min(lounge.y + lounge.h, Math.max(lounge.y, p.y)) });
      const marks = [...(le?.querySelectorAll<HTMLElement>("[data-spot]") ?? [])].map((m) => {
        const r = m.getBoundingClientRect();
        // a cat rests ON a box, a scratcher or the sunny patch (data-on), and otherwise stands in front of the piece
        return m.hasAttribute("data-on")
          ? clamp({ x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height * 0.75 })
          : clamp({ x: r.left - o.left + r.width / 2, y: r.bottom - o.top + 8 });
      });
      // tall decor (bookcase, lamp, plants): no cat stands on or right in front of it
      const blocks = [...(le?.querySelectorAll<HTMLElement>("[data-block]") ?? [])].map((m) => {
        const r = m.getBoundingClientRect();
        return { x: r.left - o.left - size * 0.4, y: r.top - o.top, w: r.width + size * 0.8, h: r.height + size * 0.5 };
      });
      const d = el.querySelector("[data-door]")?.getBoundingClientRect();
      const door = d ? { x: d.left - o.left + d.width / 2, y: d.bottom - o.top } : { x: el.clientWidth - 30, y: 60 };
      setRoom((prev) => {
        const next = { seats, lounge, marks, blocks, door, w: el.clientWidth };
        return prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // the lounge grows and shrinks smoothly (a transition): its cats follow as it does
    const le = el.querySelector("[data-lounge]");
    if (le) ro.observe(le);
    return () => ro.disconnect();
  }, [shape, size, owned.join("|"), layoutKey]);

  // lounging cats: a spot each — by the sofa, the coffee machine, a plant, or anywhere in between,
  // never on top of another cat — and now and then one gets up and wanders slowly to another
  const [strolls, setStrolls] = useState<Record<string, Spot>>({});
  const loungers = lounging.map((m) => m.key);
  const loungeKey = loungers.join("|");
  useEffect(() => {
    if (!room) return;
    const L = room.lounge;
    const keys = loungeKey ? loungeKey.split("|") : [];
    const pickFor = (movers: string[], cur: Record<string, Spot>) => {
      const next = { ...cur };
      for (const k of movers) {
        const others = keys.filter((o) => o !== k && next[o]).map((o) => next[o]);
        const free = (p: Spot) => others.every((o) => Math.hypot(o.x - p.x, o.y - p.y) > size * 1.3);
        const clear = (p: Spot) => !room.blocks.some((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
        let best: Spot | null = null;
        for (let t = 0; t < 30; t++) {
          const mark = room.marks.length && Math.random() < 0.6 ? room.marks[Math.floor(Math.random() * room.marks.length)] : null;
          const p = mark
            ? { x: Math.min(L.x + L.w, Math.max(L.x, mark.x + (Math.random() - 0.5) * size)), y: Math.min(L.y + L.h, Math.max(L.y, mark.y + (Math.random() - 0.5) * size * 0.4)) }
            : { x: L.x + Math.random() * L.w, y: L.y + Math.random() * L.h };
          // somewhere new, not where it already stands
          if (!clear(p)) continue;
          if (free(p) && (!cur[k] || Math.hypot(cur[k].x - p.x, cur[k].y - p.y) > size)) {
            best = p;
            break;
          }
          best ??= p;
        }
        next[k] = best ?? cur[k] ?? { x: L.x + L.w / 2, y: L.y + L.h / 2 };
      }
      return next;
    };
    // newcomers (and everyone, when the lounge moved) get a spot right away
    setStrolls((cur) => {
      const kept = Object.fromEntries(Object.entries(cur).filter(([k, p]) => keys.includes(k) && p.x >= L.x - 1 && p.x <= L.x + L.w + 1 && p.y >= L.y - 1 && p.y <= L.y + L.h + 1 && !room.blocks.some((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)));
      return pickFor(keys.filter((k) => !kept[k]), kept);
    });
    if (still || !keys.length) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      // one of them (rarely two) gets up and strolls somewhere else
      const movers = keys.filter(() => Math.random() < 0.18);
      if (movers.length) setStrolls((cur) => pickFor(movers.slice(0, 2), cur));
    }, 3400);
    return () => clearInterval(t);
  }, [room, loungeKey, still, size]);


  // now and then one or two cats mutter something fitting (never one asking for permission:
  // its own bubble is up). A line stays a few seconds.
  const [chatter, setChatter] = useState<Record<string, string>>({});
  const talkRef = useRef({ members, deskMembers, asks });
  talkRef.current = { members, deskMembers, asks };
  useEffect(() => {
    if (still) return;
    let clear: ReturnType<typeof setTimeout> | undefined;
    const t = setInterval(() => {
      if (document.hidden) return;
      const { members: ms, deskMembers: ds, asks: ak } = talkRef.current;
      const quiet = ms.filter((m) => !ak[m.key]?.length);
      if (!quiet.length) return;
      const n = Math.random() < 0.3 ? 2 : 1;
      const picked = [...quiet].sort(() => Math.random() - 0.5).slice(0, n);
      const lines: Record<string, string> = {};
      for (const m of picked) {
        const st = critterState(m.agent, m.task);
        const atWork = ds.includes(m) && (m.agent.status === "work" || m.agent.status === "block");
        const line = pickLine({ state: st === "fail" ? "fail" : st === "block" ? "block" : st === "done" ? "done" : atWork ? "work" : "rest", since: m.agent.statusSince });
        if (line) lines[m.key] = line;
      }
      setChatter(lines);
      clearTimeout(clear);
      clear = setTimeout(() => setChatter({}), 3600);
    }, 5200);
    return () => {
      clearInterval(t);
      clearTimeout(clear);
    };
  }, [still]);

  // which way each lounging cat rests changes every minute or so
  const [restTurn, setRestTurn] = useState(0);
  useEffect(() => {
    if (still) return;
    const t = setInterval(() => setRestTurn((n) => n + 1), 70_000);
    return () => clearInterval(t);
  }, [still]);

  // where each cat was last shown: a cat whose next spot isn't measured yet (it just got up from its
  // desk, or sat down at a new one) stays put for that moment instead of leaving the layer — leaving
  // and coming back would make it pop up over there instead of walking
  const lastSpot = useRef<Record<string, Spot>>({});
  // a cat that shows up after the first drawing walks in from the door; the first drawing stays put
  const enterFrom = useRef<Record<string, Spot>>({});
  const firstDrawn = useRef(false);
  for (const k of Object.keys(enterFrom.current)) if (!members.some((m) => m.key === k)) delete enterFrom.current[k];
  // when each cat came to the lounge (gone once it's back at a desk)
  const cameIn = useRef<Record<string, number>>({});
  for (const k of Object.keys(cameIn.current)) if (!lounging.some((m) => m.key === k)) delete cameIn.current[k];
  for (const m of lounging) cameIn.current[m.key] ??= Date.now();
  const settled = (k: string) => Date.now() - (cameIn.current[k] ?? 0) > 6000;
  // who sat at a desk last render: a cat that stays at its desk while the layout shifts (a desk
  // joins the row) moves with the desk, instantly —
  // walking there would leave the cat behind, under the desk, for a moment
  const wasAtDesk = useRef<Set<string>>(new Set());
  const prevDesk = wasAtDesk.current;
  const deskKeys = deskMembers.map((m) => m.key).join("|");
  useEffect(() => {
    wasAtDesk.current = new Set(deskKeys ? deskKeys.split("|") : []);
  }, [deskKeys]);
  const items: PlacedCritter[] = [];
  useEffect(() => {
    if (items.length) firstDrawn.current = true;
  });
  for (const m of members) {
    const seat = room?.seats[m.key];
    const desk = deskMembers.includes(m);
    // a cat held up by a person is where the pointer has it
    const mine = held?.key === m.key ? held : undefined;
    const md = mood[m.key];
    const spot = mine ? { x: mine.x, y: mine.y } : (desk ? seat && { x: seat.x, y: seat.y } : strolls[m.key]) ?? lastSpot.current[m.key];
    if (!spot) continue;
    if (!lastSpot.current[m.key] && firstDrawn.current && room) enterFrom.current[m.key] ??= room.door;
    lastSpot.current[m.key] = spot;
    const st = critterState(m.agent, m.task);
    items.push({
      id: m.key,
      agent: m.agent,
      task: m.task,
      colorKey: m.agent.role === "lead" ? m.project.name : undefined,
      x: spot.x,
      y: spot.y,
      from: enterFrom.current[m.key],
      // a cat on a break naps now and then instead of hopping about
      // (a held cat looks limp and teary: "fail")
      state: mine ? "fail" : desk ? (asks[m.key] ? "block" : st) : st === "done" ? "done" : "idle",
      // the lounge isn't all coffee: each cat has its own way of resting (it changes now and then)
      pose: mine ? "lift" : desk ? undefined : (md?.pose ?? restPose(m.key, restTurn)),
      // a lounging cat ambles; one at its desk fidgets now and then (not while asking)
      // (the walk over from its desk goes at the usual pace; the ambling starts once it's there)
      speed: desk || mine || md?.fast || !settled(m.key) ? undefined : narrow ? 38 : 52,
      fidget: desk && !asks[m.key]?.length,
      snap: !!mine || (desk && prevDesk.has(m.key)),
      // a rebel wriggles in the hand
      struggle: !!mine && !mine.compliant,
      say: asks[m.key]?.length ? "" : mine ? (mine.compliant ? "" : "하악!") : (md?.say ?? chatter[m.key] ?? (m.agent.status === "block" ? "질문이 있어요" : m.reported ? `보고함${m.task ? ` · ${m.task.id}` : ""}` : "")),
    });
  }

  // the permission bubbles over the asking cats' heads (above the ? sign over the head), sharing the room when neighbours both ask
  const askSpots = room
    ? deskMembers.flatMap((m) => {
        const seat = room.seats[m.key];
        return asks[m.key]?.length && seat ? [{ key: m.key, m, at: { x: seat.x, y: seat.y - size - 24 } }] : [];
      })
    : [];
  const halves = askHalves(askSpots, room?.w ?? 0);

  /** the Mood of one cat for a while (later moods of the same cat win over the timer) */
  const feel = (key: string, m: Mood, ms: number) => {
    const mine = { ...m };
    setMood((c) => ({ ...c, [key]: mine }));
    setTimeout(
      () =>
        setMood((c) => {
          if (c[key] !== mine) return c;
          const n = { ...c };
          delete n[key];
          return n;
        }),
      ms,
    );
  };
  /** a point in the room (the content's pixels), from a pointer event */
  const local = (e: { clientX: number; clientY: number }) => {
    const o = content.current!.getBoundingClientRect();
    return { x: e.clientX - o.left, y: e.clientY - o.top };
  };
  /** the cat under the pointer: a little inside its box, so the desk around it still gets its clicks */
  const catAt = (x: number, y: number): string | null => {
    const cats = content.current ? Array.from(content.current.querySelectorAll<HTMLElement>("[data-critter]")) : [];
    for (const c of cats) {
      if (c.classList.contains("cr-leaving")) continue;
      const r = (c.querySelector(".critter") ?? c).getBoundingClientRect();
      if (x >= r.left + r.width * 0.2 && x <= r.right - r.width * 0.2 && y >= r.top + r.height * 0.1 && y <= r.bottom - r.height * 0.1) return c.dataset.critter ?? null;
    }
    return null;
  };
  const startCat = (e: { clientX: number; clientY: number; pointerId: number }, key: string): boolean => {
    const m = members.find((x) => x.key === key);
    if (!m || !room || asks[key]?.length) return false; // a cat asking for permission waits for its answer
    const desk = deskMembers.includes(m);
    const spot = desk ? room.seats[key] : (strolls[key] ?? lastSpot.current[key]);
    if (!desk && !spot) return false;
    const p = local(e);
    // a cat's character follows its coat; a little one in five times it does the opposite
    const coat = coatOf(m.agent.role === "lead" ? m.project.name : m.agent.name, m.agent.role);
    const compliant = (temperOf(coat) === "docile") !== (Math.random() < TEMPER_FLIP);
    const g: CatGesture = {
      key,
      desk,
      pid: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      ox: spot ? p.x - spot.x : 0,
      oy: spot ? p.y - spot.y : 0,
      x: spot?.x ?? p.x,
      y: spot?.y ?? p.y,
      on: false,
      compliant,
      origin: spot ?? p,
      box: room.lounge,
      move: onCatMove,
      up: onCatUp,
    };
    catG.current = g;
    window.addEventListener("pointermove", g.move);
    window.addEventListener("pointerup", g.up);
    window.addEventListener("pointercancel", g.up);
    return true;
  };
  const onCatMove = (e: PointerEvent) => {
    const g = catG.current;
    if (!g || e.pointerId !== g.pid || g.desk) return;
    if (!g.on) {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_PX) return;
      g.on = true;
    }
    const p = local(e);
    g.x = p.x - g.ox;
    g.y = p.y - g.oy;
    setHeld({ key: g.key, x: g.x, y: g.y, compliant: g.compliant });
  };
  const onCatUp = (e: PointerEvent) => {
    const g = catG.current;
    if (!g || e.pointerId !== g.pid) return;
    stopGesture(g);
    catG.current = null;
    if (!g.on) {
      // a press on a cat at work: it is bothered by it, for a moment
      if (g.desk) feel(g.key, { say: "귀찮아요" }, 1600);
      return;
    }
    setHeld(null);
    const b = g.box;
    if (g.compliant) {
      // a docile cat stays where it is put: it sits or lies down there for a while
      const x = within(g.x, b.x, b.x + b.w);
      const y = within(g.y, b.y, b.y + b.h);
      setStrolls((c) => ({ ...c, [g.key]: { x, y } }));
      feel(g.key, { pose: Math.random() < 0.5 ? "sit" : "coffee" }, 9000);
    } else {
      // a rebel hisses and runs back to where it was
      setStrolls((c) => ({ ...c, [g.key]: g.origin }));
      feel(g.key, { say: "하악!", fast: true }, 2200);
    }
  };
  const startPiece = (e: { clientX: number; clientY: number; pointerId: number }, piece: HTMLElement) => {
    const el = loungeRef.current;
    if (!el) return;
    const r = piece.getBoundingClientRect();
    const g: PieceGesture = {
      name: piece.dataset.piece ?? "",
      pid: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      dx: e.clientX - (r.left + r.width / 2),
      dy: e.clientY - (r.top + r.height / 2),
      w: r.width,
      h: r.height,
      on: false,
      el,
      move: onPieceMove,
      up: onPieceUp,
    };
    pieceG.current = g;
    window.addEventListener("pointermove", g.move);
    window.addEventListener("pointerup", g.up);
    window.addEventListener("pointercancel", g.up);
  };
  const onPieceMove = (e: PointerEvent) => {
    const g = pieceG.current;
    if (!g || e.pointerId !== g.pid) return;
    if (!g.on) {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_PX) return;
      g.on = true;
    }
    const el = g.el;
    const r = el.getBoundingClientRect();
    const W = el.clientWidth;
    const H = el.clientHeight;
    if (!W || !H) return;
    // kept inside the lounge: the piece's centre stays far enough from every edge to show whole
    const cx = e.clientX - g.dx - r.left - el.clientLeft;
    const cy = e.clientY - g.dy - r.top - el.clientTop;
    const x = within(cx, g.w / 2 + 6, W - g.w / 2 - 6) / W;
    const y = within(cy, LABEL_PAD + g.h / 2, H - g.h / 2 - 6) / H;
    setLayout((c) => ({ ...c, [g.name]: { x, y } }));
  };
  const onPieceUp = (e: PointerEvent) => {
    const g = pieceG.current;
    if (!g || e.pointerId !== g.pid) return;
    stopGesture(g);
    pieceG.current = null;
  };
  /** a press in the room: on a cat (lift it, or be bothered at its desk), else on a piece of the lounge */
  const onRoomDown = (e: RPointer) => {
    if (e.button !== 0) return;
    swallow.current = false;
    const cat = catAt(e.clientX, e.clientY);
    if (cat) {
      if (startCat(e, cat)) {
        swallow.current = true;
        e.preventDefault();
      }
      return;
    }
    const piece = (e.target as HTMLElement).closest<HTMLElement>("[data-piece]");
    if (piece && loungeRef.current?.contains(piece)) {
      startPiece(e, piece);
      e.preventDefault();
    }
  };
  /** the click that ends a press on a cat is not a click on the desk under it */
  const onRoomClick = (e: RMouse) => {
    if (!swallow.current) return;
    swallow.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <div className="of-room" aria-label="사무실: 팀원들이 일하는 모습" onPointerDown={onRoomDown} onClickCapture={onRoomClick}>
      <div ref={content} className="of-content">
        <div className="of-wall" aria-hidden="true">
          <span className="of-window px-window" />
          <span className="of-window px-window" />
          <span className="of-clock px-clock" />
          <span className="of-shelf px-shelf" />
          <span className="of-door px-door" data-door />
        </div>
        <div className="of-floor">
          <div className="of-pods">
            {pods.map(({ project, desks }) => (
              <div key={project.id} className="of-pod">
                <span className="of-pod-name">{project.name}</span>
                {(["lead", "mgr", "worker"] as const).map((role) => {
                  const row = desks.filter((m) => m.agent.role === role);
                  return row.length ? (
                    <div key={role} className={`of-row of-row-${role}`}>
                      {row.map((m) => (
                        <Desk key={m.key} m={m} onOpen={() => openIn(m.project.id, { name: "agent", id: m.agent.id })} />
                      ))}
                    </div>
                  ) : null;
                })}
              </div>
            ))}
            {!pods.length && <span className="of-empty">{shown.length ? "지금 일하는 팀이 없어요. 일을 맡기면 여기 책상에 앉아요." : "출근한 팀이 없어요"}</span>}
          </div>
          <div ref={loungeRef} className={`of-lounge${lounging.length ? "" : " of-lounge-quiet"}`} data-lounge aria-hidden="true">
            <span className="of-lounge-name">휴게실{waitingAll.length ? ` · ${waitingAll.length}명` : ""}</span>
            {extra > 0 && <span className="of-lounge-more">+{extra}</span>}
            {/* the bare room (floor and walls) is all there is until something is bought */}
            {has("액자") && <span className="of-frame px-frame" data-piece="액자" style={pieceAt("액자")} />}
            {has("책장") && <span className="of-bookcase px-bookcase" data-block data-piece="책장" style={pieceAt("책장")} />}
            {has("스탠드") && <span className="of-lamp px-lamp" data-block data-piece="스탠드" style={pieceAt("스탠드")} />}
            {has("햇살 자리") && <span className="of-sunspot px-sunspot" data-spot data-on data-piece="햇살 자리" style={pieceAt("햇살 자리")} />}
            {has("러그") && <span className="of-rug px-rug" data-spot data-piece="러그" style={pieceAt("러그")} />}
            {has("러그·쿠션") && <span className="of-rug2 px-rug2" data-piece="러그·쿠션" style={pieceAt("러그·쿠션")} />}
            {has("소파") && <span className="of-sofa px-sofa" data-spot data-piece="소파" style={pieceAt("소파")} />}
            {has("러그·쿠션") && <span className="of-cushion px-cushion" data-piece="쿠션" style={pieceAt("쿠션")} />}
            {has("숨숨집") && <span className="of-catbox px-catbox" data-spot data-on data-piece="숨숨집" style={pieceAt("숨숨집")} />}
            {has("스크래처") && <span className="of-scratcher px-scratcher" data-spot data-on data-piece="스크래처" style={pieceAt("스크래처")} />}
            {has("털실") && <span className="of-yarn px-yarn" data-piece="털실" style={pieceAt("털실")} />}
            {has("밥그릇") && <span className="of-bowls px-bowls" data-spot data-piece="밥그릇" style={pieceAt("밥그릇")} />}
            {has("정수기") && <span className="of-coffee px-coffee" data-spot data-piece="정수기" style={pieceAt("정수기")} />}
            {has("캣타워") && <span className="of-tower px-tower" data-spot data-piece="캣타워" style={pieceAt("캣타워")} />}
            {has("화분") && <span className="of-plant of-plant-1 px-plant" data-block data-piece="화분 1" style={pieceAt("화분 1")} />}
            {has("화분") && <span className="of-plant of-plant-2 px-plant" data-block data-piece="화분 2" style={pieceAt("화분 2")} />}
          </div>
        </div>
        <div className="of-cats">
          <CritterLayer id="office" items={items} size={size} speed={narrow ? 110 : 160} width={room?.w} door={room?.door} />
        </div>
        {askSpots.map(({ key, m, at }) => (
          <AskBubble key={`ask-${key}`} m={m} msgs={asks[key]} at={at} width={room!.w} half={halves[key]} />
        ))}
      </div>
    </div>
  );
}
