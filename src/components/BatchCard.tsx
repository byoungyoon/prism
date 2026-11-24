// A 묶음 지시 (one order sent to several teams) as one card in the timeline: the order, how many teams
// are done, each team's state, and the 종합 결과 once every team has finished. Each team's own replies
// are folded inside the card, so they don't also show up as separate lines in the timeline.
import type { Batch, ChatMsg } from "../lib/api";
import { ATTACH_MARK } from "./LeadChat";
import { FailPill, FoldCard, firstLine } from "./ReportFold";
import { Markdown } from "./Markdown";

/** how far apart the order in a team's chat and the batch's start can be (ms) */
const MATCH_WINDOW = 10_000;

export type BatchItem = { batch: Batch; /** each team's replies to this order, by project id */ replies: Record<string, ChatMsg[]> };

/** a chat message's identity across teams ("projectId:msgId") */
export const absorbKey = (pid: string, m: ChatMsg) => `${pid}:${m.id}`;

/** Replies a team may give under an order: its 총괄's answers and reports. Questions and permission asks stay in the timeline. */
const isReply = (m: ChatMsg) => m.kind === "lead" || m.kind === "report";

/**
 * Pairs each batch with the order message each of its teams got (same text, sent at about the same time),
 * and collects that team's replies after it, up to its next order. Returns the batch items and the
 * chat messages they absorbed (so the timeline skips them).
 */
export function groupBatches(batches: Batch[], chats: { projectId: string; chat: ChatMsg[] }[]) {
  const absorbed = new Set<string>();
  const items: BatchItem[] = [];
  for (const batch of [...batches].sort((a, b) => a.sentAt - b.sentAt)) {
    const replies: Record<string, ChatMsg[]> = {};
    for (const t of batch.teams) {
      const team = chats.find((c) => c.projectId === t.projectId);
      if (!team) continue;
      // the team's copy of this order: same text, nearest in time, not already taken by another batch
      let own = -1;
      let best = MATCH_WINDOW;
      team.chat.forEach((m, i) => {
        if (m.kind !== "me" || m.text.split(ATTACH_MARK)[0] !== batch.text || absorbed.has(absorbKey(team.projectId, m))) return;
        const gap = Math.abs(m.at - batch.sentAt);
        if (gap < best) {
          own = i;
          best = gap;
        }
      });
      if (own < 0) continue;
      absorbed.add(absorbKey(team.projectId, team.chat[own]));
      const got: ChatMsg[] = [];
      for (let i = own + 1; i < team.chat.length; i++) {
        const m = team.chat[i];
        if (m.kind === "me") break; // its next order starts here
        if (isReply(m)) {
          got.push(m);
          absorbed.add(absorbKey(team.projectId, m));
        }
      }
      replies[t.projectId] = got;
    }
    items.push({ batch, replies });
  }
  return { items, absorbed };
}

/** Whether a card has something for the 보고만 filter: a team report, or the 종합 결과. */
export const batchHasReport = ({ batch, replies }: BatchItem) =>
  !!batch.summary || Object.values(replies).some((list) => list.some((m) => m.kind === "report"));

export function BatchCard({ batch, replies, names }: BatchItem & { names: Record<string, string> }) {
  const total = batch.teams.length;
  const finished = batch.teams.filter((t) => t.state !== "run").length;

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <span className="self-end text-[11px] text-ink-2">→ {batch.teams.map((t) => names[t.projectId] ?? "팀").join(", ")}</span>
      <div className="self-end max-w-[88%] rounded-[14px_14px_4px_14px] px-[13px] py-[9px] leading-normal whitespace-pre-wrap select-text" style={{ background: "var(--me-bg)", color: "var(--me-fg)" }}>
        {batch.text}
      </div>

      <div className="glass-soft flex flex-col gap-2 rounded-xl p-3">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="font-semibold">
            {batch.summary ? "모든 팀이 끝났어요" : `${total}팀 중 ${finished}팀 끝남`}
          </span>
          {!batch.summary && finished === total && <span className="text-ink-2">· 종합 정리 중…</span>}
        </div>

        {batch.teams.map((t) => {
          const name = names[t.projectId] ?? "팀";
          const got = replies[t.projectId] ?? [];
          const pill =
            t.state === "failed" ? (
              <FailPill />
            ) : t.state === "done" ? (
              <span className="shrink-0 text-[11.5px] font-semibold text-[var(--work-ink)]">✓ 완료</span>
            ) : (
              <span className="shrink-0 text-[11.5px] font-medium text-ink-2">진행 중</span>
            );
          if (!got.length) {
            return (
              <div key={t.projectId} className="flex min-h-7 items-center gap-2 px-1 text-[12.5px]">
                <span className="min-w-0 flex-auto truncate font-medium">{name}</span>
                {pill}
              </div>
            );
          }
          const text = got.map((m) => m.text).join("\n\n");
          return <FoldCard key={t.projectId} who={name} failed={t.state === "failed"} pill={pill} line={firstLine(text)} text={text} />;
        })}

        {batch.summary && (
          <div className="rounded-xl px-3 py-2.5 text-[13px] leading-relaxed select-text" style={{ background: "var(--chip)" }}>
            <b className="mb-1 block text-[12px] font-semibold text-ink-2">종합 결과</b>
            <Markdown text={batch.summary} />
          </div>
        )}
      </div>
    </div>
  );
}
