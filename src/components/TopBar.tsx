import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/api";
import { isLive, useApp } from "../store";
import { initialOf } from "./AccountSheet";
import { PROVIDER_NAME, topAccount, topAccountName } from "../lib/topAccount";
import { isRemote } from "../lib/transport";
import { Book, Moon, PanelLeft, PanelRight, Phone, Plus, Sun } from "./icons";
import { KnowledgeSheet } from "./KnowledgeSheet";
import { ShopSheet } from "./ShopSheet";
import { RemoteCard } from "./RemoteCard";
import { useShallow } from "zustand/react/shallow";


const iconBtn = "flex size-9 items-center justify-center rounded-[10px] border-0 bg-transparent hover:bg-[var(--chip)]";

function remainingColor(left: number) {
  return left > 40 ? "var(--work)" : left > 15 ? "var(--amber)" : "var(--block)";
}

function resetText(v: string | number | null) {
  if (v == null) return "";
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  if (mins <= 0) return "곧 다시 채워져요";
  if (mins < 60) return `${mins}분 뒤 다시 채워져요`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}시간 ${mins % 60}분 뒤 다시 채워져요`;
  return `${d.toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" })} 다시 채워져요`;
}

const USAGE_NAME: Record<string, string> = { claude: "Claude", codex: "Codex", antigravity: "Gemini" };

function Bar({ left, w = 48 }: { left: number; w?: number }) {
  return (
    <span className="flex h-1.5 overflow-hidden rounded-full" style={{ width: w, background: "var(--line)" }}>
      <span className="rounded-full transition-[width] duration-700" style={{ width: `${left}%`, background: remainingColor(left) }} />
    </span>
  );
}

/** How long the bar says "확인 중" before it admits the fetch failed. */
const USAGE_WAIT_MS = 20_000;

/** Pick up what the engine has (it refreshes every 5 minutes), in case an update never reached us. */
const readUsage = () => api.usage().then((usage) => useApp.setState({ usage })).catch(() => {});

