// The office: every team on screen gets a pod of desks — the 총괄's big desk (two monitors, headset
// stand) up front, then the 팀장 desks (paper trays), then the 작업자 desks (monitor and toolbox).
// A cat at work sits at its own desk tapping away; a cat with nothing to do strolls about the lounge
// (sofa, coffee machine, plants) or naps there. A permission request pops up over the asking cat's
// head, with 허락 / 거절 right in the bubble (the same answer the chat's cards send).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp, useOfficeTeams, waitsForMe } from "../../store";
import type { Agent, ChatMsg, Project, Task, TeamSnapshot } from "../../lib/api";
import { plainAction } from "../../lib/plainAction";
import { currentCard, liveCrew, loungeOnlyCrew } from "../../lib/crew";
import { pickLine } from "./chatter";
import { ensurePixelOffice } from "./pixelOffice";
import { CritterLayer, critterState, useReducedMotion, type PlacedCritter } from "../critters";
import type { Pose } from "../critters/state";
import { catName } from "../critters/pixel/coats";

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
const LOUNGE_MAX = 6;

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
  const openIn = useApp((s) => s.openIn);
  const narrow = useNarrow();
  const still = useReducedMotion();
  const size = narrow ? 46 : 58;
  const content = useRef<HTMLDivElement>(null);

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
  const [room, setRoom] = useState<{ seats: Record<string, Spot>; lounge: Box; marks: Spot[]; door: Spot; w: number } | null>(null);
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
        return clamp({ x: r.left - o.left + r.width / 2, y: r.bottom - o.top + 8 });
      });
      const d = el.querySelector("[data-door]")?.getBoundingClientRect();
      const door = d ? { x: d.left - o.left + d.width / 2, y: d.bottom - o.top } : { x: el.clientWidth - 30, y: 60 };
      setRoom((prev) => {
        const next = { seats, lounge, marks, door, w: el.clientWidth };
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
  }, [shape, size]);

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
        let best: Spot | null = null;
        for (let t = 0; t < 16; t++) {
          const mark = room.marks.length && Math.random() < 0.6 ? room.marks[Math.floor(Math.random() * room.marks.length)] : null;
          const p = mark
            ? { x: Math.min(L.x + L.w, Math.max(L.x, mark.x + (Math.random() - 0.5) * size)), y: Math.min(L.y + L.h, Math.max(L.y, mark.y + (Math.random() - 0.5) * size * 0.4)) }
            : { x: L.x + Math.random() * L.w, y: L.y + Math.random() * L.h };
          // somewhere new, not where it already stands
          if (free(p) && (!cur[k] || Math.hypot(cur[k].x - p.x, cur[k].y - p.y) > size)) {
            best = p;
            break;
          }
          best ??= p;
        }
        next[k] = best!;
      }
      return next;
    };
    // newcomers (and everyone, when the lounge moved) get a spot right away
    setStrolls((cur) => {
      const kept = Object.fromEntries(Object.entries(cur).filter(([k, p]) => keys.includes(k) && p.x >= L.x - 1 && p.x <= L.x + L.w + 1 && p.y >= L.y - 1 && p.y <= L.y + L.h + 1));
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
    const spot = (desk ? seat && { x: seat.x, y: seat.y } : strolls[m.key]) ?? lastSpot.current[m.key];
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
      state: desk ? (asks[m.key] ? "block" : st) : st === "done" ? "done" : "idle",
      // the lounge isn't all coffee: each cat has its own way of resting (it changes now and then)
      pose: desk ? undefined : restPose(m.key, restTurn),
      // a lounging cat ambles; one at its desk fidgets now and then (not while asking)
      // (the walk over from its desk goes at the usual pace; the ambling starts once it's there)
      speed: desk || !settled(m.key) ? undefined : narrow ? 38 : 52,
      fidget: desk && !asks[m.key]?.length,
      snap: desk && prevDesk.has(m.key),
      say: asks[m.key]?.length ? "" : (chatter[m.key] ?? (m.agent.status === "block" ? "질문이 있어요" : m.reported ? `보고함${m.task ? ` · ${m.task.id}` : ""}` : "")),
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

  return (
    <div className="of-room" aria-label="사무실: 팀원들이 일하는 모습">
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
          <div className={`of-lounge${lounging.length ? "" : " of-lounge-quiet"}`} data-lounge aria-hidden="true">
            <span className="of-lounge-name">휴게실{waitingAll.length ? ` · ${waitingAll.length}명` : ""}</span>
            {extra > 0 && <span className="of-lounge-more">+{extra}</span>}
            <span className="of-rug px-rug" data-spot />
            <span className="of-sofa px-sofa" data-spot />
            <span className="of-cushion px-cushion" />
            <span className="of-coffee px-coffee" data-spot />
            <span className="of-tower px-tower" data-spot />
            <span className="of-plant px-plant" data-spot />
            <span className="of-plant of-plant-2 px-plant" data-spot />
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
