// "새 버전을 받았는데 예전 버전이 떠요" (macOS): the backend (install_check) says when an old Prism
// is what's showing — a newer app was installed over this running one, another version is running,
// or this was opened from the DMG / Downloads — and one button fixes it. Asked at start; while the
// app stays open only the "a newer one was installed" case is looked for (on focus and every 5 min).
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type InstallIssue } from "../lib/api";
import { installText } from "../lib/installText";

const FIVE_MINUTES = 5 * 60 * 1000;

export function InstallNotice() {
  const [issue, setIssue] = useState<InstallIssue | null>(null);
  const [dismissed, setDismissed] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // remote viewers (and old backends) don't have the command: nothing to show
    const look = (all: boolean) =>
      void api
        .installCheck()
        .then((found) => {
          if (alive && found && (all || found.kind === "replaced")) setIssue(found);
        })
        .catch(() => {});
    look(true);
    const later = () => look(false);
    window.addEventListener("focus", later);
    const timer = setInterval(later, FIVE_MINUTES);
    return () => {
      alive = false;
      window.removeEventListener("focus", later);
      clearInterval(timer);
    };
  }, []);

  const key = issue ? `${issue.kind}:${issue.other ?? ""}` : "";
  const show = issue && key !== dismissed ? issue : null;
  const text = show && installText(show);

  const fix = async () => {
    if (!show || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await api.installFix(show.kind);
      // still open: the old one was closed, or things changed — show what's left, if anything
      setIssue(await api.installCheck());
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <AnimatePresence>
      {show && text && (
        <motion.div
          key="install-notice"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[75] flex items-center justify-center bg-black/35 p-4"
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="install-notice-title"
            aria-describedby="install-notice-body"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="glass flex w-[420px] max-w-full flex-col gap-4 rounded-2xl p-6"
            style={{ background: "var(--bg2)", border: "1.5px solid var(--amber)" }}
          >
            <div id="install-notice-body" className="flex flex-col gap-2">
              <h2 id="install-notice-title" className="m-0 text-[17px] font-semibold">
                {text.title}
              </h2>
              {text.lines.map((line) => (
                <p key={line} className="m-0 text-[13.5px] leading-relaxed break-keep text-ink-2">
                  {line}
                </p>
              ))}
              {failed && (
                <p role="alert" className="m-0 text-[12.5px] leading-relaxed break-keep" style={{ color: "var(--block-ink)" }}>
                  {failed}
                </p>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => setDismissed(key)} disabled={busy} className="glass-soft min-h-10 rounded-full px-4 text-[13.5px] disabled:opacity-60">
                {show.kind === "replaced" ? "나중에" : "그냥 쓰기"}
              </button>
              <button
                autoFocus
                onClick={() => void fix()}
                disabled={busy}
                className="min-h-10 rounded-full border-0 px-5 text-[13.5px] font-semibold disabled:opacity-60"
                style={{ background: "var(--amber)", color: "#2B2520", boxShadow: "0 8px 20px rgba(232,161,90,0.4)" }}
              >
                {busy ? "하는 중…" : text.action}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
