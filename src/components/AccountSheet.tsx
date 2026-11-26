import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useApp } from "../store";
import { api, pty, type Account, type CliStatus, type Provider } from "../lib/api";
import { TerminalView } from "./TerminalView";
import { ConnectPanel } from "./ConnectPanel";
import { PROVIDER_NAME } from "../lib/topAccount";
import { isRemote } from "../lib/transport";
import { useShallow } from "zustand/react/shallow";

const spring = { type: "spring" as const, stiffness: 300, damping: 30 };

export function initialOf(a?: Account) {
  return (a?.status.email ?? a?.name ?? "?").charAt(0).toUpperCase();
}

const PROVIDER_INFO: Record<Provider, { title: string; sub: string; cli: string }> = {
  claude: { title: "Claude", sub: "Claude 구독 (Pro · Max)", cli: "claude" },
  codex: { title: "Codex", sub: "ChatGPT 구독 (Plus · Pro)", cli: "codex" },
  antigravity: { title: "Gemini", sub: "Google AI Pro · Ultra 구독 (Antigravity)", cli: "agy" },
};

/** API-key logins bill per use — this app is subscription-first, so call it out. */
function isApiBilled(a: Account) {
  if (!a.status.loggedIn) return false;
  if (a.provider === "claude") return a.status.authMethod !== "claude.ai";
  if (a.provider === "codex") return a.status.authMethod === "api_key";
  return false;
}

function planLabel(a: Account) {
  const s = a.status;
  if (s.authMethod === "missing") return "로그인 안 됨 · 연결을 누르면 필요한 프로그램부터 설치해요";
  if (!s.loggedIn) return "로그인 안 됨";
  if (isApiBilled(a)) return "사용량만큼 요금 청구";
  if (a.provider === "codex") return "ChatGPT 구독";
  if (a.provider === "antigravity") return "Google 계정";
  const plan = s.subscriptionType ? s.subscriptionType.toUpperCase() : null;
  return `구독${plan ? ` · ${plan}` : ""}`;
}

