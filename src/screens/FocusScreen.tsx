import { motion, useReducedMotion } from "motion/react";
import { useApp, useCurrent } from "../store";
import { LAYER_NAME, STATUS, elapsed, rings, usd, type Role } from "../data/types";
import { modelLabel } from "../data/models";
import type { Agent, TeamSnapshot } from "../lib/api";
import { TerminalView } from "../components/TerminalView";
import { TranscriptPeek } from "../components/Transcript";
import { Bot, ChevronLeft } from "../components/icons";

const LAYER_ORDER: Role[] = ["lead", "mgr", "worker"];

function Card({
  a,
  team,
  ring,
  blocked,
}: {
  a: Agent;
  team: TeamSnapshot;
  ring: string | undefined;
  blocked: boolean;
}) {
  const { go, selectNode } = useApp();
  const s = STATUS[a.status];
  const task = team.tasks.find((t) => t.id === a.taskId);
  const parent = team.agents.find((p) => p.id === a.parentId);
  const dim = a.status === "off";
  return (
    <article
      onMouseEnter={() => selectNode(a.id)}
      className="relative flex min-w-0 flex-col overflow-hidden rounded-xl"
      style={{
        background: "var(--tile)",
        border: `1.5px solid ${blocked ? "var(--block)" : "var(--glass-border)"}`,
        boxShadow: "0 10px 24px rgba(120,90,50,0.12)",
        opacity: dim ? 0.6 : 1,
      }}
    >
      {ring ? <span className={ring} aria-hidden="true" /> : null}
      <div className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-2.5">
        <span
          className="flex size-9 items-center justify-center rounded-[10px]"
          style={{ background: "var(--tile)", border: "1px solid var(--glass-border)" }}
        >
          <Bot size={18} />
        </span>
        <div className="flex min-w-0 flex-auto flex-col">
          <h2 className="m-0 truncate text-[15px] font-semibold">{a.name}</h2>
          <span className="text-xs text-ink-2">{parent ? `${parent.name} 소속` : "최상위"}</span>
        </div>
        <span className="rounded-full px-[9px] py-[3px] font-mono text-[11.5px]" style={{ background: "var(--chip)" }}>
          {modelLabel(a.model)}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 px-3.5 pb-3">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: s.ink }}>
          <span className={`${s.cls} size-2 rounded-full`} style={{ background: s.color }} />
          {s.label} · {elapsed(a.statusSince)}
        </span>
        {task ? (
          <span className="text-[13.5px] leading-[1.45]">
            <span className="font-mono font-medium">{task.id}</span> {task.title || task.goal}
          </span>
        ) : (
          <span className="text-[13.5px] text-ink-2">배정된 작업 없음</span>
        )}
      </div>

      <div
        className="mx-2.5 min-h-[132px] flex-auto overflow-hidden rounded-[10px] p-2"
        style={{ background: "var(--term-bg)" }}
      >
        {a.structured ? (
          <div className="h-full" style={{ color: "#e9e1d5" }}>
            <TranscriptPeek projectId={team?.projectId ?? null} agentId={a.id} dark />
          </div>
        ) : a.ptyId != null ? (
          <TerminalView ptyId={a.ptyId} preview className="h-full min-h-[116px] w-full" />
        ) : (
          <div className="flex h-full min-h-[116px] items-center justify-center font-mono text-[11.5px] text-[#a89c8e]">
            작업 종료
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-3">
        <span className="min-w-0 flex-auto truncate text-xs text-ink-2">
          {a.lastNote ?? usd(a.costUsd)}
          {a.lastNote ? ` · ${usd(a.costUsd)}` : ""}
        </span>
        <button
          onClick={() => go({ name: "agent", id: a.id })}
          aria-label={`${a.name} ${blocked ? "도와주기" : "열기"}`}
          className="flex min-h-8 items-center rounded-full px-3 text-[12.5px] font-medium"
          style={{
            background: blocked ? "var(--amber)" : "var(--chip)",
            border: `1px solid ${blocked ? "var(--amber)" : "var(--line)"}`,
          }}
        >
          {blocked ? "도와주기" : "열기"}
        </button>
      </div>
    </article>
  );
}

export function FocusScreen({ layer }: { layer: "lead" | "mgr" | "worker" }) {
  const { team } = useCurrent();
  const go = useApp((s) => s.go);
  const reduce = useReducedMotion();

  const agents = (team?.agents ?? []).filter((a) => a.role === layer);
  const ringMap = rings(team);
  const open = (team?.chat ?? []).filter((m) => m.escalation && !m.escalation.answer);
  const count = (st: string) => agents.filter((a) => a.status === st).length;
  const layersWithAgents = LAYER_ORDER;

  const enter = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
    : {
        initial: { opacity: 0, rotateX: 55, rotateZ: -45, scale: 1.85 },
        animate: { opacity: 1, rotateX: 0, rotateZ: 0, scale: 1 },
        transition: { type: "spring" as const, stiffness: 260, damping: 28 },
      };

  return (
    <div className="flex min-h-0 flex-auto flex-col" style={{ perspective: 1800 }}>
      <motion.div
        {...enter}
        className="flex min-h-0 flex-auto flex-col"
        style={{ transformStyle: "preserve-3d", transformOrigin: "50% 50%" }}
      >
        <header className="flex flex-wrap items-center gap-3 px-3 py-1.5" style={{ borderBottom: "1px solid var(--line)" }}>
          <nav aria-label="현재 위치" className="flex items-center gap-2 text-sm">
            <button
              onClick={() => go({ name: "main" })}
              aria-label="스택으로 돌아가기"
              className="flex min-h-[34px] items-center gap-1.5 rounded-[9px] pr-2.5 pl-1.5 text-ink-2"
            >
              <ChevronLeft size={16} />
              스택
            </button>
            <span aria-hidden="true" className="text-ink-2">
              ›
            </span>
            <span aria-current="page" className="font-semibold">
              {LAYER_NAME[layer]}
            </span>
          </nav>
          <span className="text-[12.5px] text-ink-2">
            AI {agents.length}명 · 진행 {count("work")} · 대기 {count("wait")} · 막힘 {count("block")}
            {open.length ? ` · 도움 요청 ${open.length}` : ""}
          </span>
          <div className="flex-auto" />
          <div role="group" aria-label="다른 층" className="glass flex gap-0.5 rounded-full p-[3px]">
            {layersWithAgents.map((r) => {
              const on = r === layer;
              return (
                <button
                  key={r}
                  onClick={() => go({ name: "focus", layer: r })}
                  aria-current={on ? "true" : undefined}
                  className="flex min-h-[30px] items-center rounded-full px-3 text-[13px]"
                  style={{ background: on ? "var(--amber)" : "transparent", fontWeight: on ? 500 : 400 }}
                >
                  {LAYER_NAME[r]}
                </button>
              );
            })}
          </div>
        </header>

        <main className="min-h-0 flex-auto overflow-auto p-3">
          {agents.length === 0 ? (
            <div className="glass flex min-h-[240px] flex-col items-center justify-center gap-1 rounded-[20px] p-5 text-center">
              <span className="text-[15px] font-semibold">이 층에는 아직 AI가 없어요</span>
              <span className="text-[13px] text-ink-2">작업이 배정되면 여기에 나타나요</span>
            </div>
          ) : (
            <div
              className="glass grid gap-4 rounded-[20px] p-5"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", background: "var(--glass2)" }}
            >
              {agents.map((a) => (
                <Card
                  key={a.id}
                  a={a}
                  team={team as TeamSnapshot}
                  ring={ringMap[a.id]}
                  blocked={a.status === "block" || !!ringMap[a.id]}
                />
              ))}
            </div>
          )}
        </main>
      </motion.div>
    </div>
  );
}