/** Remaining subscription usage: Claude in the bar, every provider in the popover. */
function UsageMeter() {
  const usage = useApp((s) => s.usage);
  const [open, setOpen] = useState(false);
  const [waiting, setWaiting] = useState<"first" | "retry" | null>("first");
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setWaiting(null), USAGE_WAIT_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  useEffect(() => {
    const t = setInterval(() => void readUsage(), 60_000);
    return () => clearInterval(t);
  }, []);
  const refresh = () => {
    void api
      .refreshUsage()
      .catch(() => {})
      .then(readUsage)
      .finally(() => setWaiting(null));
  };
  const order = ["claude", "codex", "antigravity"];
  const list = [...usage].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
  const main = list.find((u) => u.windows.length) ;
  const shown = (main?.windows ?? []).slice(0, 2);
  // the first fetch is over once Claude has answered; others may arrive before it
  const pending = !main && (waiting === "retry" || (waiting === "first" && !list.some((u) => u.provider === "claude")));
  const failed = !main && !pending;
  const retry = () => {
    setWaiting("retry");
    refresh();
  };

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (failed) retry();
          else refresh();
        }}
        aria-expanded={open}
        aria-label={failed ? "구독 사용량을 못 가져왔어요. 다시 시도" : "구독 남은 사용량"}
        className="glass flex min-h-9 max-w-full items-center gap-x-3 rounded-full px-3.5 max-[820px]:gap-x-2 max-[820px]:px-3"
      >
        {shown.length ? (
          <>
            <span className="text-[11.5px] font-semibold">{USAGE_NAME[main!.provider]}</span>
            {shown.map((w, i) => {
              const left = Math.max(0, 100 - w.usedPercent);
              return (
                <span key={w.id} className={`items-center gap-1.5 ${i > 0 ? "flex max-[820px]:hidden" : "flex"}`}>
                  <span className="text-[11.5px] text-ink-2 max-[820px]:hidden">{w.label}</span>
                  <Bar left={left} />
                  <span className="font-mono text-[12px] font-medium">{Math.round(left)}%</span>
                </span>
              );
            })}
          </>
        ) : pending ? (
          <span className="text-xs text-ink-2">구독 사용량 확인 중…</span>
        ) : (
          <span className="flex items-center gap-1 text-xs whitespace-nowrap text-ink-2">
            <span aria-hidden="true" style={{ color: "var(--block)" }}>⚠</span>
            <span className="max-[820px]:hidden">사용량을 못 가져왔어요</span>
            <span className="min-[821px]:hidden">사용량 실패</span>
            <span className="font-semibold underline">(다시 시도)</span>
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <div aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-0 z-40 hidden bg-black/25 max-[820px]:block" />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div
            data-covers-web
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            className="absolute top-11 right-0 z-50 flex w-[320px] max-w-[calc(100vw-24px)] flex-col max-[820px]:fixed max-[820px]:inset-x-0 max-[820px]:top-auto max-[820px]:bottom-0 max-[820px]:w-auto max-[820px]:max-w-none max-[820px]:rounded-b-none max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))] gap-3 rounded-2xl p-4"
            style={{ background: "color-mix(in srgb, var(--bg2) 96%, transparent)", border: "1px solid var(--glass-border)", boxShadow: "var(--shadow)" }}
          >
            <span className="text-[13px] font-semibold">구독 남은 사용량</span>
            {list.length === 0 && <span className="text-xs text-ink-2">{pending ? "확인 중…" : "사용량을 못 가져왔어요"}</span>}
            {list.map((u) => (
              <div key={u.provider} className="flex flex-col gap-1.5">
                <span className="flex items-baseline gap-2 text-[12.5px] font-semibold">
                  {USAGE_NAME[u.provider] ?? u.provider}
                  {u.plan && <span className="font-mono text-[10.5px] font-normal text-ink-2 uppercase">{u.plan}</span>}
                </span>
                {u.windows.length === 0 && <span className="text-[11.5px] text-ink-2">{u.note ?? "정보 없음"}</span>}
                {u.windows.map((w) => {
                  const left = Math.max(0, 100 - w.usedPercent);
                  return (
                    <span key={w.id} className="flex flex-wrap items-center gap-x-2 text-[12px]">
                      <span className="w-20 shrink-0 text-ink-2">{w.label}</span>
                      <Bar left={left} w={90} />
                      <span className="w-10 shrink-0 text-right font-mono font-medium">{Math.round(left)}%</span>
                      <span className="min-w-0 truncate text-[10.5px] text-ink-2 max-[820px]:basis-full max-[820px]:whitespace-normal">{resetText(w.resetsAt)}</span>
                    </span>
                  );
                })}
              </div>
            ))}
            {failed && (
              <button onClick={retry} className="min-h-8 cursor-pointer rounded-lg border-0 text-[12.5px] font-medium" style={{ background: "var(--chip)" }}>
                다시 시도
              </button>
            )}
            <span className="text-[10.5px] text-ink-2">5분마다 갱신 · 누를 때마다 새로 확인해요</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Open the whole 관제탑 on a phone: one QR for the app (every team), not per team. */
function PhoneAccess() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="휴대폰이나 다른 기기에서 이 관제탑 보기"
        className="flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium"
        style={open ? { background: "var(--amber)", color: "#2B2520" } : { border: "1px solid var(--line)" }}
      >
        <Phone size={15} />
        폰으로 보기
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="다른 기기에서 접속"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="absolute top-[calc(100%+8px)] right-0 z-50 w-[400px] max-w-[calc(100vw-24px)] origin-top-right rounded-2xl p-5 max-[820px]:fixed max-[820px]:inset-x-0 max-[820px]:top-auto max-[820px]:bottom-0 max-[820px]:w-auto max-[820px]:max-w-none max-[820px]:rounded-b-none max-[820px]:pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            style={{ background: "color-mix(in srgb, var(--bg2) 97%, transparent)", border: "1px solid var(--glass-border)", boxShadow: "var(--shadow)" }}
          >
            <RemoteCard bare />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 지식: notes every AI reads before it starts (shared + per project). */
function KnowledgeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="모든 AI가 참고할 메모 (서버 정보, 규칙…)" aria-label="지식"
        className="flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium"
        style={{ border: "1px solid var(--line)" }}
      >
        <Book size={15} />
        <span className="max-[820px]:hidden">지식</span>
      </button>
      <KnowledgeSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** 츄르 잔액 버튼: 누르면 상점이 열린다 */
function ChurruButton() {
  const churu = useApp((s) => s.churu);
  return (
    <div className="relative flex">
      <button
        onClick={() => useApp.getState().openShop(true)}
        aria-label={`츄르 상점 (잔액 ${churu}개)`}
        title="츄르로 고양이 털색과 휴게실 물건을 사요"
        className="flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium"
        style={{ border: "1px solid var(--line)" }}
      >
        <span aria-hidden="true">🐟</span>
        <span className="font-mono">{churu.toLocaleString("ko-KR")}</span>
        <span className="max-[820px]:hidden">츄르</span>
      </button>
      <RewardFlash />
      <ShopSheet />
    </div>
  );
}

const REWARD_MS = 2600;
const REWARD_WORD = { attend: "출석", card: "작업 완료", pet: "고양이", gift: "선물" } as const;

/** 츄르를 받으면 잔액 옆에 '+N 출석'이 잠깐 뜬다 (여러 개면 하나씩) */
function RewardFlash() {
  const note = useApp((s) => s.rewardNotes[0]);
  const id = note?.id;
  useEffect(() => {
    if (id === undefined) return;
    const t = window.setTimeout(() => useApp.getState().dropReward(id), REWARD_MS);
    return () => window.clearTimeout(t);
  }, [id]);
  const week = note?.kind === "attend" && note.streak % 7 === 0;
  return (
    <span role="status" className="pointer-events-none absolute top-1/2 right-[calc(100%+6px)] z-40 -translate-y-1/2 max-[820px]:top-[calc(100%+6px)] max-[820px]:right-0 max-[820px]:translate-y-0">
      <AnimatePresence mode="wait">
        {note && (
          <motion.span
            key={note.id}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="block rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap"
            style={{ background: "var(--amber)", color: "#2B2520", boxShadow: "var(--shadow)" }}
          >
            +{note.amount} {note.gift?.label ?? REWARD_WORD[note.kind]}
            {week ? ` · ${note.streak}일 연속 보너스` : note.kind === "attend" && note.streak > 1 ? ` · ${note.streak}일 연속` : ""}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** 관제탑 맨 위 탭: 사무실 · 대시보드 (사무실 탭 옆) */
function MainTabs() {
  const tab = useApp((s) => s.mainTab);
  const setMainTab = useApp((s) => s.setMainTab);
  const items = [
    { id: "office", label: "🏢 사무실" },
    { id: "dashboard", label: "📊 대시보드" },
  ] as const;
  return (
    <div role="tablist" aria-label="보기 방식" className="glass flex gap-0.5 rounded-full p-1">
      {items.map((t) => {
        const on = tab === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => setMainTab(t.id)}
            className="min-h-8 rounded-full border-0 px-3.5 text-[12.5px] font-medium"
            style={on ? { background: "var(--amber)", color: "#2B2520" } : { background: "transparent", color: "var(--text)" }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Clock in another team: its 총괄 joins the stack on the left. */
function AddTeam() {
  const go = useApp((s) => s.go);
  return (
    <button onClick={() => go({ name: "home" })} title="다른 팀도 출근시키기" aria-label="팀 추가" className="flex min-h-[34px] items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-[var(--chip)]">
      <Plus size={15} />
      <span className="max-[820px]:hidden">팀 추가</span>
    </button>
  );
}

/** Clock in every team that isn't in yet (shown while some team is at work). */
function ClockInAll() {
  const show = useApp((s) => s.projects.some((p) => !isLive(s.teams[p.id])) && s.projects.some((p) => isLive(s.teams[p.id])));
  const busy = useApp((s) => s.clockingIn);
  if (!show) return null;
  return (
    <button disabled={busy} onClick={() => void useApp.getState().clockInAll()} title="아직 출근하지 않은 팀을 모두 출근시켜요" className="flex min-h-[34px] items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-[var(--chip)] disabled:opacity-60 max-[820px]:hidden">
      {busy ? "출근시키는 중…" : "모두 출근"}
    </button>
  );
}

export function TopBar() {
  const { dark, left, right, view, toggleDark, toggleLeft, toggleRight, accounts, openAccounts } = useApp(useShallow((s) => ({ dark: s.dark, left: s.left, right: s.right, view: s.view, toggleDark: s.toggleDark, toggleLeft: s.toggleLeft, toggleRight: s.toggleRight, accounts: s.accounts, openAccounts: s.openAccounts })));
  const account = topAccount(accounts);
  const hasProject = useApp((s) => !!s.projectId);
  const onHome = view.name === "home";

  // team things (preset, settings, clock-out, alerts) live in each 총괄's header now
  return (
    // left padding keeps clear of the macOS traffic lights
    <header
      data-tauri-drag-region
      className={`relative flex min-h-[52px] shrink-0 flex-wrap items-center gap-2 max-[820px]:flex-nowrap max-[820px]:gap-1 py-1.5 pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.375rem,env(safe-area-inset-top))] ${isRemote ? "pl-[max(1rem,env(safe-area-inset-left))]" : "pl-[88px]"}`}
      style={{ borderBottom: "1px solid var(--line)" }}
    >
      {!onHome && (
        <button onClick={toggleLeft} aria-label="총괄 대화창 접기/펴기" aria-pressed={left} className={`${iconBtn} max-[820px]:hidden`}>
          <PanelLeft />
        </button>
      )}
      {hasProject && !onHome && <AddTeam />}
      {!onHome && <ClockInAll />}
      {view.name === "main" && <MainTabs />}

      <div data-tauri-drag-region className="flex-auto self-stretch" />

      <ChurruButton />
      <KnowledgeButton />
      {!isRemote && <PhoneAccess />}
      <UsageMeter />
      <button
        onClick={() => openAccounts()}
        aria-label={`계정: ${account ? `${PROVIDER_NAME[account.provider]} ${account.status.email ?? account.name}` : "확인 중"}${account?.status.loggedIn ? "" : " (로그인 필요)"}`}
        title={account?.status.email ?? (account ? `${PROVIDER_NAME[account.provider]} 계정` : "계정")}
        className="flex min-h-9 items-center gap-2 rounded-full py-1 pr-3 pl-1 hover:bg-[var(--chip)] max-[820px]:pr-1"
      >
        <span
          className="relative flex size-7 items-center justify-center rounded-full text-[12px] font-semibold"
          style={{ background: account?.status.loggedIn ? "var(--navy)" : "var(--chip)", color: account?.status.loggedIn ? "var(--me-fg)" : "var(--text2)" }}
        >
          {initialOf(account?.status.loggedIn ? { ...account, name: topAccountName(account) } : account)}
          <span
            className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full"
            style={{ background: account?.status.loggedIn ? "var(--work)" : "var(--block)", border: "2px solid var(--bg2)" }}
          />
        </span>
        <span className="max-w-[120px] truncate text-[12.5px] max-[820px]:hidden">{account ? (account.status.loggedIn ? topAccountName(account) : "로그인 필요") : "계정"}</span>
      </button>
      <button onClick={toggleDark} aria-label={dark ? "라이트 모드로" : "다크 모드로"} className={iconBtn}>
        {dark ? <Sun /> : <Moon />}
      </button>
      {!onHome && (
        <button onClick={toggleRight} aria-label="작업 보드 접기/펴기" aria-pressed={right} className={`${iconBtn} max-[820px]:hidden`}>
          <PanelRight />
        </button>
      )}
    </header>
  );
}
