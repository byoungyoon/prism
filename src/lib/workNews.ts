// What a team's update brings that the user may want to hear about while looking elsewhere:
// a card reporting to the 총괄 finished, was wrapped up (merged), or failed — or someone got stuck.
// Worked out from two snapshots in a row, so each thing is said once and nothing old is repeated.
import type { Agent, Task, TeamSnapshot } from "./api";

type Snap = Pick<TeamSnapshot, "tasks" | "agents" | "chat">;

/** "이" / "가" after a word; a word not ending in Hangul gets " 일이" */
const subject = (word: string) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  if (c < 0 || c > 11171) return `${word} 일이`;
  return `${word}${c % 28 ? "이" : "가"}`;
};

const short = (s: string, max = 60) => {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

const cardLine = (t: Task, before: Task["stage"] | undefined): string | null => {
  if (t.stage === before) return null;
  const name = `${t.id} ${short(t.title, 40)}`;
  if (t.stage === "failed") return `${name} 일을 끝내지 못했어요`;
  if (t.stage === "review") return `${subject(name)} 끝났어요`;
  // done straight from running: nothing waited for a merge
  if (t.stage === "done") return before === "review" ? `${name} 마무리까지 마쳤어요` : `${subject(name)} 끝났어요`;
  return null;
};

export function workNews(prev: Snap, next: Snap, nameOf: (a: Agent) => string): string[] {
  const stages = new Map(prev.tasks.map((t) => [t.id, t.stage]));
  // only cards that report to the 총괄: a 팀장's smaller cards report to the 팀장
  const cards = next.tasks.filter((t) => t.requestedBy === "lead").flatMap((t) => cardLine(t, stages.get(t.id)) ?? []);

  const who = (id: string) => {
    const a = next.agents.find((x) => x.id === id);
    return a ? nameOf(a) : "팀원";
  };
  const asked = new Set(prev.chat.map((m) => m.id));
  const questions = next.chat.flatMap((m) => (m.escalation && !m.escalation.answer && !asked.has(m.id) ? [`${who(m.escalation.agentId)} · 막혀서 물어봐요: ${short(m.text)}`] : []));
  const stuck = next.agents.flatMap((a) => {
    const before = prev.agents.find((x) => x.id === a.id);
    return a.stuck && !before?.stuck ? [`${nameOf(a)} · 일이 막혔어요: ${short(a.stuck)}`] : [];
  });

  return [...questions, ...stuck, ...cards];
}
