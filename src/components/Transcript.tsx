// A structured agent's conversation: what it was asked, what it said, what it did — no terminal.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type TranscriptEntry } from "../lib/api";
import { ReportFold, isReport } from "./ReportFold";
import { Markdown } from "./Markdown";

/** Loads an agent's conversation and keeps it live. */
export function useTranscript(projectId: string | null, agentId: string) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    let off: (() => void) | undefined;
    void api.transcript(projectId, agentId).then((list) => alive && setEntries(list.slice(-400))); // a long one drawn whole gets heavy
    void api
      .onEntry((e) => {
        if (e.projectId === projectId && e.agentId === agentId) setEntries((x) => [...x.slice(-399), e.entry]);
      })
      .then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      off?.();
    };
  }, [projectId, agentId]);
  return entries;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
const spring = { type: "spring" as const, stiffness: 300, damping: 30 };

function Row({ e }: { e: TranscriptEntry }) {
  // a worker's report handed up to this agent: folded like the report feed's cards
  if (e.kind === "in" && isReport(e.text)) return <ReportFold text={e.text} />;
  if (e.kind === "tool")
    return (
      <div className="flex items-center gap-2 px-1 text-[12px] text-ink-2">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--sky)" }} />
        <span className="min-w-0 truncate font-mono">{e.text}</span>
      </div>
    );
  if (e.kind === "in")
    return (
      <div className="max-w-[88%] self-end rounded-[14px_14px_4px_14px] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap select-text" style={{ background: "var(--me-bg)", color: "var(--me-fg)" }}>
        {e.text}
      </div>
    );
  if (e.kind === "done" || e.kind === "error")
    return (
      <div className="flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] leading-relaxed select-text" style={{ background: e.kind === "done" ? "rgba(127,176,138,0.14)" : "var(--block-bg)", color: e.kind === "done" ? "var(--work-ink)" : "var(--block-ink)" }}>
        <span className="shrink-0 font-semibold">{e.kind === "done" ? "✓ 한 차례 마침" : "⚠ 문제"}</span>
        <span className="min-w-0 line-clamp-3">{e.text}</span>
      </div>
    );
  return (
    <div className="glass-soft max-w-[92%] self-start rounded-[14px_14px_14px_4px] px-3.5 py-2.5 text-[13px] leading-relaxed select-text">
      <Markdown text={e.text} />
    </div>
  );
}

/** Full conversation view (agent detail). */
export function Transcript({ projectId, agentId, working }: { projectId: string | null; agentId: string; working: boolean }) {
  const entries = useTranscript(projectId, agentId);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [entries.length]);
  return (
    <div ref={box} className="flex min-h-0 flex-auto flex-col gap-2 overflow-y-auto p-4">
      {entries.length === 0 && <span className="m-auto text-[13px] text-ink-2">아직 주고받은 내용이 없어요.</span>}
      <AnimatePresence initial={false}>
        {entries.map((e, i) => (
          <motion.div key={`${e.at}-${i}`} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex flex-col">
            <Row e={e} />
            {i > 0 && e.at - entries[i - 1].at > 5 * 60_000 && <span className="self-center text-[10.5px] text-ink-2">{clock(e.at)}</span>}
          </motion.div>
        ))}
      </AnimatePresence>
      {working && (
        <div className="flex gap-1 self-start px-2 py-1" aria-label="작업 중">
          {[0, 1, 2].map((i) => (
            <span key={i} className="s-work size-1.5 rounded-full" style={{ background: "var(--text2)", animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Last few lines, for small cards (focus view). */
export function TranscriptPeek({ projectId, agentId, dark }: { projectId: string | null; agentId: string; dark?: boolean }) {
  const muted = dark ? "#a89c8e" : "var(--text2)";
  const entries = useTranscript(projectId, agentId).filter((e) => e.kind !== "in").slice(-5);
  return (
    <div className="flex h-full min-h-[116px] flex-col justify-end gap-1 overflow-hidden p-1">
      {entries.length === 0 && <span className="m-auto text-[11.5px]" style={{ color: muted }}>시작하는 중…</span>}
      {entries.map((e, i) => (
        <span key={`${e.at}-${i}`} className={`truncate text-[11.5px] ${e.kind === "tool" ? "font-mono" : ""}`} style={{ color: e.kind === "tool" ? muted : undefined, opacity: i === entries.length - 1 ? 1 : 0.6 }}>
          {e.kind === "tool" ? "· " : ""}
          {e.text.split("\n")[0]}
        </span>
      ))}
    </div>
  );
}
