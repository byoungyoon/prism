// 지식: notes every AI reads before it starts — one page shared by all teams (server info, how to
// deploy…) and one per project. Saved text goes into each AI's instructions from its next start.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/api";
import { useApp } from "../store";

const SHARED = "__shared__";
const spring = { type: "spring" as const, stiffness: 320, damping: 30 };

const EXAMPLE = `예)
- 개발 서버: dev.example.com (접속: ssh 이름@dev.example.com)
- 배포: main에 합치면 자동으로 올라가요
- 디자인 규칙: 버튼은 둥글게, 주황색 하나만 강조색으로
- 비밀번호·키는 프로젝트의 .env 파일에 있어요 (여기엔 적지 마세요)`;

export function KnowledgeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projects = useApp((s) => s.projects);
  const setError = useApp((s) => s.setError);
  const loadProjects = useApp((s) => s.loadProjects);
  const current = useApp((s) => s.projectId);
  const [tab, setTab] = useState(SHARED);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // what's stored now: the shared page from disk, each project's from its record
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void api
      .knowledge()
      .then((shared) => {
        if (!alive) return;
        const base = { [SHARED]: shared, ...Object.fromEntries(projects.map((p) => [p.id, p.knowledge ?? ""])) };
        setSaved(base);
        setDrafts(base);
      })
      .catch(setError);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const text = drafts[tab] ?? "";
  const dirty = useMemo(() => Object.keys(drafts).filter((k) => drafts[k] !== saved[k]), [drafts, saved]);
  const changed = dirty.includes(tab);

  const save = async () => {
    setBusy(true);
    try {
      if (tab === SHARED) await api.setKnowledge(text);
      else await api.setProjectKnowledge(tab, text);
      setSaved((s) => ({ ...s, [tab]: text }));
      if (tab !== SHARED) void loadProjects();
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const tabs = [{ id: SHARED, label: "모든 팀 공통" }, ...projects.map((p) => ({ id: p.id, label: p.name }))];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="knowledge"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-start justify-center pt-[7vh] max-[820px]:items-end max-[820px]:pt-0"
          style={{ background: "rgba(30,24,18,0.32)" }}
          onMouseDown={(e) => e.target === e.currentTarget && dirty.length === 0 && onClose()}
        >
          <motion.section
            role="dialog"
            aria-label="지식"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={spring}
            className="flex max-h-[84vh] w-[min(760px,calc(100%-32px))] flex-col gap-4 rounded-[22px] p-6 max-[820px]:max-h-[92dvh] max-[820px]:w-full max-[820px]:overflow-y-auto max-[820px]:rounded-b-none max-[820px]:p-4 max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))]"
            style={{ background: "color-mix(in srgb, var(--bg2) 97%, transparent)", border: "1px solid var(--glass-border)", boxShadow: "var(--shadow)" }}
          >
            <header className="flex items-start gap-3">
              <div className="flex flex-auto flex-col gap-1">
                <h2 className="m-0 text-[18px] font-semibold">지식</h2>
                <span className="text-[12.5px] leading-relaxed text-ink-2">
                  모든 AI가 일을 시작할 때 읽는 메모예요. 서버 정보, 배포 방법, 지켜야 할 규칙처럼 매번 설명하기 번거로운 걸 적어두세요. 저장하면 다음에 일을 시작하는 AI부터 적용돼요.
                </span>
              </div>
              <button
                onClick={onClose}
                className="min-h-9 shrink-0 rounded-full px-3.5 text-[12.5px]"
                style={{ border: "1px solid var(--line)", color: dirty.length ? "var(--block-ink)" : undefined }}
              >
                {dirty.length ? "저장 안 하고 닫기" : "닫기"}
              </button>
            </header>

            <div role="tablist" aria-label="어디에 적용할지" className="flex flex-wrap gap-1.5">
              {tabs.map((t) => {
                const on = t.id === tab;
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={on}
                    onClick={() => {
                      setTab(t.id);
                      setDone(false);
                    }}
                    className="flex min-h-8 max-w-[200px] items-center gap-1 rounded-full px-3 text-[12.5px] font-medium"
                    style={{ background: on ? "var(--tile)" : "transparent", border: `1px solid ${on ? "var(--amber)" : "var(--line)"}` }}
                  >
                    <span className="truncate">{t.label}</span>
                    {t.id === current && t.id !== SHARED && <span className="shrink-0 text-[11px] text-ink-2">· 지금 팀</span>}
                    {dirty.includes(t.id) && <span aria-label="저장 안 함" className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--amber)" }} />}
                  </button>
                );
              })}
            </div>

            <span className="text-[12px] text-ink-2">
              {tab === SHARED ? "모든 팀의 모든 AI가 읽어요." : `${tabs.find((t) => t.id === tab)?.label} 팀의 AI만 읽어요. 공통 내용과 함께 전달돼요.`}
            </span>

            <textarea
              aria-label="지식 내용"
              value={text}
              onChange={(e) => setDrafts((d) => ({ ...d, [tab]: e.target.value }))}
              placeholder={EXAMPLE}
              spellCheck={false}
              className="min-h-[300px] flex-auto resize-none max-[820px]:min-h-[180px] rounded-xl p-3.5 text-[13.5px] leading-relaxed outline-none"
              style={{ background: "var(--tile)", border: "1px solid var(--line)", color: "var(--text)" }}
            />

            <footer className="flex flex-wrap items-center gap-3">
              <span className="flex-auto text-[11.5px] leading-relaxed text-ink-2">
                비밀번호·API 키 같은 비밀값은 적지 마세요. 이 내용은 모든 AI에게 그대로 전달돼요. 비밀값은 "어디에 있는지"만 적어주세요.
              </span>
              <button
                onClick={() => void save()}
                disabled={!changed || busy}
                className="min-h-9 rounded-full border-0 px-5 text-[13px] font-semibold disabled:opacity-50"
                style={{ background: "var(--amber)", color: "#2B2520" }}
              >
                {done ? "저장했어요" : busy ? "저장 중…" : "저장"}
              </button>
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
