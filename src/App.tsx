import { useEffect, useState } from "react";
import { isRemote, onConnection } from "./lib/transport";
import { AnimatePresence, motion } from "motion/react";
import { useApp, useShownTeams, waitsForMe, type View } from "./store";
import { TopBar } from "./components/TopBar";
import { LeadChat } from "./components/LeadChat";
import { UnifiedChat } from "./components/UnifiedChat";
import { TaskBoard } from "./components/TaskBoard";
import { CenterOffice } from "./components/office/CenterOffice";
import { AccountSheet } from "./components/AccountSheet";
import { Onboarding } from "./components/Onboarding";
import { UpdateBanner } from "./components/UpdateBanner";
import { QuitConfirm } from "./components/QuitConfirm";
import { EngineStage } from "./engines/EngineStage";
import { useEngineEdit } from "./engines/editing";
import { HomeScreen } from "./screens/HomeScreen";
import { AgentScreen } from "./screens/AgentScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { Dashboard } from "./components/dashboard/Dashboard";
import { useShallow } from "zustand/react/shallow";

const page = {
  initial: { opacity: 0, scale: 0.985 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.985 },
  transition: { type: "spring" as const, stiffness: 260, damping: 28 },
};

/** Center of the 관제탑: every team's reports (the 작업 보드 on the right shows the floors). */
function CenterPanel() {
  return (
    <div className="relative flex min-w-0 flex-[999_1_480px] flex-col">
      <CenterOffice />
    </div>
  );
}

/** Keep the app exactly as tall as what's visible: on a phone the on-screen keyboard covers the
 * bottom of the layout viewport, which would hide the chat input. */
function useVisibleHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
      // iOS scrolls the page up to reveal the focused input; the app frame never scrolls
      if (window.scrollY || vv.offsetTop) window.scrollTo(0, 0);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);
}

function useNarrow() {
  const q = "(max-width: 820px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** The left side: one conversation. A single team gets its 총괄 chat; several share one timeline
 * where "@팀이름" picks who gets each order. */
function LeadColumn() {
  const many = useShownTeams().length > 1;
  return many ? <UnifiedChat /> : <LeadChat />;
}

const PHONE_TABS = [
  { id: "chat", label: "총괄" },
  { id: "feed", label: "사무실" },
  { id: "board", label: "보드" },
] as const;

function MainView() {
  const { left, right } = useApp(useShallow((s) => ({ left: s.left, right: s.right })));
  const dash = useApp((s) => s.mainTab === "dashboard");
  const narrow = useNarrow();
  const [tab, setTab] = useState<(typeof PHONE_TABS)[number]["id"]>("chat");
  // a clicked notification: the 허락 칸 sits in the chat tab
  const askFocus = useApp((s) => s.askFocus);
  useEffect(() => {
    // only a fresh click: an old one (nothing to scroll to) mustn't move the tab later
    if (askFocus && Date.now() - askFocus.at < 3000) setTab("chat");
  }, [askFocus]);
  const pending = useShownTeams().reduce(
    (n, { team }) => n + team.chat.filter(waitsForMe).length,
    0,
  );

  // 사무실은 가려만 두고 계속 떠 있게 (고양이·휴게실 상태 유지). 대시보드는 열 때만 붙여서 웹 칸이 사무실 위에 남지 않게 한다.
  const office = narrow ? (
      <div className="relative flex min-h-0 min-w-0 flex-auto flex-col gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div role="tablist" aria-label="화면" className="glass flex max-w-full gap-0.5 self-center rounded-full p-1">
          {PHONE_TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button key={t.id} role="tab" aria-selected={on} onClick={() => setTab(t.id)} className="relative flex min-h-10 items-center gap-1.5 rounded-full border-0 bg-transparent px-5 text-[13.5px] font-medium" style={{ color: on ? "#2B2520" : "var(--text)" }}>
                {on && <motion.span layoutId="phone-tab" className="absolute inset-0 rounded-full" style={{ background: "var(--amber)" }} />}
                <span className="relative">{t.label}</span>
                {t.id === "feed" && pending > 0 && (
                  <span className="relative rounded-full px-1.5 text-[11px] font-semibold" style={{ background: "var(--block)", color: "#fff" }}>
                    {pending}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* panels fill the phone width */}
        <div className="flex min-h-0 min-w-0 flex-auto flex-col [&>section]:max-w-none [&>section]:min-w-0 [&>section]:flex-auto">
          {tab === "chat" ? <LeadColumn /> : tab === "feed" ? <CenterOffice /> : <TaskBoard />}
        </div>
      </div>
    ) : (
    <div className="relative flex min-h-0 flex-auto gap-3 p-3">
      {left && <LeadColumn />}
      <CenterPanel />
      {right && <TaskBoard />}
    </div>
    );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-auto flex-col">
      <div hidden={dash} className="relative flex min-h-0 min-w-0 flex-auto flex-col">
        {office}
      </div>
      {dash && (
        <div className="relative flex min-h-0 min-w-0 flex-auto flex-col p-3 max-[820px]:p-2">
          <Dashboard />
        </div>
      )}
    </div>
  );
}

function Screen({ view }: { view: View }) {
  switch (view.name) {
    case "home":
      return <HomeScreen />;
    case "main":
      return <MainView />;
    case "agent":
      return <AgentScreen id={view.id} />;
    case "settings":
      return <SettingsScreen />;
  }
}

function viewKey(v: View) {
  if (v.name === "agent") return `agent:${v.id}`;
  return v.name;
}

function ErrorToast() {
  const { error, setError } = useApp(useShallow((s) => ({ error: s.error, setError: s.setError })));
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error, setError]);
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="glass absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex w-max max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-3 text-[13px]"
          style={{ border: "1px solid var(--block)" }}
        >
          <span className="size-2 shrink-0 rounded-full" style={{ background: "var(--block)" }} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-xs text-ink-2 underline">
            닫기
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Phone only: a small pill while the live connection is down and being re-established. */
function ReconnectBadge() {
  const [up, setUp] = useState(true);
  useEffect(() => (isRemote ? onConnection(setUp) : undefined), []);
  if (up) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded-full px-3 py-1 text-xs"
      style={{ background: "var(--text)", color: "var(--bg1)", opacity: 0.9 }}
    >
      다시 연결 중…
    </div>
  );
}

