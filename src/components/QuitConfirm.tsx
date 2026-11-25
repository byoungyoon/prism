// Closing the window (Cmd+W, the red button) or quitting (Cmd+Q) while members are at work is held
// back by the backend, which sends "quit-ask". This asks once: [취소] keeps everything running,
// [끄기] lets it go through. "다시 묻지 않기" turns the question off (Settings brings it back).
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";
import { isRemote } from "../lib/transport";
import { api, type QuitAsk } from "../lib/api";
import { useApp } from "../store";

export function QuitConfirm() {
  const [ask, setAsk] = useState<QuitAsk | null>(null);
  const [dontAsk, setDontAsk] = useState(false);
  const setConfirmQuit = useApp((s) => s.setConfirmQuit);
  const setError = useApp((s) => s.setError);
  const busy = useRef(false);

  useEffect(() => {
    if (isRemote) return; // the window question only exists in the desktop app
    const unlisten = listen<QuitAsk>("quit-ask", (e) => {
      setDontAsk(false);
      setAsk(e.payload);
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  // 취소 (or Esc): the backend already held the close back, so nothing more to do
  const cancel = () => setAsk(null);

  const quit = async () => {
    if (!ask || busy.current) return;
    busy.current = true;
    const { kind } = ask;
    setAsk(null);
    try {
      if (dontAsk) await setConfirmQuit(false);
      await api.quitConfirm(kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask]);

  return (
    <AnimatePresence>
      {ask && (
        <motion.div
          key="quit-confirm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/25 p-4"
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="quit-confirm-title"
            aria-describedby="quit-confirm-body"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="glass flex w-[360px] max-w-full flex-col gap-4 rounded-2xl p-6"
          >
            <div className="flex flex-col gap-1.5">
              <h2 id="quit-confirm-title" className="m-0 text-[17px] font-semibold">
                정말 끌까요?
              </h2>
              <p id="quit-confirm-body" className="m-0 text-[13.5px] leading-relaxed text-ink-2">
                지금 일하는 팀원 <b className="font-semibold text-[var(--text)]">{ask.working}명</b>이 멈춰요.
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2" title="설정에서 다시 켤 수 있어요">
              <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} className="size-4" style={{ accentColor: "var(--amber)" }} />
              다시 묻지 않기
            </label>

            <div className="flex justify-end gap-2">
              <button onClick={cancel} autoFocus className="glass-soft min-h-10 rounded-full px-5 text-[13.5px]">
                취소
              </button>
              <button
                onClick={() => void quit()}
                className="min-h-10 rounded-full border-0 px-5 text-[13.5px] font-semibold"
                style={{ background: "var(--amber)", color: "#2B2520", boxShadow: "0 8px 20px rgba(232,161,90,0.4)" }}
              >
                끄기
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
