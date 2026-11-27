// View helpers: map backend state (src/lib/api.ts) onto the design's visual vocabulary.
import { modelLabel } from "./models";
import type { Agent, AgentStatus, Bucket, Role, Task } from "../lib/api";

export type { Role } from "../lib/api";
export type Column = "대기" | "배정" | "진행중" | "적용 대기" | "완료";
export const COLUMNS: Column[] = ["대기", "배정", "진행중", "적용 대기", "완료"];

export const STATUS: Record<AgentStatus, { label: string; cls: string; color: string; ink: string }> = {
  work: { label: "진행 중", cls: "s-work", color: "var(--work)", ink: "var(--work-ink)" },
  wait: { label: "대기", cls: "", color: "var(--wait)", ink: "var(--wait-ink)" },
  block: { label: "막힘", cls: "s-block", color: "var(--block)", ink: "var(--block-ink)" },
  done: { label: "완료 ✓", cls: "", color: "var(--done)", ink: "var(--text2)" },
  off: { label: "종료", cls: "", color: "var(--done)", ink: "var(--text2)" },
};

export const ROLE_NAME: Record<Role, string> = { lead: "총괄", mgr: "팀장", worker: "작업자" };
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

/** All the tokens in a bucket (cache reads and writes included, as the CLIs count them). */
export const bucketTotal = (b: Bucket) => b.input + b.output + b.cacheRead + b.cacheWrite;

/** A token count in everyday words: "약 12만 토큰", "약 3,500 토큰". */
export function tokensText(n: number): string {
  if (n < 1000) return `${n} 토큰`;
  if (n < 10_000) return `약 ${(Math.round(n / 100) * 100).toLocaleString("ko-KR")} 토큰`;
  if (n < 100_000_000) {
    const man = n / 10_000;
    return `약 ${man < 10 ? man.toFixed(1) : Math.round(man)}만 토큰`;
  }
  return `약 ${(n / 100_000_000).toFixed(1)}억 토큰`;
}

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
      return { task: t, column: "적용 대기", status: "wait", side: agent ? `${agent.name} 보고` : "적용 대기", agent };
    case "failed":
      return { task: t, column: "적용 대기", status: "block", side: "실패", agent };
    default:
      return { task: t, column: "완료", status: "done", side: agent ? usd(agent.costUsd) : "", agent };
  }
}

