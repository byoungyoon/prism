import { useEffect, useState } from "react";
import { useApp, useCurrent } from "../store";
import type { Agent, Role, TeamSnapshot } from "../lib/api";
import { ROLE_NAME, STATUS, elapsed, layers, rings } from "../data/types";
import { Bot, Briefcase, Tower } from "./icons";
import { modelLabel } from "../data/models";

const BASE: Record<Role, number> = { lead: 104, mgr: 84, worker: 70 };

function grid(role: Role, n: number) {
  const cols = role === "lead" ? 1 : Math.min(4, Math.max(2, Math.ceil(Math.sqrt(n))));
  // shrink tiles a little when a plane gets crowded
  const size = cols > 3 ? Math.round(BASE[role] * 0.8) : BASE[role];
  return { cols, size };
}

function NodeTile({ a, size, ring, selected }: { a: Agent; size: number; ring?: string; selected: boolean }) {
  const { selectNode, go } = useApp();
  const s = STATUS[a.status];
  const Icon = a.role === "lead" ? Tower : a.role === "mgr" ? Briefcase : Bot;
  return (
    <button
      onMouseEnter={() => selectNode(a.id)}
      onFocus={() => selectNode(a.id)}
      onClick={() => go({ name: "agent", id: a.id })}
      aria-label={`${a.name}, ${modelLabel(a.model)}, ${s.label} — 상세 보기`}
      className="relative flex flex-col items-center justify-center gap-[3px] rounded-xl transition-opacity"
      style={{
        width: size,
        height: size,
        background: "var(--tile)",
        border: `1px solid ${selected ? "var(--navy)" : "var(--glass-border)"}`,
        boxShadow: "0 6px 14px rgba(120,90,50,0.12)",
        color: "var(--text)",
        opacity: a.status === "done" ? 0.6 : 1,
      }}
    >
      {ring && <span className={ring} aria-hidden="true" />}
      <Icon size={a.role === "lead" ? 22 : a.role === "mgr" ? 20 : 18} />
      <span className="text-[11.5px] font-semibold">{a.name}</span>
      <span className="flex items-center gap-1 font-mono text-[10px] text-ink-2">
        <span className={`${s.cls} size-1.5 rounded-full`} style={{ background: s.color }} />
        {modelLabel(a.model)}
      </span>
    </button>
  );
}

function HoverCard({ a, team }: { a: Agent; team: TeamSnapshot }) {
  const s = STATUS[a.status];
  const task = team.tasks.find((t) => t.id === a.taskId);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div aria-live="polite" className="glass absolute bottom-3 left-3 flex w-[300px] max-w-[calc(100%-24px)] flex-col gap-1.5 rounded-xl px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className={`${s.cls} size-2 rounded-full`} style={{ background: s.color }} />
        <span className="font-semibold">{a.name}</span>
        <span className="text-xs text-ink-2">{ROLE_NAME[a.role]}</span>
        <span className="flex-auto" />
        <span className="rounded-full px-2 py-0.5 font-mono text-[11px]" style={{ background: "var(--chip)" }}>
          {modelLabel(a.model)}
          {a.effort ? ` · 생각 ${a.effort}` : ""}
        </span>
      </div>
      <span className="line-clamp-2 text-[13px] leading-normal">
        {task ? (
          <>
            <span className="font-mono font-medium">{task.id}</span> {task.title}
          </>
        ) : a.role === "lead" ? (
          "내 지시를 받아 작업 카드로 나눠요"
        ) : (
          a.lastNote ?? "-"
        )}
      </span>
      <span className="text-xs" style={{ color: s.ink }}>
        {s.label} · {elapsed(a.statusSince)}
      </span>
    </div>
  );
}

const LEGEND = [
  { label: "진행", color: "var(--work)" },
  { label: "대기", color: "var(--wait)" },
  { label: "막힘", color: "var(--block)" },
  { label: "완료", color: "var(--done)" },
  { label: "추가 투입", color: "var(--amber)", glow: true },
  { label: "보고", color: "var(--navy)", glow: true },
];

