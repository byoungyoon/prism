// A '[Prism 보고]' message (a worker's report handed up to the 팀장/총괄), folded to one line:
// id, who, done/failed, and the first line of the summary. A tap opens the whole text.
import { useState } from "react";
import { ChevronDown } from "./icons";

export const REPORT_PREFIX = "[Prism 보고]";
export const isReport = (text: string) => text.startsWith(REPORT_PREFIX);

/** "[Prism 보고] T-1 (이름) 완료: 요약 — 브랜치 …" → its parts, or null if it doesn't match. */
export function parseReport(text: string) {
  const m = /^\[Prism 보고\] (\S+) \((.*?)\) (완료|실패): ([\s\S]*)$/.exec(text);
  if (!m) return null;
  // the tail after the summary tells the 총괄 what to do next; the folded line leaves it out
  const body = m[4].replace(/ — (브랜치 |확인 후 complete_task)[\s\S]*$/, "").trim();
  const line = body.split("\n").find((l) => l.trim())?.trim() ?? "";
  return { id: m[1], who: m[2], failed: m[3] === "실패", line };
}

/** Red pill for a failed report or card — the color is what makes failures stand out. */
export function FailPill() {
  return (
    <span className="shrink-0 rounded-full px-2 py-px text-[11px] font-semibold" style={{ background: "var(--block-bg)", color: "var(--block-ink)" }}>
      ⚠ 실패
    </span>
  );
}

export function ReportFold({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const r = parseReport(text);
  if (!r)
    return <div className="glass-soft rounded-[14px] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap select-text">{text}</div>;
  return (
    <div
      className="flex w-full min-w-0 flex-col rounded-xl"
      style={{
        background: r.failed ? "var(--block-bg)" : "var(--glass2)",
        boxShadow: r.failed ? "inset 3px 0 0 var(--block)" : "var(--shadow-sm), var(--hi)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-9 w-full min-w-0 items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-[12.5px]"
      >
        <span className="shrink-0 font-mono text-[11.5px] font-semibold">{r.id}</span>
        <span className="shrink-0 text-[11.5px] text-ink-2">{r.who}</span>
        {r.failed ? <FailPill /> : <span className="shrink-0 text-[11.5px] font-medium text-[var(--work-ink)]">완료</span>}
        {!open && <span className="min-w-0 flex-auto truncate text-ink-2">{r.line}</span>}
        <ChevronDown size={14} className="ml-auto shrink-0 text-ink-2" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 160ms" }} />
      </button>
      {open && <p className="m-0 px-3 pt-0 pb-3 text-[13px] leading-relaxed whitespace-pre-wrap select-text">{text}</p>}
    </div>
  );
}
