// Report cards: a worker's '[Prism 보고]' message (as it reaches the 팀장/총괄), and the 총괄's own
// reply to a report in chat. Both fold to one line — id badge, done/failed, first line of the
// summary — and open on tap. Also the chat's "대화만 / 보고만 / 전체" filter.
import { useState, type ReactNode } from "react";
import { ChevronDown } from "./icons";
import { Markdown } from "./Markdown";

export const REPORT_PREFIX = "[Prism 보고]";
export const isReport = (text: string) => text.startsWith(REPORT_PREFIX);

/** "[Prism 보고] T-1 (이름) 완료: 요약 — 브랜치 …" → its parts, or null if it doesn't match. */
export function parseReport(text: string) {
  const m = /^\[Prism 보고\] (\S+) \((.*?)\) (완료|실패): ([\s\S]*)$/.exec(text);
  if (!m) return null;
  return { id: m[1], who: m[2], failed: m[3] === "실패", summary: m[4] };
}

/** The first line of a summary. The tail after it tells the 총괄 what to do next, so the folded line leaves it out. */
export function firstLine(summary: string) {
  const body = summary.replace(/ — (브랜치 |확인 후 complete_task)[\s\S]*$/, "");
  return body.split("\n").find((l) => l.trim())?.trim() ?? "";
}

/** Red pill for a failed report or card — the color is what makes failures stand out. */
export function FailPill() {
  return (
    <span className="shrink-0 rounded-full px-2 py-px text-[11px] font-semibold" style={{ background: "var(--block-bg)", color: "var(--block-ink)" }}>
      ⚠ 실패
    </span>
  );
}

/** A report card: tinted background and colored border, so it never reads like a chat bubble. */
export function FoldCard({ id, who, failed, line, text, pill, footer }: { id?: string; who?: string; failed: boolean; line: string; text: string; pill?: ReactNode; footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="flex w-full min-w-0 flex-col rounded-xl"
      style={{
        background: failed ? "var(--block-bg)" : "rgba(127,176,138,0.12)",
        border: `1.5px solid ${failed ? "var(--block)" : "rgba(127,176,138,0.55)"}`,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-9 w-full min-w-0 items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-[12.5px]"
      >
        {id && (
          <span className="shrink-0 rounded-md px-1.5 py-px font-mono text-[11.5px] font-semibold" style={{ background: "var(--navy)", color: "var(--me-fg)" }}>
            {id}
          </span>
        )}
        {who && <span className="shrink-0 text-[11.5px] text-ink-2">{who}</span>}
        {pill ?? (failed ? <FailPill /> : <span className="shrink-0 text-[11.5px] font-semibold text-[var(--work-ink)]">✓ 완료</span>)}
        {!open && <span className="min-w-0 flex-auto truncate text-ink-2">{line}</span>}
        <ChevronDown size={14} className="ml-auto shrink-0 text-ink-2" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 160ms" }} />
      </button>
      {open && <div className="m-0 px-3 pt-0 pb-3 text-[13px] leading-relaxed select-text"><Markdown text={text} /></div>}
      {footer}
    </div>
  );
}

/** A '[Prism 보고]' message from a worker, as it appears in an agent's conversation. */
export function ReportFold({ text }: { text: string }) {
  const r = parseReport(text);
  if (!r)
    return <div className="glass-soft rounded-[14px] px-3.5 py-2.5 text-[13px] leading-relaxed select-text"><Markdown text={text} /></div>;
  return <FoldCard id={r.id} who={r.who} failed={r.failed} line={firstLine(r.summary)} text={text} />;
}

// ── chat filter ───────────────────────────────────────

export type ChatView = "all" | "chat" | "report";
const VIEWS: [ChatView, string][] = [
  ["all", "전체"],
  ["chat", "대화만"],
  ["report", "보고만"],
];

/** Above a chat: show only the talk, only the reports, or both. */
export function ChatFilter({ value, onChange }: { value: ChatView; onChange: (v: ChatView) => void }) {
  return (
    <div role="group" aria-label="대화와 보고 거르기" className="flex gap-1.5 px-3.5 pt-2.5">
      {VIEWS.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className="min-h-7 rounded-full border-0 px-3 text-[12px] font-medium"
          style={{ background: value === v ? "var(--navy)" : "var(--chip)", color: value === v ? "var(--me-fg)" : "var(--text2)" }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
