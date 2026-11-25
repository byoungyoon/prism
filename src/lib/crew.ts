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

/** Of two members with the same name: the busier one, then the one on an open card, then the newest. */
const better = (a: Agent, b: Agent, tasks: Task[]) => {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] < RANK[b.status];
  const ao = !cardFinished(a, tasks);
  const bo = !cardFinished(b, tasks);
  if (ao !== bo) return ao;
  return a.statusSince > b.statusSince;
};

/**
 * The card a member is on now — none when the one it last held is already done or failed (it may be
 * answering a message after that, or be a stale session the backend is about to settle).
 */
export function currentCard(team: TeamSnapshot, a: Agent): Task | undefined {
  const t = a.taskId ? team.tasks.find((x) => x.id === a.taskId) : undefined;
  if (!t) return undefined;
  if ((t.stage === "done" || t.stage === "failed") && a.status !== "done") return undefined;
  return t;
}

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
      // idle on a finished card — unless it's resting in the lounge on purpose, waiting for the next card
      if (a.status === "wait" && !a.restSince && cardFinished(a, team.tasks)) continue;
    }
    const k = `${a.role}:${a.name}`;
    const cur = by.get(k);
    if (!cur || better(a, cur, team.tasks)) by.set(k, a);
  }
  return [...by.values()].sort((x, y) => ROLE_ORDER[x.role] - ROLE_ORDER[y.role] || x.name.localeCompare(y.name, "ko"));
}

/** Finished 팀장·작업자 still on record (newest first), not counting a name that is live again. */
export function finishedCrew(team: TeamSnapshot): Agent[] {
  const live = new Set(liveCrew(team).map((a) => `${a.role}:${a.name}`));
  const seen = new Set<string>();
  return team.agents
    .filter((a) => a.role !== "lead" && !a.restSince && (a.status === "done" || (a.status === "wait" && cardFinished(a, team.tasks))))
    .sort((x, y) => y.statusSince - x.statusSince)
    .filter((a) => {
      const k = `${a.role}:${a.name}`;
      if (live.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * 팀장·작업자 who reported and wait for the 총괄 to check their card (it is in review): their
 * session is done, so they aren't live, but they aren't finished either — the office shows them in
 * the lounge as "보고함". Not counting a name that is live again.
 */
export function reportedCrew(team: TeamSnapshot): Agent[] {
  const live = new Set(liveCrew(team).map((a) => `${a.role}:${a.name}`));
  const seen = new Set<string>();
  return team.agents
    .filter((a) => a.role !== "lead" && !a.restSince && (a.status === "done" || a.status === "off") && team.tasks.some((t) => t.id === a.taskId && t.stage === "review"))
    .sort((x, y) => y.statusSince - x.statusSince)
    .filter((a) => {
      const k = `${a.role}:${a.name}`;
      if (live.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * 작업자 resting in the lounge while nobody on the team is in (the 총괄 left: the team clocked out,
 * the app restarted): their status is `off` until the team clocks in again (`back_to_lounge`), but
 * they are still in the lounge — not finished. Not counting a name that is live again.
 */
export function restingOffCrew(team: TeamSnapshot): Agent[] {
  const live = new Set(liveCrew(team).map((a) => `${a.role}:${a.name}`));
  const seen = new Set<string>();
  return team.agents
    .filter((a) => a.role !== "lead" && !!a.restSince && a.status === "off")
    .sort((x, y) => y.statusSince - x.statusSince)
    .filter((a) => {
      const k = `${a.role}:${a.name}`;
      if (live.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * Everyone the office shows in the lounge without being live: 작업자 who reported (their card is in
 * review) and resting 작업자 while the team is off. Kept whether or not the 총괄 is in.
 */
export const loungeOnlyCrew = (team: TeamSnapshot): { agent: Agent; reported: boolean }[] => [
  ...restingOffCrew(team).map((agent) => ({ agent, reported: false })),
  ...reportedCrew(team).map((agent) => ({ agent, reported: true })),
];

/**
 * Does the office show this team? Someone on it is in — or, with nobody in (the 총괄 left, the team
 * clocked out), cats still in its lounge: they don't vanish with the 총괄.
 */
export const inOffice = (team: TeamSnapshot | undefined): boolean =>
  !!team && (team.agents.some((a) => a.status !== "off" && a.status !== "done") || loungeOnlyCrew(team).length > 0);

/** Members working right now (or stuck asking). */
export const busyCrew = (team: TeamSnapshot) => liveCrew(team).filter((a) => a.status === "work" || a.status === "block");

/** The name on a card: its member's, or the one the card kept after the member was cleared. */
export const whoDid = (team: TeamSnapshot, task: Task) => team.agents.find((a) => a.id === task.assignee)?.name ?? task.who ?? null;
