import { LayoutGroup, motion } from "motion/react";
import { useApp, useCurrent } from "../store";
import { COLUMNS, STATUS, cardView, clock } from "../data/types";

export function TaskBoard() {
  const { selectedCard, selectCard, go } = useApp();
  const { team } = useCurrent();
  const cards = (team?.tasks ?? []).map((t) => cardView(t, team?.agents ?? []));
  const selected = cards.find((c) => c.task.id === selectedCard);

  return (
    <section aria-label="작업 보드" className="glass flex max-w-[340px] min-w-0 flex-[1_1_320px] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-1.5">
        <h2 className="m-0 text-sm font-semibold">작업 보드</h2>
        <span className="text-xs text-ink-2">카드 {cards.length}</span>
      </div>

      <LayoutGroup>
        <div className="flex flex-auto flex-col gap-2.5 overflow-y-auto px-3 pt-1 pb-2.5">
          {cards.length === 0 && <p className="px-1 text-xs text-ink-2">총괄이 작업을 나누면 카드가 여기에 쌓여요.</p>}
          {COLUMNS.map((col) => {
            const list = cards.filter((c) => c.column === col);
            if (!list.length && cards.length === 0) return null;
            return (
              <div key={col} className="flex flex-col gap-[5px]">
                <span className="flex justify-between px-1 text-xs font-medium text-ink-2">
                  <span>{col}</span>
                  <span>{list.length}</span>
                </span>
                {list.map((c) => {
                  const s = STATUS[c.status];
                  const on = c.task.id === selectedCard;
                  const blocked = c.status === "block";
                  return (
                    <motion.button
                      layout
                      layoutId={c.task.id}
                      transition={{ type: "spring", stiffness: 260, damping: 28 }}
                      key={c.task.id}
                      onClick={() => selectCard(on ? null : c.task.id)}
                      aria-pressed={on}
                      className="flex min-h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left"
                      style={{
                        border: `1.5px solid ${on ? "var(--navy)" : blocked ? "var(--block)" : "var(--glass-border)"}`,
                        background: blocked ? "var(--block-bg)" : "var(--glass2)",
                        opacity: c.status === "done" ? 0.72 : 1,
                        color: "var(--text)",
                      }}
                    >
                      <span className={`${s.cls} size-[7px] shrink-0 rounded-full`} style={{ background: s.color }} />
                      <span className="shrink-0 font-mono text-[11.5px] font-medium">{c.task.id}</span>
                      <span className="min-w-0 flex-auto truncate text-[12.5px]">{c.task.title}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-ink-2">{c.side}</span>
                    </motion.button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </LayoutGroup>

      {selected && (
        <div className="flex flex-col gap-1.5 px-4 py-3 text-[12.5px] leading-normal" style={{ borderTop: "1px solid var(--line)" }}>
          <span className="flex items-center gap-2">
            <span className="font-mono font-semibold">{selected.task.id}</span>
            <span className="font-semibold">{selected.task.title}</span>
          </span>
          <span className="line-clamp-3 select-text">{selected.task.goal}</span>
          {selected.task.summary && <span className="line-clamp-3 text-ink-2 select-text">보고: {selected.task.summary}</span>}
          {selected.task.branch && <span className="font-mono text-[10.5px] text-ink-2 opacity-70" title="작업본 이름 (자세한 정보)">{selected.task.branch}</span>}
          {selected.agent && (
            <button onClick={() => go({ name: "agent", id: selected.agent!.id })} className="self-start text-xs underline" style={{ color: "var(--navy)" }}>
              {selected.agent.name} 작업 화면 보기
            </button>
          )}
        </div>
      )}

      <div className="flex max-h-[210px] flex-col gap-1.5 overflow-y-auto px-4 pt-2.5 pb-3.5" style={{ borderTop: "1px solid var(--line)" }}>
        <h2 className="m-0 mb-0.5 text-[13px] font-semibold">진행 기록</h2>
        {(team?.events ?? []).map((e, i) => (
          <div key={`${e.at}-${i}`} className="flex gap-2.5 text-[12.5px] leading-[1.45]">
            <span className="shrink-0 pt-px font-mono text-[11px] text-ink-2">{clock(e.at)}</span>
            <span style={{ color: e.tone === "block" ? "var(--block-ink)" : "var(--text)" }}>{e.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