export function LayerStack() {
  const { selectedNode, go } = useApp();
  const { team } = useCurrent();
  const [explode, setExplode] = useState(false);
  const [hl, setHl] = useState<Role | null>(null);
  const gap = explode ? 140 : 84;
  const planes = layers(team);
  const ringOf = rings(team);
  const hovered = team?.agents.find((a) => a.id === selectedNode) ?? team?.agents.find((a) => a.role === "lead");
  const delegating = !!team?.tasks.some((t) => t.stage === "running");
  const reporting = !!team?.tasks.some((t) => t.stage === "review");

  return (
    <section aria-label="레이어 스택" className="relative min-h-[560px] min-w-0 flex-auto rounded-2xl">
      <div className="absolute top-3 left-4 flex flex-col gap-0.5">
        <span className="text-base font-semibold">레이어 스택</span>
        <span className="text-xs text-ink-2">마우스를 올리면 층이 벌어지고, 층 이름을 누르면 집중 뷰로 가요</span>
      </div>

      <div
        onMouseEnter={() => setExplode(true)}
        onMouseLeave={() => {
          setExplode(false);
          setHl(null);
        }}
        className="absolute inset-[56px_0_96px] flex items-center justify-center"
        style={{ perspective: 2400 }}
      >
        <div
          className={`tz ${explode ? "gap-o" : "gap-c"} relative size-[340px]`}
          style={{
            transformStyle: "preserve-3d",
            transform: `rotateX(55deg) rotateZ(-45deg) translateZ(${-gap * ((planes.length - 1) / 2)}px)`,
          }}
        >
          {planes.map((layer, idx) => {
            const on = hl === layer.role;
            const { cols, size } = grid(layer.role, layer.agents.length);
            return (
              <div
                key={layer.role}
                className="tz absolute inset-0 rounded-[18px]"
                onMouseEnter={() => setHl(layer.role)}
                style={{
                  transformStyle: "preserve-3d",
                  transform: `translateZ(${idx * gap + (on ? 18 : 0)}px)`,
                  transitionDelay: `${idx * 40}ms`,
                  background: on ? "var(--plane-hi)" : "var(--plane)",
                  border: "1px solid var(--plane-border)",
                  boxShadow: "var(--plane-shadow), inset 0 1px 0 var(--plane-border)",
                }}
              >
                <button
                  onClick={() => go({ name: "focus", layer: layer.role })}
                  className="glass-soft absolute top-3.5 left-4 flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-2 text-xs font-semibold"
                >
                  {layer.name}
                  <span className="font-normal text-ink-2">{layer.agents.length}</span>
                </button>
                <div
                  className="absolute inset-[52px_20px_20px] grid place-items-center content-center gap-3.5"
                  style={{ gridTemplateColumns: `repeat(${cols}, ${size}px)` }}
                >
                  {layer.agents.map((a) => (
                    <NodeTile key={a.id} a={a} size={size} ring={ringOf[a.id]} selected={a.id === hovered?.id} />
                  ))}
                </div>
                {layer.floats.map((f) => (
                  <span
                    key={f.id}
                    className="glass-soft absolute rounded-[7px] px-2 py-1 font-mono text-[10.5px] font-medium"
                    style={{ left: f.x, top: f.y, transform: "translateZ(18px)", boxShadow: "0 8px 14px rgba(120,90,50,0.14)" }}
                  >
                    {f.id}
                  </span>
                ))}
              </div>
            );
          })}
          {planes.length === 3 && delegating && (
            <>
              <span className="pk pk-down" aria-hidden="true" />
              <span className="pk pk-down2" aria-hidden="true" />
            </>
          )}
          {planes.length === 3 && reporting && <span className="pk pk-up" aria-hidden="true" />}
        </div>
      </div>

      {team && hovered && <HoverCard a={hovered} team={team} />}

      <div className="absolute right-3 bottom-4 flex flex-wrap justify-end gap-3 text-xs text-ink-2">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-[5px]">
            <span className="size-[7px] rounded-full" style={{ background: l.color, boxShadow: l.glow ? `0 0 8px ${l.color}` : undefined }} />
            {l.label}
          </span>
        ))}
      </div>
    </section>
  );
}
