// While an AI is on a turn: what it's thinking, what it just did, how long it's been at it, and
// when it last moved — so "slow" and "stuck" look different.
import { useEffect, useState } from "react";
import type { Agent } from "../lib/api";
import { useApp } from "../store";
import { Critter } from "./critters";

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const secs = (ms: number) => Math.max(0, Math.round(ms / 1000));
const span = (s: number) => (s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`);

/** How long a member waits silently before we flag it (models do think quietly for a while). */
const QUIET = 60;

export function LiveWork({ agent, label }: { agent: Agent; label?: string }) {
  const now = useNow();
  const critters = useApp((s) => s.critters);
  // a 총괄's color follows its team (same as on the board)
  const team = useApp((s) => label ?? s.projects.find((p) => p.id === s.projectId)?.name);
  const since = secs(now - agent.statusSince);
  const last = Math.max(agent.lastActive ?? 0, agent.statusSince, ...agent.activity.map((a) => a.at));
  const idle = secs(now - last);
  const quiet = idle >= QUIET;
  const recent = agent.activity.filter((a) => a.at >= agent.statusSince).slice(-2);
  return (
    <div role="status" aria-live="polite" className="flex max-w-[94%] flex-col gap-1.5 self-start rounded-xl px-3 py-2.5 text-[12px]" style={{ background: "var(--glass2)", border: `1px solid ${quiet ? "var(--amber)" : "var(--line)"}` }}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {critters ? (
          <Critter agent={agent} colorKey={agent.role === "lead" ? team : undefined} state={quiet || !recent.length ? "think" : now - recent[recent.length - 1].at < 12_000 ? "work" : "think"} size={30} className="-my-1.5 -ml-1" />
        ) : (
          <span className="flex gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="s-work size-1.5 rounded-full" style={{ background: "var(--text2)", animationDelay: `${i * 0.2}s` }} />
            ))}
          </span>
        )}
        <span className="font-medium">{label ? `${label} ` : ""}생각하는 중 · {span(since)}째</span>
        <span className="ml-auto" style={{ color: quiet ? "var(--amber)" : "var(--text2)" }}>
          {quiet ? `${span(idle)}째 움직임 없음` : idle <= 1 ? "방금 움직임" : `마지막 움직임 ${span(idle)} 전`}
        </span>
      </span>
      {agent.thought && <span className="line-clamp-2 leading-snug text-ink-2 italic select-text">💭 {agent.thought}</span>}
      {recent.map((a, i) => (
        <span key={`${a.at}-${i}`} className="truncate font-mono text-[11.5px] text-ink-2">
          › {a.text}
        </span>
      ))}
      {quiet && <span className="leading-snug text-ink-2">오래 걸리는 생각일 수 있어요. 계속 멈춰 있으면 작업 화면에서 다시 시작할 수 있어요.</span>}
    </div>
  );
}