function Row({ a, onConnect, children }: { a: Account; onConnect: (a: Account) => void; children?: ReactNode }) {
  const { loadAccounts, setError } = useApp(useShallow((s) => ({ loadAccounts: s.loadAccounts, setError: s.setError })));
  const [confirm, setConfirm] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await loadAccounts();
    } catch (e) {
      setError(e);
    }
  };
  const ok = a.status.loggedIn;
  const [leaving, setLeaving] = useState(false);
  const logout = async () => {
    setLeaving(true);
    await act(() => api.logoutAccount(a.id));
    setLeaving(false);
  };
  const outline = "min-h-8 shrink-0 rounded-full bg-transparent px-3 text-[12.5px] whitespace-nowrap disabled:opacity-60";
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={spring} className="list-none">
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3.5 py-3"
        style={{ background: a.active ? "var(--glass2)" : "transparent", border: `1.5px solid ${a.active ? "var(--navy)" : "var(--line)"}` }}
      >
        <button
          role="radio"
          aria-checked={a.active}
          aria-label={`${a.name} 사용`}
          onClick={() => !a.active && act(() => api.setActiveAccount(a.id))}
          className="relative flex size-10 shrink-0 items-center justify-center rounded-full border-0 text-[15px] font-semibold"
          style={{ background: ok ? "var(--navy)" : "var(--chip)", color: ok ? "var(--me-fg)" : "var(--text2)" }}
        >
          {initialOf(a)}
          <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full" style={{ background: ok ? "var(--work)" : "var(--done)", border: "2px solid var(--bg2)" }} />
        </button>
        <div className="flex min-w-[150px] flex-1 flex-col">
          <span className="flex items-center gap-2 text-[14px] font-semibold">
            {a.name}
            {a.active && (
              <span className="rounded-full px-2 py-px text-[10.5px] font-medium" style={{ background: "var(--chip)", color: "var(--navy)" }}>
                사용 중
              </span>
            )}
          </span>
          {ok && (
            <span className="truncate text-[12px] font-semibold" style={{ color: "var(--work-ink)" }}>
              로그인됨: {PROVIDER_NAME[a.provider]}
            </span>
          )}
          <span className="truncate text-[12px] text-ink-2">
            {a.status.email ? `${a.status.email} · ` : ""}
            {planLabel(a)}
          </span>
        </div>
        {!a.active && (
          <button onClick={() => act(() => api.setActiveAccount(a.id))} className={outline} style={{ border: "1px solid var(--line)" }}>
            이 계정 쓰기
          </button>
        )}
        {ok ? (
          <>
            {/* Antigravity switches and signs out inside its own screen */}
            {a.provider !== "antigravity" && (
              <>
                <button disabled={leaving} onClick={() => onConnect(a)} className={outline} style={{ border: "1px solid var(--line)" }}>
                  계정 바꾸기
                </button>
                <button disabled={leaving} onClick={() => void logout()} className={outline} style={{ border: "1px solid var(--line)" }}>
                  {leaving ? "로그아웃 중…" : "로그아웃"}
                </button>
              </>
            )}
          </>
        ) : (
          <button onClick={() => onConnect(a)} className="min-h-9 shrink-0 rounded-full border-0 px-4 text-[13px] font-semibold whitespace-nowrap" style={{ background: "var(--amber)", color: "#2B2520" }}>
            {PROVIDER_NAME[a.provider]} 연결
          </button>
        )}
        {a.dir !== null &&
          (confirm ? (
            <button onClick={() => act(() => api.removeAccount(a.id))} onBlur={() => setConfirm(false)} className="min-h-8 shrink-0 rounded-full border-0 px-3 text-[12px] whitespace-nowrap" style={{ background: "var(--block)", color: "#fff" }}>
              지우기
            </button>
          ) : (
            <button onClick={() => setConfirm(true)} aria-label={`${a.name} 계정 지우기`} className="flex size-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-ink-2">
              ×
            </button>
          ))}
      </div>
      {a.active && isApiBilled(a) && (
        <p className="m-0 mt-1.5 px-1 text-[11.5px]" style={{ color: "var(--block-ink)" }}>
          이 계정은 쓴 만큼 요금이 청구되는 방식이라 AI가 일한 만큼 실제 비용이 나가요.
        </p>
      )}
      {children && <div className="mt-2">{children}</div>}
    </motion.li>
  );
}

/** Runs the vendor's official installer in a visible terminal; closes once the CLI answers. */
function InstallTerminal({ name, onDone, onClose }: { name: Provider; onDone: () => void; onClose: () => void }) {
  const [ptyId, setPtyId] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    let started: number | null = null;
    const timer = setTimeout(() => {
      api
        .cliInstall(PROVIDER_INFO[name].cli, 92, 18)
        .then((p) => {
          started = p;
          if (alive) setPtyId(p);
          else void pty.kill(p);
        })
        .catch((e) => useApp.getState().setError(e));
    }, 150); // one install, even when React (dev) runs this effect twice
    const t = setInterval(() => {
      void api.cliStatus().then((list) => {
        if (list.find((c) => c.name === PROVIDER_INFO[name].cli)?.installed) setDone(true);
      });
    }, 3000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(t);
      if (started != null) void pty.kill(started);
    };
  }, [name]);
  useEffect(() => {
    if (!done) return;
    void useApp.getState().loadAccounts();
    const t = setTimeout(onDone, 1500);
    return () => clearTimeout(t);
  }, [done, onDone]);
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-[13px]">
        {done ? (
          <span className="font-semibold" style={{ color: "var(--work-ink)" }}>
            ✓ {PROVIDER_INFO[name].title} 설치 완료 · 이제 로그인하면 돼요
          </span>
        ) : (
          <>
            <span className="s-work size-2 rounded-full" style={{ background: "var(--amber)" }} />
            <span className="flex-auto">{PROVIDER_INFO[name].title} 프로그램을 설치하는 중…</span>
            <button onClick={onClose} className="text-[12px] text-ink-2 underline">
              닫기
            </button>
          </>
        )}
      </div>
      <details className="text-[12px] text-ink-2">
        <summary className="cursor-pointer select-none">설치 과정 보기</summary>
        <div className="mt-2 h-[220px] rounded-xl p-3" style={{ background: "var(--term-bg)" }}>
          {ptyId != null && <TerminalView ptyId={ptyId} fontSize={12} className="h-full w-full" />}
        </div>
      </details>
    </motion.div>
  );
}

