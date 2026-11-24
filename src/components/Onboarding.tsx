// First-run guide for people who don't develop software: pick your AI subscription → Prism
// installs what's needed → sign in → say what to build. After that the team just works.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type CliStatus, type Provider } from "../lib/api";
import { useApp } from "../store";
import { Installer } from "./SetupSheet";
import { LoginTerminal } from "./AccountSheet";
import { isRemote } from "../lib/transport";
import { useShallow } from "zustand/react/shallow";

const spring = { type: "spring" as const, stiffness: 300, damping: 30 };
type Step = "pick" | "install" | "login" | "start";

const SUBS: { id: Provider; title: string; sub: string; mark: string }[] = [
  { id: "claude", title: "Claude", sub: "Claude Pro · Max 구독", mark: "C" },
  { id: "codex", title: "ChatGPT", sub: "ChatGPT Plus · Pro 구독", mark: "G" },
  { id: "antigravity", title: "Gemini", sub: "Google AI Pro · Ultra 구독", mark: "✦" },
];

const STEPS: { id: Step; label: string }[] = [
  { id: "pick", label: "구독 선택" },
  { id: "install", label: "준비" },
  { id: "login", label: "로그인" },
  { id: "start", label: "첫 작업" },
];

/** tools each subscription needs (Windows also needs Node.js for Codex) */
function needed(providers: Provider[], all: CliStatus[]) {
  const names = new Set(["git"]);
  if (providers.includes("claude")) names.add("claude");
  if (providers.includes("codex")) {
    names.add("node");
    names.add("codex");
  }
  if (providers.includes("antigravity")) names.add("agy");
  return all.filter((t) => names.has(t.name));
}

