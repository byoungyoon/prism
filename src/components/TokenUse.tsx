// 토큰 사용량: how much each team, card and member has used, in everyday words ("약 12만 토큰").
// Small by design: a line that opens to the details, and a warning dot for a runaway turn.
import { useState } from "react";
import type { Bucket, ModelUse, TeamSnapshot, UsageAlert } from "../lib/api";
import { bucketTotal, clock, tokensText } from "../data/types";
import { ChevronDown } from "./icons";

const MODEL_NAME: Record<string, string> = { fable: "Fable", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };
const modelName = (m: string) => MODEL_NAME[m] ?? m;
const count = (n: number) => n.toLocaleString("ko-KR");

/** The four counts, for a tooltip: exact numbers behind the friendly one. */
function exact(b: Bucket) {
  return `입력 ${count(b.input)} · 출력 ${count(b.output)} · 캐시 읽기 ${count(b.cacheRead)} · 캐시 쓰기 ${count(b.cacheWrite)}`;
}

export function ModelChips({ models }: { models: ModelUse[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {models.map((m) => (
        <span key={m.model} title={exact(m)} className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--chip)" }}>
          {modelName(m.model)} {tokensText(bucketTotal(m))}
        </span>
      ))}
    </span>
  );
}

function alertText(a: UsageAlert) {
  const who = a.taskId ? `${a.agentName} (${a.taskId})` : a.agentName;
  if (a.kind === "big") return `${who} — 한 번에 문맥 ${tokensText(a.peakTokens ?? 0)}을 보냈어요. 대화가 길수록 매번 비싸요. 새 대화를 생각해 보세요.`;
  return `${who} — 짧은 시간에 ${a.turns ?? 0}번 연달아 차례를 썼어요. 반복되는 일이 없는지 봐 주세요.`;
}

/** The warnings, newest first; nothing when there are none. */
export function UsageWarnings({ alerts }: { alerts: UsageAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {alerts.map((a, i) => (
        <li key={`${a.at}-${i}`} className="flex gap-2 rounded-lg px-2 py-1.5 text-[12px] leading-normal" style={{ background: "var(--block-bg)", color: "var(--block-ink)" }}>
          <span className="shrink-0 font-mono text-[11px]">{clock(a.at)}</span>
          <span className="min-w-0">{alertText(a)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A team's usage today, one line that opens to its models and members. `label` names the team when several show. */
export function TeamUsageBox({ team, label }: { team: TeamSnapshot; label?: string }) {
  const [open, setOpen] = useState(false);
  const u = team.usage;
  if (!u) return null;
  const warn = u.alerts.length;
  return (
    <div className="flex flex-col">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="토큰은 입력·출력·캐시 읽기·캐시 쓰기를 모두 셉니다"
        className="flex min-h-8 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-[12.5px] hover:bg-[var(--chip)]"
      >
        {label && <span className="max-w-[90px] shrink-0 truncate text-[11.5px] text-ink-2">{label}</span>}
        <span className="min-w-0 flex-auto truncate">
          오늘 <span className="font-semibold">{tokensText(bucketTotal(u.today))}</span>
        </span>
        {warn > 0 && (
          <span aria-label={`주의 ${warn}건`} className="shrink-0 rounded-full px-1.5 text-[10.5px] leading-[16px] font-semibold" style={{ background: "var(--block)", color: "#fff" }}>
            ⚠ {warn}
          </span>
        )}
        <ChevronDown size={13} className="shrink-0 text-ink-2" style={{ transform: open ? undefined : "rotate(-90deg)", transition: "transform 160ms" }} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-2 pt-1 pb-2">
          {u.models.length > 0 ? <ModelChips models={u.models} /> : <span className="text-[12px] text-ink-2">오늘 아직 쓴 토큰이 없어요</span>}
          <UsageWarnings alerts={u.alerts} />
          {u.members.map((m) => (
            <div key={m.agentId} className="flex flex-col gap-1 text-[12px]">
              <span className="flex items-baseline gap-2">
                <span className="font-medium">{m.name}</span>
                <span className="ml-auto text-ink-2">{tokensText(bucketTotal(m))}</span>
              </span>
              <ModelChips models={m.models} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One card's tokens so far, as a short phrase (nothing when it has used none). */
export function CardUsageText({ team, taskId }: { team: TeamSnapshot; taskId: string }) {
  const card = team.usage?.cards.find((c) => c.taskId === taskId);
  if (!card || bucketTotal(card) === 0) return null;
  return (
    <span title={exact(card)} className="shrink-0 text-[11.5px] text-ink-2">
      · 이 카드 {tokensText(bucketTotal(card))}
    </span>
  );
}

/** A member's tokens today, with its models. Shown for every member, card or not. */
export function MemberUsage({ team, agentId }: { team: TeamSnapshot; agentId: string }) {
  const m = team.usage?.members.find((x) => x.agentId === agentId);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium">오늘 토큰</span>
      {m ? (
        <>
          <span title={exact(m)} className="text-[12.5px]">
            {tokensText(bucketTotal(m))}
          </span>
          <ModelChips models={m.models} />
        </>
      ) : (
        <span className="text-[12px] text-ink-2">오늘 아직 쓴 토큰이 없어요</span>
      )}
    </div>
  );
}