function CliLine({ cli, onInstall }: { cli?: CliStatus; onInstall: () => void }) {
  if (!cli) return null;
  if (!cli.installed)
    return (
      <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: "var(--block-bg)", border: "1px solid var(--block)" }}>
        <span className="flex-auto">AI 프로그램이 설치돼 있지 않아요</span>
        <button onClick={onInstall} className="min-h-8 rounded-full border-0 px-3.5 text-[12.5px] font-semibold whitespace-nowrap" style={{ background: "var(--amber)", color: "#2B2520" }}>
          설치
        </button>
      </div>
    );
  return (
    <span className="px-1 font-mono text-[11px] text-ink-2">
      {cli.name} {cli.version}
      {cli.note ? ` · ${cli.note}` : ""}
    </span>
  );
}

const SUBS: { id: Provider; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "ChatGPT (Codex)" },
  { id: "antigravity", label: "Google (Gemini)" },
];

/** Which subscriptions the user has: new teams run on Claude when it's one of them. */
function Subscriptions({ open }: { open: boolean }) {
  const setError = useApp((s) => s.setError);
  const [mine, setMine] = useState<Provider[] | null>(null);
  useEffect(() => {
    if (!open) return;
    void api.prefs().then((p) => setMine(p.providers)).catch(() => setMine([]));
  }, [open]);
  if (!mine) return null;
  const toggle = async (id: Provider) => {
    const next = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id];
    if (!next.length) return; // keep at least one
    setMine(next);
    try {
      await api.setPrefs(next, true);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl px-3.5 py-3" style={{ background: "var(--chip)" }}>
      <span className="text-[12.5px] font-semibold">쓰는 구독</span>
      <div className="flex flex-wrap gap-1.5">
        {SUBS.map((s) => {
          const on = mine.includes(s.id);
          return (
            <button
              key={s.id}
              onClick={() => void toggle(s.id)}
              aria-pressed={on}
              className="flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium"
              style={{ background: on ? "var(--tile)" : "transparent", border: `1px solid ${on ? "var(--amber)" : "var(--line)"}` }}
            >
              {on && <span aria-hidden="true">✓</span>}
              {s.label}
            </button>
          );
        })}
      </div>
      <span className="text-[11.5px] leading-relaxed text-ink-2">
        새로 만드는 팀은 Claude가 있으면 Claude로, 없으면 고른 구독으로 일해요. 로그인한 구독은 자동으로 추가돼요. 이미 있는 팀은 팀 설정에서 바꿔요.
      </span>
    </div>
  );
}

