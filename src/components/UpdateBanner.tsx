// Prism's own updates: check GitHub Releases at launch and every 6 hours; when there's a new
// version, offer it in one click — download (signature-verified), install, restart.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isRemote } from "../lib/transport";

const SIX_HOURS = 6 * 60 * 60 * 1000;

export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [later, setLater] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV || isRemote) return; // dev builds aren't released; remote viewers update via the Mac
    const look = () =>
      void check()
        .then((u) => u && setUpdate(u))
        .catch(() => {}); // offline or no release yet: try again later
    look();
    const t = setInterval(look, SIX_HOURS);
    return () => clearInterval(t);
  }, []);

  const install = async () => {
    if (!update) return;
    setFailed(false);
    setProgress(0);
    let total = 0;
    let got = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          got += e.data.chunkLength;
          setProgress(total ? Math.min(99, Math.round((got / total) * 100)) : null);
        }
      });
      setProgress(100);
      await relaunch();
    } catch {
      setFailed(true);
      setProgress(null);
    }
  };

  const show = update && !later;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="glass absolute right-4 bottom-4 z-[55] flex w-[340px] flex-col gap-2.5 rounded-2xl p-4"
          style={{ border: "1px solid var(--amber)" }}
        >
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: "var(--amber)" }} />
            <span className="flex-auto text-[13.5px] font-semibold">새 버전 {update.version}이 나왔어요</span>
          </div>
          {update.body && <p className="m-0 line-clamp-3 text-[12px] leading-relaxed text-ink-2">{update.body}</p>}
          {progress != null ? (
            <div className="flex items-center gap-2">
              <span className="h-1.5 flex-auto overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${progress}%`, background: "var(--amber)" }} />
              </span>
              <span className="font-mono text-[11.5px] text-ink-2">{progress}%</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {failed && <span className="flex-auto text-[11.5px]" style={{ color: "var(--block-ink)" }}>업데이트에 실패했어요. 다시 해볼까요?</span>}
              {!failed && <span className="flex-auto text-[11.5px] text-ink-2">설치하면 앱이 잠깐 다시 켜져요.</span>}
              <button onClick={() => setLater(true)} className="min-h-8 rounded-full px-3 text-[12.5px] text-ink-2">
                나중에
              </button>
              <button onClick={() => void install()} className="min-h-8 rounded-full border-0 px-4 text-[12.5px] font-semibold" style={{ background: "var(--amber)", color: "#2B2520" }}>
                업데이트
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
