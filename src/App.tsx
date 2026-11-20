import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useApp, useCurrent, type View } from "./store";
import { TopBar } from "./components/TopBar";
import { LeadChat } from "./components/LeadChat";
import { LayerStack } from "./components/LayerStack";
import { TaskBoard } from "./components/TaskBoard";
import { ReportFeed } from "./components/ReportFeed";
import { AccountSheet } from "./components/AccountSheet";
import { Onboarding } from "./components/Onboarding";
import { HomeScreen } from "./screens/HomeScreen";
import { FocusScreen } from "./screens/FocusScreen";
import { AgentScreen } from "./screens/AgentScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

const page = {
  initial: { opacity: 0, scale: 0.985 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.985 },
  transition: { type: "spring" as const, stiffness: 260, damping: 28 },
};

const CENTER_TABS = [
  { id: "feed", label: "보고" },
  { id: "stack", label: "스택" },
] as const;

function CenterPanel() {
  const { center, setCenter } = useApp();
  const { team } = useCurrent();
  const pending = team?.chat.filter((m) => m.permission && !m.permission.answer).length ?? 0;
  return (
    <div className="relative flex min-w-0 flex-[999_1_480px] flex-col gap-3">
      <div role="tablist" aria-label="관제탑 보기" className="glass flex gap-0.5 self-center rounded-full p-1">
        {CENTER_TABS.map((t) => {
          const on = center === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              onClick={() => setCenter(t.id)}
              className="relative flex min-h-8 items-center gap-1.5 rounded-full border-0 bg-transparent px-5 text-[13px] font-medium"
              style={{ color: on ? "#2B2520" : "var(--text)" }}
            >
              {on && (
                <motion.span layoutId="center-tab" transition={{ type: "spring", stiffness: 380, damping: 32 }} className="absolute inset-0 rounded-full" style={{ background: "var(--amber)" }} />
              )}
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
      <AnimatePresence mode="wait">
        <motion.div
          key={center}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="flex min-h-0 flex-auto flex-col"
        >
          {center === "feed" ? <ReportFeed /> : <LayerStack />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function MainView() {
  const { left, right } = useApp();
  return (
    <div className="relative flex min-h-0 flex-auto gap-3 p-3">
      {left && <LeadChat />}
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
    case "focus":
      return <FocusScreen layer={view.layer} />;
    case "agent":
      return <AgentScreen id={view.id} />;
    case "settings":
      return <SettingsScreen />;
  }
}

function viewKey(v: View) {
  if (v.name === "focus") return `focus:${v.layer}`;
  if (v.name === "agent") return `agent:${v.id}`;
  return v.name;
}

function ErrorToast() {
  const { error, setError } = useApp();
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
          <span className="select-text">{error}</span>
          <button onClick={() => setError(null)} className="text-xs text-ink-2 underline">
            닫기
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function App() {
  const { dark, view, init, go } = useApp();
  const { team } = useCurrent();

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
    if ((view.name === "main" || view.name === "focus" || view.name === "agent") && !team) go({ name: "home" });
  }, [view, team, go]);

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{ background: "linear-gradient(160deg, var(--bg1), var(--bg2))", color: "var(--text)" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[180px] left-[30%] size-[520px] rounded-full"
        style={{ background: "var(--blob1)", filter: "blur(90px)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[120px] -bottom-[160px] size-[460px] rounded-full"
        style={{ background: "var(--blob2)", filter: "blur(90px)" }}
      />

      <TopBar />

      <AnimatePresence mode="wait">
        <motion.div key={viewKey(view)} {...page} className="relative flex min-h-0 flex-auto flex-col">
          <Screen view={view} />
        </motion.div>
      </AnimatePresence>

      <AccountSheet />
      <Onboarding />
      <ErrorToast />
    </div>
  );
}