export function AccountSheet() {
  const { accountSheet, accounts, closeAccounts, loadAccounts, setError } = useApp(useShallow((s) => ({ accountSheet: s.accountSheet, accounts: s.accounts, closeAccounts: s.closeAccounts, loadAccounts: s.loadAccounts, setError: s.setError })));
  const [loginId, setLoginId] = useState<string | null>(null);
  const [pressed, setPressed] = useState(0);
  const [installing, setInstalling] = useState<Provider | null>(null);
  /** account to sign in to once its program is installed */
  const [afterInstall, setAfterInstall] = useState<string | null>(null);
  const [clis, setClis] = useState<CliStatus[]>([]);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!accountSheet) return;
    void api.cliStatus().then(setClis).catch(() => {});
    void api.cliAutoUpdate().then(setAutoUpdate).catch(() => {});
    let off: (() => void) | undefined;
    let gone = false;
    void api.onCliStatus(setClis).then((u) => (gone ? u() : (off = u)));
    return () => {
      gone = true;
      off?.();
    };
  }, [accountSheet, installing]);
  const [adding, setAdding] = useState<Provider | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!accountSheet) {
      setLoginId(null);
      setAdding(null);
      setInstalling(null);
      setAfterInstall(null);
    }
  }, [accountSheet]);

  // one button: switch to the account, install its program if needed, then sign in
  const connect = async (a: Account) => {
    try {
      if (!a.active) await api.setActiveAccount(a.id);
      if (a.status.authMethod === "missing") {
        setLoginId(null);
        setAfterInstall(a.id);
        setInstalling(a.provider);
      } else {
        setInstalling(null);
        setPressed((n) => n + 1); // pressing again starts over
        setLoginId(a.id);
      }
    } catch (e) {
      setError(e);
    }
  };
  const closeLogin = useCallback(() => setLoginId(null), []);

  const add = async () => {
    if (!name.trim() || !adding) return;
    try {
      const id = await api.addAccount(adding, name.trim());
      await api.setActiveAccount(id);
      await loadAccounts();
      setName("");
      setAdding(null);
      const added = useApp.getState().accounts.find((a) => a.id === id);
      if (added) await connect(added);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <AnimatePresence>
      {accountSheet && (
        <motion.div
          key="sheet"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-start justify-center pt-[10vh] max-[820px]:items-end max-[820px]:pt-0"
          style={{ background: "rgba(30,24,18,0.32)", backdropFilter: "blur(6px)" }}
          onMouseDown={(e) => e.target === e.currentTarget && closeAccounts()}
        >
          <motion.section
            role="dialog"
            aria-label="계정"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={spring}
            className="glass flex max-h-[78vh] w-[min(560px,calc(100%-32px))] flex-col gap-4 overflow-y-auto rounded-[22px] p-6 max-[820px]:max-h-[92dvh] max-[820px]:w-full max-[820px]:overflow-y-auto max-[820px]:rounded-b-none max-[820px]:p-4 max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))]"
            style={{ background: "color-mix(in srgb, var(--bg2) 94%, transparent)" }}
          >
            <header className="flex items-start gap-3">
              <div className="flex flex-auto flex-col gap-1">
                <h2 className="m-0 text-[19px] font-semibold">계정</h2>
                <span className="text-[12.5px] leading-relaxed text-ink-2">
                  AI는 서비스마다 <b>사용 중</b>인 계정으로 일해요. 모두 구독 로그인이라 따로 청구되지 않아요.
                </span>
              </div>
              <button onClick={closeAccounts} aria-label="닫기" className="flex size-8 items-center justify-center rounded-full border-0 bg-transparent text-[18px] text-ink-2">
                ×
              </button>
            </header>

            {isRemote && (
              <div className="rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: "var(--chip)" }}>
                다른 기기에서 보는 중이에요. 계정 로그인·설치는 Mac에서 해주세요.
              </div>
            )}
            <Subscriptions open={!!accountSheet} />

            {accountSheet.reason && (
              <div className="rounded-xl px-3.5 py-2.5 text-[13px]" style={{ background: "rgba(232,161,90,0.14)", border: "1px solid var(--amber)" }}>
                {accountSheet.reason}
              </div>
            )}

            {(["claude", "codex", "antigravity"] as Provider[])
              .sort((x, y) => Number(y === accountSheet.provider) - Number(x === accountSheet.provider))
              .map((prov) => (
                <div key={prov} className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2 px-1">
                    <h3 className="m-0 text-[13.5px] font-semibold">{PROVIDER_INFO[prov].title}</h3>
                    <span className="flex-auto text-[11.5px] text-ink-2">{PROVIDER_INFO[prov].sub}</span>
                    {adding !== prov && (
                      <button onClick={() => setAdding(prov)} className="text-[11.5px] text-ink-2 underline underline-offset-2">
                        + 계정 추가
                      </button>
                    )}
                  </div>
                  <CliLine cli={clis.find((c) => c.name === PROVIDER_INFO[prov].cli)} onInstall={() => setInstalling(prov)} />
                  <ul role="radiogroup" aria-label={`${PROVIDER_INFO[prov].title} 계정`} className="m-0 flex flex-col gap-2 p-0">
                    <AnimatePresence initial={false}>
                      {accounts
                        .filter((a) => a.provider === prov)
                        .map((a) => (
                          <Row key={a.id} a={a} onConnect={(x) => void connect(x)}>
                            {loginId === a.id && <ConnectPanel key={pressed} id={a.id} onClose={closeLogin} />}
                          </Row>
                        ))}
                    </AnimatePresence>
                  </ul>
                </div>
              ))}
            {accounts.length === 0 && <span className="text-[12.5px] text-ink-2">계정 상태를 확인하는 중…</span>}

            <AnimatePresence mode="wait">
              {installing ? (
                <InstallTerminal
                  key={`install-${installing}`}
                  name={installing}
                  onDone={() => {
                    setInstalling(null);
                    setLoginId(afterInstall);
                    setAfterInstall(null);
                  }}
                  onClose={() => {
                    setInstalling(null);
                    setAfterInstall(null);
                  }}
                />
              ) : adding ? (
                <motion.form
                  key="add"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void add();
                  }}
                  className="flex items-center gap-2 rounded-xl p-2 pl-4"
                  style={{ background: "var(--chip)" }}
                >
                  <label className="flex min-w-0 flex-auto">
                    <span className="sr-only">계정 이름</span>
                    <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`${adding ? PROVIDER_INFO[adding].title : ""} 계정 이름 (예: 회사, 개인)`} className="min-h-9 min-w-0 flex-auto border-0 bg-transparent text-[13.5px] outline-none" />
                  </label>
                  <button type="button" onClick={() => setAdding(null)} className="min-h-9 shrink-0 rounded-lg border-0 bg-transparent px-3 text-[13px] whitespace-nowrap text-ink-2">
                    취소
                  </button>
                  <button type="submit" disabled={!name.trim()} className="min-h-9 shrink-0 rounded-lg border-0 px-4 text-[13px] font-semibold whitespace-nowrap disabled:opacity-50" style={{ background: "var(--amber)", color: "#2B2520" }}>
                    추가하고 연결
                  </button>
                </motion.form>
              ) : (
                null
              )}
            </AnimatePresence>
            <div className="flex items-center gap-3 rounded-xl px-3.5 py-3" style={{ background: "var(--chip)" }}>
              <div className="flex flex-auto flex-col">
                <span className="text-[13px] font-semibold">AI 프로그램 자동 업데이트</span>
                <span className="text-[11.5px] text-ink-2">앱을 켤 때와 6시간마다 Claude·Codex 프로그램을 최신 버전으로. 팀이 일하는 중엔 건너뛰어요.</span>
              </div>
              <button
                onClick={async () => {
                  setUpdating(true);
                  try {
                    setClis(await api.cliUpdateNow());
                  } finally {
                    setUpdating(false);
                  }
                }}
                disabled={updating}
                className="min-h-8 shrink-0 rounded-full px-3 text-[12px] whitespace-nowrap disabled:opacity-60"
                style={{ border: "1px solid var(--line)" }}
              >
                {updating ? "확인 중…" : "지금 업데이트"}
              </button>
              <button
                role="switch"
                aria-checked={autoUpdate}
                aria-label="AI 프로그램 자동 업데이트"
                onClick={() => {
                  const on = !autoUpdate;
                  setAutoUpdate(on);
                  void api.setCliAutoUpdate(on);
                }}
                className="relative h-7 w-12 shrink-0 rounded-full border-0 p-0 transition-colors duration-200"
                style={{ background: autoUpdate ? "var(--amber)" : "var(--line)" }}
              >
                <motion.span layout transition={spring} className="absolute top-1 size-5 rounded-full" style={{ left: autoUpdate ? 24 : 4, background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.18)" }} />
              </button>
            </div>
            {/* which version this is — people report "I still see the old one" */}
            <span className="shrink-0 text-center font-mono text-[11.5px] text-ink-2 select-text">Prism {__APP_VERSION__}</span>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
