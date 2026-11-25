// The office: every team on screen gets a pod of desks — the 총괄's big desk (two monitors, headset
// stand) up front, then the 팀장 desks (paper trays), then the 작업자 desks (monitor and toolbox).
// A cat at work sits at its own desk tapping away; a cat with nothing to do strolls about the lounge
// (sofa, coffee machine, plants) or naps there. A permission request pops up over the asking cat's
// head, with 허락 / 거절 right in the bubble (the same answer the chat's cards send).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp, useShownTeams, waitsForMe } from "../../store";
import type { Agent, ChatMsg, Project, Task, TeamSnapshot } from "../../lib/api";
import { plainAction } from "../../lib/plainAction";
import { liveCrew } from "../../lib/crew";
import { pickLine } from "./chatter";
import { Critter, CritterLayer, critterState, useReducedMotion, type PlacedCritter } from "../critters";

type Spot = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

const ROLE_WORD = { lead: "총괄", mgr: "팀장", worker: "작업자" } as const;

interface Member {
  key: string;
  project: Project;
  team: TeamSnapshot;
  agent: Agent;
  task?: Task;
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

/** most cats shown in the lounge; the rest are a "+N" */
const LOUNGE_MAX = 6;

function Desk({ m, onOpen }: { m: Member; onOpen: () => void }) {
  const role = m.agent.role;
  return (
    <button className={`of-desk of-desk-${role}`} onClick={onOpen} title={`${m.agent.name} · ${ROLE_WORD[role]} 작업 화면`} aria-label={`${m.agent.name} 책상 (${ROLE_WORD[role]})`}>
      <span className="of-chair" />
      <span className="of-seat" data-seat={m.key} />
      <span className="of-desk-top">
        {role === "lead" ? (
          <>
            <span className="of-monitor" />
            <span className="of-monitor of-monitor-2" />
            <span className="of-headset" />
          </>
        ) : role === "mgr" ? (
          <>
            <span className="of-monitor" />
            <span className="of-papers" />
          </>
        ) : (
          <>
            <span className="of-monitor" />
            <span className="of-toolbox" />
          </>
        )}
        <span className="of-keyboard" />
        <span className="of-mug" />
      </span>
      <span className="of-plate">{m.agent.name}</span>
    </button>
  );
}

function AskBubble({ m, msgs, at, width }: { m: Member; msgs: ChatMsg[]; at: Spot; width: number }) {
  const answer = useApp((s) => s.answerPermission);
  const first = msgs[0];
  const p = first.permission!;
  const half = Math.min(104, (width - 16) / 2);
  const left = Math.min(width - half - 8, Math.max(half + 8, at.x));
  return (
    <div className="of-ask" role="alertdialog" aria-label={`${m.agent.name} 허락 요청`} style={{ left, top: at.y, width: half * 2 }}>
      <span className="of-ask-text">
        <b>{m.agent.name}</b> · {plainAction(p.tool, p.detail)}
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
      <span className="of-ask-tail" style={{ left: `calc(50% + ${at.x - left}px)` }} />
    </div>
  );
}

/** `onTeam`: open a team's reports (a click on a resting team's chip) */
export function Office({ onTeam }: { onTeam?: (projectId: string) => void } = {}) {
  const shown = useShownTeams();
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
  // working; a team where nobody works is folded into one small line ("쉬는 팀")
  const { pods, resting } = useMemo(() => {
    const pods: { project: Project; desks: Member[]; waiting: Member[] }[] = [];
    const resting: { project: Project; lead?: Agent; waiting: number }[] = [];
    for (const { project, team } of shown) {
      const crew = liveCrew(team).map((a): Member => ({ key: `${project.id}:${a.id}`, project, team, agent: a, task: a.taskId ? team.tasks.find((t) => t.id === a.taskId) : undefined }));
      const busy = crew.some((m) => m.agent.status === "work" || m.agent.status === "block" || asks[m.key]?.length);
      if (!busy) {
        resting.push({ project, lead: crew.find((m) => m.agent.role === "lead")?.agent, waiting: crew.filter((m) => m.agent.role !== "lead").length });
        continue;
      }
      const seated = (m: Member) => atDesk(m.agent) || !!asks[m.key]?.length;
      pods.push({ project, desks: crew.filter(seated), waiting: crew.filter((m) => !seated(m)) });
    }
    return { pods, resting };
  }, [shown, asks]);
  const deskMembers = pods.flatMap((p) => p.desks);
  const waitingAll = pods.flatMap((p) => p.waiting);
  const lounging = waitingAll.slice(0, LOUNGE_MAX);
  const extra = waitingAll.length - lounging.length;
  const members = [...deskMembers, ...lounging];
  const shape = members.map((m) => m.key).join("|");

  // where the seats and the lounge are, measured from the laid-out room
  const [room, setRoom] = useState<{ seats: Record<string, Spot>; lounge: Box; w: number } | null>(null);
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
      const l = el.querySelector("[data-lounge]")?.getBoundingClientRect();
      const lounge = l ? { x: l.left - o.left + 24, y: l.top - o.top + size + 26, w: Math.max(10, l.width - 48), h: Math.max(10, l.height - size - 40) } : { x: 20, y: 60, w: 100, h: 60 };
      setRoom((prev) => {
        const next = { seats, lounge, w: el.clientWidth };
        return prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shape, size]);

  // lounging cats: a spot each, moved now and then
  const [strolls, setStrolls] = useState<Record<string, Spot>>({});
  const loungers = lounging.map((m) => m.key);
  const loungeKey = loungers.join("|");
  useEffect(() => {
    if (!room) return;
    const L = room.lounge;
    const pickFor = (keys: string[], cur: Record<string, Spot>) => {
      const next = { ...cur };
      for (const k of keys) {
        const others = Object.entries(next).filter(([o]) => o !== k && keys.includes(o)).map(([, p]) => p);
        let best: Spot | null = null;
        for (let t = 0; t < 12; t++) {
          const p = { x: L.x + Math.random() * L.w, y: L.y + Math.random() * L.h };
          if (others.every((o) => Math.hypot(o.x - p.x, o.y - p.y) > size * 1.3)) {
            best = p;
            break;
          }
          best ??= p;
        }
        next[k] = best!;
      }
      return next;
    };
    const keys = loungeKey ? loungeKey.split("|") : [];
    // newcomers (and everyone, when the lounge moved) get a spot right away
    setStrolls((cur) => {
      const kept = Object.fromEntries(Object.entries(cur).filter(([k, p]) => keys.includes(k) && p.x >= L.x - 1 && p.x <= L.x + L.w + 1 && p.y >= L.y - 1 && p.y <= L.y + L.h + 1));
      return pickFor(keys.filter((k) => !kept[k]), kept);
    });
    if (still || !keys.length) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      // one or two of them get up and stroll somewhere else
      const movers = keys.filter(() => Math.random() < 0.3);
      if (movers.length) setStrolls((cur) => pickFor(movers, cur));
    }, 2200);
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

  const items: PlacedCritter[] = [];
  for (const m of members) {
    const seat = room?.seats[m.key];
    const desk = deskMembers.includes(m);
    const spot = desk ? seat && { x: seat.x, y: seat.y } : strolls[m.key];
    if (!spot) continue;
    const st = critterState(m.agent, m.task);
    items.push({
      id: m.key,
      agent: m.agent,
      task: m.task,
      colorKey: m.agent.role === "lead" ? m.project.name : undefined,
      x: spot.x,
      y: spot.y,
      // a cat on a break naps now and then instead of hopping about
      state: desk ? (asks[m.key] ? "block" : st) : st === "done" ? "done" : "idle",
      say: asks[m.key]?.length ? "" : (chatter[m.key] ?? (m.agent.status === "block" ? "질문이 있어요" : "")),
    });
  }

  return (
    <div className="of-room" aria-label="사무실: 팀원들이 일하는 모습">
      <div ref={content} className="of-content">
        <div className="of-wall" aria-hidden="true">
          <span className="of-window" />
          <span className="of-window" />
          <span className="of-clock" />
          <span className="of-shelf" />
        </div>
        {resting.length > 0 && (
          <div className="of-resting" aria-label="쉬는 팀">
            <span className="of-resting-title">쉬는 팀</span>
            {resting.map(({ project, lead, waiting }) => (
              <button key={project.id} className="of-resting-team" onClick={() => onTeam?.(project.id)} title={`${project.name} 보고 보기`}>
                {lead && <Critter agent={lead} colorKey={project.name} state="off" size={narrow ? 24 : 28} />}
                <span className="of-resting-name">{project.name}</span>
                <span className="of-resting-sub">{waiting ? `대기 ${waiting}명` : "쉬는 중"}</span>
              </button>
            ))}
          </div>
        )}
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
            {!pods.length && <span className="of-empty">{resting.length ? "지금 일하는 팀원이 없어요. 총괄에게 일을 맡기면 여기 책상에 앉아요." : "출근한 팀이 없어요"}</span>}
          </div>
          <div className={`of-lounge${lounging.length ? "" : " of-lounge-quiet"}`} data-lounge aria-hidden="true">
            <span className="of-lounge-name">휴게실{waitingAll.length ? ` · ${waitingAll.length}명` : ""}</span>
            {extra > 0 && <span className="of-lounge-more">+{extra}</span>}
            <span className="of-rug" />
            <span className="of-sofa" />
            <span className="of-coffee" />
            <span className="of-plant" />
            <span className="of-plant of-plant-2" />
          </div>
        </div>
        <div className="of-cats">
          <CritterLayer id="office" items={items} size={size} speed={narrow ? 70 : 90} width={room?.w} />
        </div>
        {members.map((m) => {
          const msgs = asks[m.key];
          const seat = room?.seats[m.key];
          if (!msgs?.length || !seat || !room) return null;
          return <AskBubble key={`ask-${m.key}`} m={m} msgs={msgs} at={{ x: seat.x, y: seat.y - size - 4 }} width={room.w} />;
        })}
      </div>
    </div>
  );
}
