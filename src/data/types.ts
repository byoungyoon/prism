// View helpers: map backend state (src/lib/api.ts) onto the design's visual vocabulary.
import { modelLabel } from "./models";
import type { Agent, AgentStatus, Role, Task, TeamSnapshot } from "../lib/api";

export type { Role } from "../lib/api";
export type Column = "대기" | "배정" | "진행중" | "검토" | "완료";
export const COLUMNS: Column[] = ["대기", "배정", "진행중", "검토", "완료"];

export const STATUS: Record<AgentStatus, { label: string; cls: string; color: string; ink: string }> = {
  work: { label: "진행 중", cls: "s-work", color: "var(--work)", ink: "var(--work-ink)" },
  wait: { label: "대기", cls: "", color: "var(--wait)", ink: "var(--wait-ink)" },
  block: { label: "막힘", cls: "s-block", color: "var(--block)", ink: "var(--block-ink)" },
  done: { label: "완료 ✓", cls: "", color: "var(--done)", ink: "var(--text2)" },
  off: { label: "종료", cls: "", color: "var(--done)", ink: "var(--text2)" },
};

export const ROLE_NAME: Record<Role, string> = { lead: "총괄", mgr: "팀장", worker: "작업자" };
export const LAYER_NAME: Record<Role, string> = { lead: "총괄", mgr: "팀장 층", worker: "작업자 층" };
export { ALL_MODEL_IDS as MODELS } from "./models";

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

export function elapsed(since: number, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - since) / 60000));
  if (m < 1) return "방금";
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

export const usd = (n: number) => `$${n.toFixed(2)}`;

export interface CardView {
  task: Task;
  column: Column;
  status: AgentStatus;
  side: string;
  agent?: Agent;
}

export function cardView(t: Task, agents: Agent[]): CardView {
  const agent = agents.find((a) => a.id === t.assignee);
  switch (t.stage) {
    case "queued":
      return { task: t, column: "대기", status: "wait", side: "대기 중" };
    case "running": {
      const st = agent?.status ?? "work";
      const column: Column = st === "wait" ? "배정" : "진행중";
      const side = st === "block" ? `${agent?.name} 막힘` : `${agent?.name ?? "-"} ${agent ? modelLabel(agent.model) : ""}`;
      return { task: t, column, status: st === "done" || st === "off" ? "wait" : st, side, agent };
    }
    case "review":
      return { task: t, column: "검토", status: "wait", side: agent ? `${agent.name} 보고` : "검토", agent };
    case "failed":
      return { task: t, column: "검토", status: "block", side: "실패", agent };
    default:
      return { task: t, column: "완료", status: "done", side: agent ? usd(agent.costUsd) : "", agent };
  }
}

export interface LayerView {
  role: Role;
  name: string;
  agents: Agent[];
  /** queued cards floating above the plane */
  floats: { id: string; x: number; y: number }[];
}

const FLOAT_SLOTS = [
  { x: 268, y: 26 },
  { x: 286, y: 66 },
  { x: 262, y: 278 },
];

/** Bottom → top. Empty manager/worker layers are left out. */
export function layers(team: TeamSnapshot | undefined): LayerView[] {
  if (!team) return [];
  const visible = team.agents.filter((a) => a.status !== "off" || a.role === "lead");
  const queuedBy = (role: Role) =>
    team.tasks
      .filter((t) => t.stage === "queued" && team.agents.find((a) => a.id === t.requestedBy)?.role === role)
      .slice(0, 3)
      .map((t, i) => ({ id: t.id, ...FLOAT_SLOTS[i] }));
  const out: LayerView[] = [];
  for (const role of ["worker", "mgr", "lead"] as Role[]) {
    const agents = visible.filter((a) => a.role === role);
    if (agents.length || role === "lead") out.push({ role, name: LAYER_NAME[role], agents, floats: queuedBy(role) });
  }
  return out;
}

/** Escalation ring classes along each open escalation's path (asker → … → lead). */
export function rings(team: TeamSnapshot | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of team?.chat ?? []) {
    if (m.escalation && !m.escalation.answer) {
      m.escalation.path.forEach((id, i) => {
        out[id] ??= ["ring", "ring d1", "ring d2"][Math.min(i, 2)];
      });
    }
  }
  return out;
}
