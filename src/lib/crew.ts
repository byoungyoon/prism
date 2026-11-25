// Who is on a team right now — one rule for the board, the team tabs and the office.
// The team's member list keeps finished sessions for a while (each card gets a fresh member, often
// under a recycled name like "W1"); the backend trims it (prune_finished), and here we pick the live ones.
import type { Agent, Task, TeamSnapshot } from "./api";

const ROLE_ORDER = { lead: 0, mgr: 1, worker: 2 } as const;
const RANK: Record<Agent["status"], number> = { block: 0, work: 1, wait: 2, done: 3, off: 4 };

/** A 팀장·작업자 whose card is finished and who is no longer busy: done, even if its session lingers. */
const cardFinished = (a: Agent, tasks: Task[]) => {
  const t = a.taskId ? tasks.find((x) => x.id === a.taskId) : undefined;
  return !!t && (t.stage === "done" || t.stage === "failed");
};

/**
 * The live members: on the clock, not finished, one per shown name (the busiest, then the newest),
 * 총괄 first. `withLead`: keep the 총괄 even when it's off (the board shows it as 퇴근).
 */
export function liveCrew(team: TeamSnapshot, { withLead = false }: { withLead?: boolean } = {}): Agent[] {
  const by = new Map<string, Agent>();
  for (const a of team.agents) {
    if (a.role === "lead") {
      if (a.status === "off" && !withLead) continue;
    } else {
      if (a.status === "off" || a.status === "done") continue;
      if (a.status === "wait" && cardFinished(a, team.tasks)) continue;
    }
    const k = `${a.role}:${a.name}`;
    const cur = by.get(k);
    if (!cur || RANK[a.status] < RANK[cur.status] || (RANK[a.status] === RANK[cur.status] && a.statusSince > cur.statusSince)) by.set(k, a);
  }
  return [...by.values()].sort((x, y) => ROLE_ORDER[x.role] - ROLE_ORDER[y.role] || x.name.localeCompare(y.name, "ko"));
}

/** Finished 팀장·작업자 still on record (newest first), not counting a name that is live again. */
export function finishedCrew(team: TeamSnapshot): Agent[] {
  const live = new Set(liveCrew(team).map((a) => `${a.role}:${a.name}`));
  const seen = new Set<string>();
  return team.agents
    .filter((a) => a.role !== "lead" && (a.status === "done" || (a.status === "wait" && cardFinished(a, team.tasks))))
    .sort((x, y) => y.statusSince - x.statusSince)
    .filter((a) => {
      const k = `${a.role}:${a.name}`;
      if (live.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Members working right now (or stuck asking). */
export const busyCrew = (team: TeamSnapshot) => liveCrew(team).filter((a) => a.status === "work" || a.status === "block");

/** The name on a card: its member's, or the one the card kept after the member was cleared. */
export const whoDid = (team: TeamSnapshot, task: Task) => team.agents.find((a) => a.id === task.assignee)?.name ?? task.who ?? null;
