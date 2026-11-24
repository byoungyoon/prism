// 작업장 띠: a thin strip along the bottom of the screen where every teammate on the clock lives.
// Busy ones wander back and forth between jobs; one of them at a time says what it's doing.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isLive, useApp } from "../../store";
import type { Agent, Task } from "../../lib/api";
import { CritterLayer, useReducedMotion, type PlacedCritter } from "./CritterLayer";
import { critterLine, critterState } from "./state";
import { useCritterStore } from "./critterStore";

const ROLE_ORDER = { lead: 0, mgr: 1, worker: 2 } as const;

/** the strip spans the window */
function useWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

export function WorkshopStrip() {
  const on = useApp((s) => s.critters);
  const projects = useApp((s) => s.projects);
  const teams = useApp((s) => s.teams);
  const still = useReducedMotion();
  const width = useWidth();
  const narrow = width > 0 && width < 700;

  const crew = useMemo(() => {
    const list: { agent: Agent; task?: Task; key: string; team: string }[] = [];
    for (const p of projects) {
      const t = teams[p.id];
      if (!isLive(t)) continue;
      // on the clock and not finished yet (finished 팀장·작업자 go home)
      for (const a of t.agents)
        if (a.status !== "off" && (a.status !== "done" || a.role === "lead"))
          list.push({ agent: a, task: a.taskId ? t.tasks.find((x) => x.id === a.taskId) : undefined, key: `${p.id}:${a.id}`, team: p.name });
    }
    return list.sort((x, y) => ROLE_ORDER[x.agent.role] - ROLE_ORDER[y.agent.role] || x.agent.name.localeCompare(y.agent.name, "ko"));
  }, [projects, teams]);
  // an editing screen has the critters: the strip steps aside meanwhile
  const onStage = useCritterStore((s) => s.stages > 0);
  const shown = on && crew.length > 0 && !onStage;
  const cap = narrow ? 8 : 16;
  // when there are too many, the ones at work get a spot first
  const crewShown = useMemo(() => {
    if (crew.length <= cap) return crew;
    const busy = (c: (typeof crew)[number]) => (critterState(c.agent, c.task) === "idle" ? 1 : 0);
    const keep = new Set([...crew].sort((x, y) => busy(x) - busy(y)).slice(0, cap));
    return crew.filter((c) => keep.has(c));
  }, [crew, cap]);

  useEffect(() => {
    document.documentElement.classList.toggle("cr-strip-on", shown);
    return () => document.documentElement.classList.remove("cr-strip-on");
  }, [shown]);

  // home spots: spread evenly; busy ones get sent somewhere else every so often
  const [spots, setSpots] = useState<Record<string, number>>({});
  const [speaker, setSpeaker] = useState(0);
  const keys = crewShown.map((c) => c.key).join("|");
  const margin = 26;
  const slot = (i: number, n: number) => margin + ((width - margin * 2) * (i + 0.5)) / Math.max(1, n);
  useEffect(() => {
    if (!width) return;
    setSpots((s) => Object.fromEntries(crewShown.map((c, i) => [c.key, s[c.key] != null && s[c.key] < width - margin ? s[c.key] : slot(i, crewShown.length)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, width]);

  const busyRef = useRef<string[]>([]);
  busyRef.current = crewShown.filter((c) => ["work", "think"].includes(critterState(c.agent, c.task))).map((c) => c.key);
  useEffect(() => {
    if (!shown || still || !width) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      const busy = busyRef.current;
      if (busy.length) {
        const k = busy[Math.floor(Math.random() * busy.length)];
        setSpots((s) => {
          const from = s[k] ?? width / 2;
          // a short trip to the next "desk": 60–220px away, kept inside the strip
          const hop = (60 + Math.random() * 160) * (Math.random() < 0.5 ? -1 : 1);
          let to = from + hop;
          if (to < margin || to > width - margin) to = from - hop;
          return { ...s, [k]: Math.min(width - margin, Math.max(margin, to)) };
        });
      }
      setSpeaker((n) => n + 1);
    }, 2600);
    return () => clearInterval(t);
  }, [shown, still, width]);

  if (!shown) return null;
  const floor = (narrow ? 52 : 58) - 6;
  const talkers = crewShown.filter((c) => critterLine(c.agent, c.task) && critterState(c.agent, c.task) !== "idle");
  // on a phone one bubble at a time (rotating); on a wide screen two, picked far apart so they don't overlap
  const many = Math.min(narrow ? 1 : 2, talkers.length);
  const turn = Math.floor(speaker / 2);
  const talking = new Set(Array.from({ length: many }, (_, i) => talkers[(turn + Math.floor((i * talkers.length) / many)) % talkers.length].key));
  const items: PlacedCritter[] = crewShown.map((c, i) => {
    const st = critterState(c.agent, c.task);
    const line = critterLine(c.agent, c.task);
    return {
      id: c.key,
      agent: c.agent,
      task: c.task,
      colorKey: c.agent.role === "lead" ? c.team : undefined,
      x: spots[c.key] ?? slot(i, crewShown.length),
      y: floor,
      say: st === "block" || talking.has(c.key) ? `${c.agent.role === "lead" ? c.team : c.agent.name} · ${line || "확인이 필요해요"}` : "",
    };
  });

  return createPortal(
    <div className="cr-strip" role="region" aria-label="작업장: 팀원들이 일하는 모습">
      <div className="cr-strip-floor" />
      {width > 0 && <CritterLayer id="workshop" items={items} size={narrow ? 28 : 32} speed={narrow ? 50 : 64} />}
      {crew.length > cap && (
        <span className="absolute top-1 left-2.5 text-[10.5px] text-ink-2">+{crew.length - cap}명</span>
      )}
    </div>,
    document.body,
  );
}
