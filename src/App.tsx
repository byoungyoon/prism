import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useApp, useShownTeams, type View } from "./store";
import { TopBar } from "./components/TopBar";
import { LeadChat } from "./components/LeadChat";
import { UnifiedChat } from "./components/UnifiedChat";
import { TaskBoard } from "./components/TaskBoard";
import { ReportFeed } from "./components/ReportFeed";
import { AccountSheet } from "./components/AccountSheet";
import { Onboarding } from "./components/Onboarding";
import { UpdateBanner } from "./components/UpdateBanner";
import { HomeScreen } from "./screens/HomeScreen";
import { AgentScreen } from "./screens/AgentScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
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
      <ReportFeed />
    </div>
  );
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
  { id: "feed", label: "보고" },
  { id: "board", label: "보드" },
] as const;

function MainView() {
  const { left, right } = useApp(useShallow((s) => ({ left: s.left, right: s.right })));
  const narrow = useNarrow();
  const [tab, setTab] = useState<(typeof PHONE_TABS)[number]["id"]>("chat");
  const pending = useShownTeams().reduce(
    (n, { team }) => n + team.chat.filter((m) => (m.permission && !m.permission.answer) || (m.escalation && !m.escalation.answer)).length,
    0,
  );

  if (narrow)
    return (
      <div className="relative flex min-h-0 flex-auto flex-col gap-2 p-2">
        <div role="tablist" aria-label="화면" className="glass flex gap-0.5 self-center rounded-full p-1">
          {PHONE_TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button key={t.id} role="tab" aria-selected={on} onClick={() => setTab(t.id)} className="relative flex min-h-9 items-center gap-1.5 rounded-full border-0 bg-transparent px-5 text-[13.5px] font-medium" style={{ color: on ? "#2B2520" : "var(--text)" }}>
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
        <div className="flex min-h-0 flex-auto flex-col [&>section]:max-w-none [&>section]:flex-auto">
          {tab === "chat" ? <LeadColumn /> : tab === "feed" ? <ReportFeed /> : <TaskBoard />}
        </div>
      </div>
    );

  return (
    <div className="relative flex min-h-0 flex-auto gap-3 p-3">
      {left && <LeadColumn />}
      <CenterPanel />
      {right && <TaskBoard />}
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
          className="glass absolute bottom-4 left-1/2 z-50 flex max-w-[520px] -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-3 text-[13px]"
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

export default function App() {
  const { dark, view, init, go } = useApp(useShallow((s) => ({ dark: s.dark, view: s.view, init: s.init, go: s.go })));
  // only whether there is a team: subscribing to the snapshot would re-render the whole app on every update
  const hasTeam = useApp((s) => !!(s.projectId && s.teams[s.projectId]));

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
      className="relative flex h-full flex-col overflow-hidden"
      style={{ background: "linear-gradient(160deg, var(--bg1), var(--bg2))", color: "var(--text)" }}
    >
      {/* clipped on their own: blobs poking past the window made the app frame scrollable */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-[180px] left-[30%] size-[520px] rounded-full" style={{ background: "radial-gradient(closest-side, var(--blob1), transparent)" }} />
        <div className="absolute -right-[120px] -bottom-[160px] size-[460px] rounded-full" style={{ background: "radial-gradient(closest-side, var(--blob2), transparent)" }} />
      </div>

      <TopBar />

      <AnimatePresence mode="wait">
        <motion.div key={viewKey(view)} {...page} className="relative flex min-h-0 flex-auto flex-col">
          <Screen view={view} />
        </motion.div>
      </AnimatePresence>

      <AccountSheet />
      <Onboarding />
      <UpdateBanner />
      <ErrorToast />
    </div>
  );
}