export function Onboarding() {
  const { accounts, projects, loadAccounts, createProject, startTeam, sendToLead } = useApp(useShallow((s) => ({ accounts: s.accounts, projects: s.projects, loadAccounts: s.loadAccounts, createProject: s.createProject, startTeam: s.startTeam, sendToLead: s.sendToLead })));
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("pick");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [tools, setTools] = useState<CliStatus[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const checkTools = useCallback(async () => {
    try {
      const t = await api.cliStatus();
      setTools(t);
      return t;
    } catch {
      return [];
    }
  }, []);

  // decide on launch whether the guide is needed, and where to resume it
  useEffect(() => {
    if (isRemote) return; // setup happens on the Mac itself
    void (async () => {
      try {
        const prefs = await api.prefs();
        const t = await checkTools();
        await loadAccounts();
        const chosen = prefs.providers;
        setProviders(chosen);
        if (!prefs.onboarded || !chosen.length) {
          setOpen(true);
          setStep("pick");
          return;
        }
        // finished before, but something went missing (uninstalled, signed out)
        if (needed(chosen, t).some((x) => !x.installed)) {
          setStep("install");
          setOpen(true);
        }
      } catch {
        /* not in the desktop app (browser preview) */
      }
    })();
  }, [checkTools, loadAccounts]);

  const missing = useMemo(() => needed(providers, tools).filter((t) => !t.installed), [providers, tools]);
  const loginTargets = useMemo(
    () => providers.map((p) => accounts.find((a) => a.provider === p && a.active)).filter((a) => a != null),
    [providers, accounts],
  );
  const notLoggedIn = loginTargets.filter((a) => !a.status.loggedIn);

  // auto-advance install → login → start
  useEffect(() => {
    if (!open) return;
    if (step === "install" && tools.length && !missing.length) {
      void loadAccounts();
      setStep("login");
    }
    if (step === "login" && loginTargets.length && !notLoggedIn.length) {
      setLoggingIn(null);
      setStep("start");
    }
  }, [open, step, tools.length, missing.length, loginTargets.length, notLoggedIn.length, loadAccounts]);

  // while signing in, keep checking
  useEffect(() => {
    if (step !== "login") return;
    const t = setInterval(() => void loadAccounts(), 3000);
    return () => clearInterval(t);
  }, [step, loadAccounts]);

  const finish = async (go: boolean) => {
    setBusy(true);
    try {
      await api.setPrefs(providers, true);
      if (go) {
        const title = name.trim() || "첫-프로젝트";
        const p = await createProject(title);
        if (p) {
          await startTeam(p.id);
          if (idea.trim()) await sendToLead(idea.trim());
        }
      }
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (p: Provider) => setProviders((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
  const current = missing[0];
  const stepIdx = STEPS.findIndex((s) => s.id === step);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="onboarding"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[70] flex items-center justify-center overflow-y-auto py-8"
          style={{ background: "linear-gradient(160deg, var(--bg1), var(--bg2))" }}
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute rounded-full" style={{ width: 560, height: 560, right: "6%", top: "-8%", background: "radial-gradient(closest-side, var(--blob1), transparent)" }} />
            <div className="absolute rounded-full" style={{ width: 460, height: 460, left: "-6%", bottom: "-12%", background: "radial-gradient(closest-side, var(--blob2), transparent)" }} />
          </div>

          <motion.section
            role="dialog"
            aria-label="Prism 시작하기"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={spring}
            className="glass relative flex w-[min(600px,calc(100%-32px))] flex-col gap-6 rounded-[26px] p-8 max-[820px]:w-[calc(100%-24px)] max-[820px]:gap-4 max-[820px]:p-5"
          >
            {/* progress */}
            <ol className="m-0 flex list-none items-center gap-2 p-0">
              {STEPS.map((s, i) => (
                <li key={s.id} className="flex flex-auto items-center gap-2">
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold"
                    style={{ background: i < stepIdx ? "var(--work)" : i === stepIdx ? "var(--amber)" : "var(--chip)", color: i <= stepIdx ? "#fff" : "var(--text2)" }}
                  >
                    {i < stepIdx ? "✓" : i + 1}
                  </span>
                  <span className="text-[12px] whitespace-nowrap" style={{ color: i === stepIdx ? "var(--text)" : "var(--text2)", fontWeight: i === stepIdx ? 600 : 400 }}>
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && <span className="h-px flex-auto" style={{ background: "var(--line)" }} />}
                </li>
              ))}
            </ol>

            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={spring} className="flex flex-col gap-5">
                {step === "pick" && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <h1 className="m-0 text-[24px] font-semibold">어떤 AI를 쓰고 계세요?</h1>
                      <p className="m-0 text-[13.5px] leading-relaxed text-ink-2">
                        지금 구독 중인 걸 골라주세요. 그 구독으로 AI 팀이 일해요. 추가 요금은 없어요.
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {SUBS.map((s) => {
                        const on = providers.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            role="checkbox"
                            aria-checked={on}
                            onClick={() => toggle(s.id)}
                            className="relative flex flex-col items-start gap-3 rounded-2xl p-5 text-left transition-transform active:scale-[0.98]"
                            style={{ background: on ? "var(--glass2)" : "transparent", border: `2px solid ${on ? "var(--amber)" : "var(--line)"}` }}
                          >
                            <span className="flex size-11 items-center justify-center rounded-xl text-[18px] font-bold" style={{ background: on ? "var(--amber)" : "var(--chip)", color: on ? "#2B2520" : "var(--text2)" }}>
                              {s.mark}
                            </span>
                            <span className="flex flex-col">
                              <span className="text-[16px] font-semibold">{s.title}</span>
                              <span className="text-[12px] text-ink-2">{s.sub}</span>
                            </span>
                            {on && <span className="absolute top-4 right-4 text-[15px]" style={{ color: "var(--amber)" }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                    <span className="text-[12px] text-ink-2">여러 개 쓰고 있다면 여러 개 골라도 돼요.</span>
                    <button
                      disabled={!providers.length}
                      onClick={() => {
                        void checkTools();
                        setStep("install");
                      }}
                      className="min-h-12 rounded-full border-0 text-[15px] font-semibold disabled:opacity-40"
                      style={{ background: "var(--amber)", color: "#2B2520", boxShadow: "0 12px 26px rgba(232,161,90,0.4)" }}
                    >
                      다음
                    </button>
                  </>
                )}

                {step === "install" && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <h1 className="m-0 text-[24px] font-semibold">필요한 걸 설치하고 있어요</h1>
                      <p className="m-0 text-[13.5px] leading-relaxed text-ink-2">손댈 건 없어요. 공식 설치 프로그램으로 알아서 설치해요. 몇 분 걸릴 수 있어요.</p>
                    </div>
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                      {needed(providers, tools).map((t) => {
                        const now = current?.name === t.name;
                        return (
                          <li key={t.name} className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: now ? "var(--glass2)" : "transparent", border: `1px solid ${now ? "var(--amber)" : "var(--line)"}` }}>
                            <span className={`flex size-6 items-center justify-center rounded-full text-[12px] font-bold ${now ? "s-work" : ""}`} style={{ background: t.installed ? "var(--work)" : now ? "var(--amber)" : "var(--chip)", color: "#fff" }}>
                              {t.installed ? "✓" : ""}
                            </span>
                            <span className="flex-auto text-[14px] font-medium">{t.label}</span>
                            <span className="text-[12px] text-ink-2">{t.installed ? "준비됨" : now ? "설치 중…" : "대기"}</span>
                          </li>
                        );
                      })}
                      {!tools.length && <span className="text-[13px] text-ink-2">확인하는 중…</span>}
                    </ul>
                    {current && (
                      <details className="text-[12px] text-ink-2">
                        <summary className="cursor-pointer select-none">설치 과정 보기</summary>
                        <div className="mt-2">
                          <Installer key={`${current.name}-${attempt}`} tool={current} onCheck={() => void checkTools()} />
                        </div>
                      </details>
                    )}
                    {current && (
                      <div className="flex gap-2">
                        <button onClick={() => setAttempt((n) => n + 1)} className="min-h-9 rounded-full px-4 text-[12.5px]" style={{ border: "1px solid var(--line)" }}>
                          다시 시도
                        </button>
                        <span className="flex-auto" />
                        <button onClick={() => setStep("pick")} className="min-h-9 rounded-full px-4 text-[12.5px] text-ink-2">
                          이전
                        </button>
                      </div>
                    )}
                  </>
                )}

                {step === "login" && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <h1 className="m-0 text-[24px] font-semibold">구독 계정으로 로그인해 주세요</h1>
                      <p className="m-0 text-[13.5px] leading-relaxed text-ink-2">평소 쓰는 계정으로 로그인하면 돼요. 브라우저가 열려요.</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      {loginTargets.map((a) => {
                        const sub = SUBS.find((s) => s.id === a.provider)!;
                        return (
                          <div key={a.id} className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ border: `1px solid ${a.status.loggedIn ? "var(--work)" : "var(--line)"}` }}>
                            <span className="flex size-9 items-center justify-center rounded-lg font-bold" style={{ background: "var(--chip)" }}>
                              {sub.mark}
                            </span>
                            <span className="flex flex-auto flex-col">
                              <span className="text-[14px] font-semibold">{sub.title}</span>
                              <span className="text-[12px] text-ink-2">{a.status.loggedIn ? (a.status.email ?? "로그인됨") : "아직 로그인 안 됨"}</span>
                            </span>
                            {a.status.loggedIn ? (
                              <span className="text-[13px] font-semibold" style={{ color: "var(--work-ink)" }}>
                                ✓ 완료
                              </span>
                            ) : (
                              <button
                                onClick={() => setLoggingIn(a.id)}
                                className="min-h-10 rounded-full border-0 px-5 text-[13.5px] font-semibold"
                                style={{ background: "var(--amber)", color: "#2B2520" }}
                              >
                                {sub.title}로 로그인
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {!loginTargets.length && <span className="text-[13px] text-ink-2">계정 확인 중…</span>}
                    </div>
                    {loggingIn && <LoginTerminal key={loggingIn} id={loggingIn} onDone={() => setLoggingIn(null)} />}
                  </>
                )}

                {step === "start" && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <h1 className="m-0 text-[24px] font-semibold">무엇을 만들어 볼까요?</h1>
                      <p className="m-0 text-[13.5px] leading-relaxed text-ink-2">하고 싶은 걸 평소 말하듯 적어주세요. AI 팀이 나눠서 만들고, 다 되면 결과를 보여드려요.</p>
                    </div>
                    <label className="flex flex-col gap-1.5">
                      <span className="sr-only">만들고 싶은 것</span>
                      <textarea
                        value={idea}
                        onChange={(e) => setIdea(e.target.value)}
                        rows={4}
                        autoFocus
                        placeholder="예) 우리 가게 소개 웹페이지 만들어줘. 메뉴랑 위치, 영업시간이 들어가면 좋겠어."
                        className="resize-none rounded-2xl p-4 text-[14px] leading-relaxed outline-none"
                        style={{ background: "var(--tile)", border: "1px solid var(--line)", color: "var(--text)" }}
                      />
                    </label>
                    <label className="flex items-center gap-3 text-[13px]">
                      <span className="shrink-0 text-ink-2">프로젝트 이름</span>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="첫-프로젝트"
                        className="min-h-10 min-w-0 flex-auto rounded-xl px-3 outline-none"
                        style={{ background: "var(--tile)", border: "1px solid var(--line)", color: "var(--text)" }}
                      />
                    </label>
                    <button
                      disabled={busy || !idea.trim()}
                      onClick={() => void finish(true)}
                      className="min-h-12 rounded-full border-0 text-[15px] font-semibold disabled:opacity-40"
                      style={{ background: "var(--amber)", color: "#2B2520", boxShadow: "0 12px 26px rgba(232,161,90,0.4)" }}
                    >
                      {busy ? "팀을 부르는 중…" : "AI 팀에게 맡기기"}
                    </button>
                    <button onClick={() => void finish(false)} disabled={busy} className="text-[12.5px] text-ink-2 underline underline-offset-2">
                      {projects.length ? "기존 프로젝트로 갈게요" : "나중에 할게요"}
                    </button>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
