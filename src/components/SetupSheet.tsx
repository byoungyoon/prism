// First-run setup: checks Git / Claude Code / Codex (and Node.js on Windows) and installs whatever
// is missing, one after another, with the official installers running in a visible terminal.
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, pty, type CliStatus } from "../lib/api";
import { useApp } from "../store";
import { TerminalView } from "./TerminalView";

const spring = { type: "spring" as const, stiffness: 300, damping: 30 };

const WHY: Record<string, string> = {
  git: "작업 브랜치·worktree 관리",
  node: "Codex 설치에 필요",
  claude: "총괄·팀장·작업자 에이전트",
  codex: "Codex 에이전트",
};

export function Installer({ tool, onCheck }: { tool: CliStatus; onCheck: () => void }) {
  const [ptyId, setPtyId] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    let started: number | null = null;
    const timer = setTimeout(() => {
      api
        .cliInstall(tool.name, 92, 16)
        .then((p) => {
          started = p;
          if (alive) setPtyId(p);
          else void pty.kill(p);
        })
        .catch((e) => useApp.getState().setError(e));
    }, 150); // one install, even when React (dev) runs this effect twice
    const t = setInterval(onCheck, 3000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(t);
      if (started != null) void pty.kill(started);
    };
  }, [tool.name, onCheck]);
  return (
    <motion.div key={tool.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className="flex flex-col gap-2">
      {tool.name === "git" && navigator.userAgent.includes("Mac") && (
        <span className="text-[12px]" style={{ color: "var(--wait-ink)" }}>
          Apple 설치 창이 뜨면 &apos;설치&apos;를 눌러주세요. (Homebrew가 있으면 자동으로 설치돼요)
        </span>
      )}
      <div className="h-[200px] rounded-xl p-3" style={{ background: "var(--term-bg)" }}>
        {ptyId != null && <TerminalView ptyId={ptyId} fontSize={11.5} className="h-full w-full" />}
      </div>
    </motion.div>
  );
}

export function SetupSheet() {
  const [tools, setTools] = useState<CliStatus[]>([]);
  const [open, setOpen] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);

  const check = useCallback(async () => {
    try {
      const list = await api.cliStatus();
      setTools(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  // first launch check
  useEffect(() => {
    void check().then((list) => {
      if (list.some((t) => !t.installed)) setOpen(true);
    });
  }, [check]);

  const current = tools.find((t) => !t.installed && !skipped.includes(t.name));
  const allDone = tools.length > 0 && !current;

  useEffect(() => {
    if (!open || !allDone) return;
    void useApp.getState().loadAccounts();
    const t = setTimeout(() => setOpen(false), 1800);
    return () => clearTimeout(t);
  }, [open, allDone]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="setup"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[60] flex items-start justify-center pt-[9vh]"
          style={{ background: "rgba(30,24,18,0.32)", backdropFilter: "blur(6px)" }}
        >
          <motion.section
            role="dialog"
            aria-label="Prism 준비"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={spring}
            className="flex max-h-[80vh] w-[min(560px,calc(100%-32px))] flex-col gap-4 overflow-y-auto rounded-[22px] p-6"
            style={{ background: "color-mix(in srgb, var(--bg2) 95%, transparent)", border: "1px solid var(--glass-border)", boxShadow: "var(--shadow)" }}
          >
            <header className="flex flex-col gap-1">
              <h2 className="m-0 text-[19px] font-semibold">{allDone ? "준비 끝!" : "Prism 준비 중"}</h2>
              <span className="text-[12.5px] leading-relaxed text-ink-2">
                {allDone ? "필요한 도구가 모두 설치됐어요. 이제 계정에 로그인하고 팀을 출근시키면 돼요." : "필요한 도구 중 빠진 걸 공식 설치 프로그램으로 하나씩 설치하고 있어요."}
              </span>
            </header>

            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {tools.map((t) => {
                const busy = current?.name === t.name;
                const skip = skipped.includes(t.name) && !t.installed;
                return (
                  <motion.li key={t.name} layout className="flex items-center gap-3 rounded-xl px-3.5 py-2.5" style={{ background: busy ? "var(--glass2)" : "transparent", border: `1px solid ${busy ? "var(--amber)" : "var(--line)"}` }}>
                    <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${busy ? "s-work" : ""}`} style={{ background: t.installed ? "var(--work)" : busy ? "var(--amber)" : "var(--chip)", color: t.installed || busy ? "#fff" : "var(--text2)" }}>
                      {t.installed ? "✓" : busy ? "…" : skip ? "–" : ""}
                    </span>
                    <span className="flex flex-auto flex-col">
                      <span className="text-[13.5px] font-semibold">{t.label}</span>
                      <span className="text-[11.5px] text-ink-2">{WHY[t.name]}</span>
                    </span>
                    <span className="font-mono text-[11.5px] text-ink-2">{t.installed ? t.version : busy ? "설치 중" : skip ? "건너뜀" : "대기"}</span>
                  </motion.li>
                );
              })}
              {tools.length === 0 && <span className="text-[12.5px] text-ink-2">확인하는 중…</span>}
            </ul>

            <AnimatePresence mode="wait">{current && <Installer key={`${current.name}-${attempt}`} tool={current} onCheck={() => void check()} />}</AnimatePresence>

            <div className="flex items-center gap-2">
              {current && (
                <>
                  <button onClick={() => setAttempt((n) => n + 1)} className="min-h-9 rounded-full px-3.5 text-[12.5px]" style={{ border: "1px solid var(--line)" }}>
                    다시 시도
                  </button>
                  <button onClick={() => setSkipped((s) => [...s, current.name])} className="min-h-9 rounded-full px-3.5 text-[12.5px]" style={{ border: "1px solid var(--line)" }}>
                    {current.label} 건너뛰기
                  </button>
                </>
              )}
              <span className="flex-auto" />
              <button onClick={() => setOpen(false)} className="min-h-9 rounded-full border-0 px-4 text-[12.5px] font-semibold" style={{ background: allDone ? "var(--amber)" : "var(--chip)", color: allDone ? "#2B2520" : "var(--text)" }}>
                {allDone ? "시작하기" : "나중에"}
              </button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