export default function App() {
  const { dark, view, init, go } = useApp(useShallow((s) => ({ dark: s.dark, view: s.view, init: s.init, go: s.go })));
  // only whether there is a team: subscribing to the snapshot would re-render the whole app on every update
  const hasTeam = useApp((s) => !!(s.projectId && s.teams[s.projectId]));
  // an outside editor (figcraft…) open on a team's file: it takes the main area while the main view shows
  const editTarget = useEngineEdit((s) => s.target);
  const tucked = useEngineEdit((s) => s.tucked);
  const editing = !!editTarget && !tucked && view.name === "main";

  useVisibleHeight();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("t-dark", dark);
    root.classList.toggle("t-light", !dark);
  }, [dark]);

  // team screens need a team
  useEffect(() => {
    if ((view.name === "main" || view.name === "agent") && !hasTeam) go({ name: "home" });
  }, [view, hasTeam, go]);

  return (
    <div
      className="relative flex h-full max-w-full flex-col overflow-hidden"
      style={{ background: "linear-gradient(160deg, var(--bg1), var(--bg2))", color: "var(--text)" }}
    >
      {/* clipped on their own: blobs poking past the window made the app frame scrollable */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-[180px] left-[30%] size-[520px] rounded-full" style={{ background: "radial-gradient(closest-side, var(--blob1), transparent)" }} />
        <div className="absolute -right-[120px] -bottom-[160px] size-[460px] rounded-full" style={{ background: "radial-gradient(closest-side, var(--blob2), transparent)" }} />
      </div>

      <TopBar />

      <AnimatePresence mode="wait">
        {/* hidden, not unmounted, while editing: chat drafts and open panels keep their state */}
        <motion.div key={viewKey(view)} {...page} hidden={editing} className="relative flex min-h-0 flex-auto flex-col">
          <Screen view={view} />
        </motion.div>
      </AnimatePresence>
      {/* kept mounted while a file is open, so the editor's unsaved edits survive a trip to another screen */}
      {editTarget && <EngineStage target={editTarget} hidden={!editing} />}

      {editTarget && tucked && view.name === "main" && (
        <button onClick={() => useEngineEdit.setState({ tucked: false })} className="glass mx-auto mb-2 min-h-8 max-w-[calc(100%-24px)] shrink-0 truncate rounded-full px-4 text-[12.5px] font-semibold" style={{ border: "1.5px solid var(--amber)" }}>
          열어 둔 파일 편집으로 돌아가기
        </button>
      )}

      <AccountSheet />
      <Onboarding />
      <UpdateBanner />
      <QuitConfirm />
      <ReconnectBadge />
      <ErrorToast />
    </div>
  );
}
