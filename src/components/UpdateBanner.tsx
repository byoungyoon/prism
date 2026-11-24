// Prism's own updates: check GitHub Releases at launch and every 6 hours; when there's a new
// version, offer it in one click — download (signature-verified), install, restart. Teams keep
// going across the restart: right before it every team and member's session is saved with a
// "restarted for an update" mark, and on the next start they all come back to the same
// conversations (the ones mid-work are told to carry on). Or the update waits until every team
// is idle, and then installs itself.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isRemote } from "../lib/transport";
import { api } from "../lib/api";
import { isBusy, useApp } from "../store";

const SIX_HOURS = 6 * 60 * 60 * 1000;
/** how long every team must stay idle before a waiting update installs (a gap between turns isn't "done") */
const IDLE_FOR = 20_000;

/** Save every team for the restart, then restart the app. */
async function restartKeepingTeams() {
  await api.prepareRestart("update").catch(() => {});
  await relaunch();
}

// dev builds: the restart path can be tried by hand from the console — `await __prismRestart()`
if (import.meta.env.DEV && !isRemote) (window as unknown as { __prismRestart: () => Promise<void> }).__prismRestart = restartKeepingTeams;

export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [later, setLater] = useState(false);
  // "일이 끝나면 업데이트": waiting for every team to go idle
  const [whenIdle, setWhenIdle] = useState(false);
  const busy = useApp((s) => Object.values(s.teams).filter((t) => isBusy(t)).length);
  const installing = useRef(false);

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
    if (!update || installing.current) return;
    installing.current = true;
    setWhenIdle(false);
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
      await restartKeepingTeams();
    } catch {
      setFailed(true);
      setProgress(null);
    }
    installing.current = false;
  };

  // waiting for the teams: install once nobody has been working for a while
  useEffect(() => {
    if (!whenIdle || busy > 0) return;
    const t = setTimeout(() => void install(), IDLE_FOR);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whenIdle, busy]);

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
          className="glass absolute right-4 bottom-4 z-[55] flex w-[340px] max-[820px]:right-3 max-[820px]:bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-[820px]:left-3 max-[820px]:w-auto flex-col gap-2.5 rounded-2xl p-4"
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
          ) : whenIdle ? (
            <div className="flex items-center gap-2">
              <span className="flex-auto text-[11.5px] text-ink-2">
                {busy > 0 ? `지금 ${busy}팀이 일하는 중이에요. 일이 끝나면 업데이트할게요.` : "곧 업데이트해요. 팀은 다시 켜진 뒤 이어서 일해요."}
              </span>
              <button onClick={() => setWhenIdle(false)} className="min-h-8 rounded-full px-3 text-[12.5px] text-ink-2">
                취소
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {failed && <span className="text-[11.5px]" style={{ color: "var(--block-ink)" }}>업데이트에 실패했어요. 다시 해볼까요?</span>}
              {!failed && (
                <span className="text-[11.5px] text-ink-2">
                  {busy > 0 ? `지금 ${busy}팀이 일하는 중이에요. ` : ""}설치하면 앱이 잠깐 다시 켜지고, 팀은 하던 대화 그대로 이어서 일해요.
                </span>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button onClick={() => setLater(true)} className="min-h-8 rounded-full px-3 text-[12.5px] text-ink-2">
                  나중에
                </button>
                <button onClick={() => setWhenIdle(true)} className="min-h-8 rounded-full px-3 text-[12.5px]" style={{ border: "1px solid var(--amber)" }}>
                  일이 끝나면 업데이트
                </button>
                <button onClick={() => void install()} className="min-h-8 rounded-full border-0 px-4 text-[12.5px] font-semibold" style={{ background: "var(--amber)", color: "#2B2520" }}>
                  지금 업데이트 (하던 일은 이어서 해요)
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
