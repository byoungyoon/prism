import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/api";
import { useApp, useCurrent } from "../store";
import type { PresetName } from "../lib/api";
import { initialOf } from "./AccountSheet";
import { isRemote } from "../lib/transport";
import { Bell, Branch, ChevronDown, Moon, PanelLeft, PanelRight, Sun } from "./icons";

const PRESETS: { id: PresetName; label: string }[] = [
  { id: "save", label: "절약" },
  { id: "bal", label: "균형" },
  { id: "power", label: "파워" },
];

const iconBtn = "flex size-9 items-center justify-center rounded-[10px] border-0 bg-transparent hover:bg-[var(--chip)]";

const Gear = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const Power = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2v10" />
    <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
  </svg>
);

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

/** Remaining subscription usage: Claude in the bar, every provider in the popover. */
function UsageMeter() {
  const usage = useApp((s) => s.usage);
  const [open, setOpen] = useState(false);
  const order = ["claude", "codex", "antigravity"];
  const list = [...usage].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
  const main = list.find((u) => u.windows.length) ;
  const shown = (main?.windows ?? []).slice(0, 2);

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          void api.refreshUsage().catch(() => {});
        }}
        aria-expanded={open}
        aria-label="구독 남은 사용량"
        className="glass flex min-h-9 items-center gap-3 rounded-full px-3.5"
      >
        {shown.length ? (
          <>
            <span className="text-[11.5px] font-semibold">{USAGE_NAME[main!.provider]}</span>
            {shown.map((w) => {
              const left = Math.max(0, 100 - w.usedPercent);
              return (
                <span key={w.id} className="flex items-center gap-1.5">
                  <span className="text-[11.5px] text-ink-2">{w.label}</span>
                  <Bar left={left} />
                  <span className="font-mono text-[12px] font-medium">{Math.round(left)}%</span>
                </span>
              );
            })}
          </>
        ) : (
          <span className="text-xs text-ink-2">구독 사용량 확인 중…</span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            className="absolute top-11 right-0 z-50 flex w-[320px] flex-col gap-3 rounded-2xl p-4"
            style={{ background: "color-mix(in srgb, var(--bg2) 96%, transparent)", border: "1px solid var(--glass-border)", boxShadow: "var(--shadow)" }}
          >
            <span className="text-[13px] font-semibold">구독 남은 사용량</span>
            {list.length === 0 && <span className="text-xs text-ink-2">확인 중…</span>}
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
                    <span key={w.id} className="flex items-center gap-2 text-[12px]">
                      <span className="w-20 shrink-0 text-ink-2">{w.label}</span>
                      <Bar left={left} w={90} />
                      <span className="w-10 shrink-0 text-right font-mono font-medium">{Math.round(left)}%</span>
                      <span className="min-w-0 truncate text-[10.5px] text-ink-2">{resetText(w.resetsAt)}</span>
                    </span>
                  );
                })}
              </div>
            ))}
            <span className="text-[10.5px] text-ink-2">5분마다 갱신 · 누를 때마다 새로 확인해요</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TopBar() {
  const { dark, left, right, view, toggleDark, toggleLeft, toggleRight, setPreset, go, stopTeam, accounts, openAccounts } = useApp();
  const account = accounts.find((a) => a.active);
  const { project, team } = useCurrent();
  const [confirmStop, setConfirmStop] = useState(false);
  const onHome = view.name === "home";
  const running = !!team?.agents.some((a) => a.status !== "off");
  const openEscalations = team?.chat.filter((m) => (m.escalation && !m.escalation.answer) || (m.permission && !m.permission.answer)).length ?? 0;


  return (
    // left padding keeps clear of the macOS traffic lights
    <header
      data-tauri-drag-region
      className={`relative flex min-h-[52px] flex-wrap items-center gap-2.5 py-1.5 pr-4 ${isRemote ? "pl-4" : "pl-[88px]"}`}
      style={{ borderBottom: "1px solid var(--line)" }}
    >
      {!onHome && (
        <button onClick={toggleLeft} aria-label="총괄 대화창 접기/펴기" aria-pressed={left} className={iconBtn}>
          <PanelLeft />
        </button>
      )}
      {project && !onHome ? (
        <>
          <button onClick={() => go({ name: "home" })} className="rounded-lg px-1 text-base font-semibold hover:bg-[var(--chip)]" title="프로젝트 목록으로">
            {project.name}
          </button>
          {team?.branch && (
            <button
              onClick={() => go({ name: "home" })}
              title={team.cwd}
              className="glass flex min-h-[34px] items-center gap-2 rounded-full px-3 font-mono text-[12.5px]"
            >
              <Branch size={15} />
              {team.branch}
              <ChevronDown size={13} />
            </button>
          )}
        </>
      ) : null}

      <div data-tauri-drag-region className="flex-auto self-stretch" />

      {project && !onHome && (
        <>
          <div role="group" aria-label="추천 설정" className="glass flex gap-0.5 rounded-full p-[3px]">
            {PRESETS.map((p) => {
              const on = p.id === project.team.preset;
              return (
                <button
                  key={p.id}
                  aria-pressed={on}
                  onClick={() => setPreset(p.id)}
                  title="이후에 출근하는 AI부터 적용돼요"
                  className="flex min-h-[30px] items-center rounded-full border-0 px-3 text-[13px] font-medium transition-colors duration-200"
                  style={{ background: on ? "var(--amber)" : "transparent", color: on ? "#2B2520" : "var(--text)" }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          
          <button
            onClick={() => !left && toggleLeft()}
            aria-label={openEscalations ? `도움이 필요한 일 ${openEscalations}건` : "알림 없음"}
            className={`${iconBtn} relative`}
          >
            <Bell />
            {openEscalations > 0 && (
              <span
                className="absolute top-[5px] right-[5px] size-[9px] rounded-full"
                style={{ background: "var(--block)", border: "2px solid var(--bg2)" }}
              />
            )}
          </button>
          <button onClick={() => go({ name: "settings" })} aria-label="팀 설정" className={iconBtn}>
            <Gear />
          </button>
          {running && (
            <button
              onClick={() => (confirmStop ? (setConfirmStop(false), void stopTeam()) : setConfirmStop(true))}
              onBlur={() => setConfirmStop(false)}
              aria-label="팀 퇴근 (모든 AI 작업 종료)"
              className={confirmStop ? "flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold" : iconBtn}
              style={confirmStop ? { background: "var(--block)", color: "#fff" } : undefined}
            >
              <Power />
              {confirmStop && "퇴근할까요?"}
            </button>
          )}
        </>
      )}

      <UsageMeter />
      <button
        onClick={() => openAccounts()}
        aria-label={`Claude 계정: ${account?.status.email ?? account?.name ?? "확인 중"}${account?.status.loggedIn ? "" : " (로그인 필요)"}`}
        title={account?.status.email ?? "Claude 계정"}
        className="flex min-h-9 items-center gap-2 rounded-full py-1 pr-3 pl-1 hover:bg-[var(--chip)]"
      >
        <span
          className="relative flex size-7 items-center justify-center rounded-full text-[12px] font-semibold"
          style={{ background: account?.status.loggedIn ? "var(--navy)" : "var(--chip)", color: account?.status.loggedIn ? "var(--me-fg)" : "var(--text2)" }}
        >
          {initialOf(account)}
          <span
            className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full"
            style={{ background: account?.status.loggedIn ? "var(--work)" : "var(--block)", border: "2px solid var(--bg2)" }}
          />
        </span>
        <span className="max-w-[120px] truncate text-[12.5px]">{account ? (account.status.loggedIn ? account.name : "로그인 필요") : "계정"}</span>
      </button>
      <button onClick={toggleDark} aria-label={dark ? "라이트 모드로" : "다크 모드로"} className={iconBtn}>
        {dark ? <Sun /> : <Moon />}
      </button>
      {!onHome && (
        <button onClick={toggleRight} aria-label="작업 보드 접기/펴기" aria-pressed={right} className={iconBtn}>
          <PanelRight />
        </button>
      )}
    </header>
  );
}
