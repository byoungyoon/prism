import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** How many of the newest messages a chat draws at first; "이전 대화 보기" adds this many more. */
export const RECENT_STEP = 60;

/**
 * Only the newest `limit` items of a long list (a long chat drawn whole made the window heavy and
 * slow over time). `more()` shows older ones and keeps what's in view where it was. `reset` (the
 * filter, the team…) goes back to just the newest.
 */
export function useRecent<T>(list: T[], scrollRef: RefObject<HTMLElement | null>, reset: unknown) {
  const [limit, setLimit] = useState(RECENT_STEP);
  const [lastReset, setLastReset] = useState(reset);
  const before = useRef<number | null>(null);
  if (reset !== lastReset) {
    setLastReset(reset);
    setLimit(RECENT_STEP);
  }
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && before.current != null) el.scrollTop += el.scrollHeight - before.current;
    before.current = null;
  }, [limit, scrollRef]);
  const hidden = Math.max(0, list.length - limit);
  return {
    visible: hidden ? list.slice(hidden) : list,
    hidden,
    more: () => {
      before.current = scrollRef.current?.scrollHeight ?? null;
      setLimit((n) => n + RECENT_STEP);
    },
  };
}

/** The "이전 대화 N개 보기" button at the top of a shortened chat. */
export function OlderButton({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  if (!hidden) return null;
  return (
    <button type="button" onClick={onClick} className="self-center rounded-full border px-3 py-1 text-[11.5px] text-ink-2 hover:text-ink" style={{ borderColor: "var(--line)" }}>
      이전 대화 {Math.min(hidden, RECENT_STEP)}개 더 보기 (남은 {hidden}개)
    </button>
  );
}
