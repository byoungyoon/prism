import { useEffect, useRef, useState } from "react";
import { api, pty, type CliStatus } from "../lib/api";
import { installFailureReason, notDetectedReason, plainOutput } from "../lib/setupFailure";

export type InstallFailure = { reason: string; detail: string };

/** Runs the official installer for `tool` (null: nothing yet) and watches how it ends.
 *  `onList` gets every fresh tool list; a new `attempt` starts over. */
export function useInstall(tool: string | null, onList: (list: CliStatus[]) => void, attempt = 0) {
  const [ptyId, setPtyId] = useState<number | null>(null);
  const [failure, setFailure] = useState<InstallFailure | null>(null);
  // Callers pass a fresh `onList` every render, and every status poll re-renders them. Keep it in
  // a ref so the effect below runs once per tool — otherwise each poll killed the running installer
  // and started it over (an endless download loop, very visible with winget on Windows).
  const listRef = useRef(onList);
  listRef.current = onList;
  useEffect(() => {
    setPtyId(null);
    setFailure(null);
    if (!tool) return;
    let alive = true;
    let started: number | null = null;
    let next: ReturnType<typeof setTimeout>;
    const fail = (reason: string, said: string) => setFailure({ reason, detail: `install ${tool}\n${said}` });
    const check = async () => {
      if (started == null) return;
      // ask for the end first: the list read after it is at least as new
      const ran = await api.ptyState(started).catch(() => null);
      const list = await api.cliStatus().catch(() => null);
      if (!alive) return;
      if (list) listRef.current(list);
      if (ran?.done && list && !list.find((c) => c.name === tool)?.installed) {
        const said = plainOutput(ran.tail);
        if (ran.code !== 0) return fail(installFailureReason(ran.tail, ran.code), `exit ${ran.code}\n${said}`);
        // on a Mac, Git's command ends at once while Apple's own install window carries on
        if (!(tool === "git" && navigator.userAgent.includes("Mac"))) return fail(notDetectedReason(ran.tail), `exit 0\n${said}`);
      }
      next = setTimeout(() => void check(), 3000);
    };
    const start = setTimeout(() => {
      api
        .cliInstall(tool, 92, 16)
        .then((p) => {
          if (!alive) return void pty.kill(p);
          started = p;
          setPtyId(p);
          next = setTimeout(() => void check(), 1500);
        })
        .catch((e) => {
          if (alive) fail(installFailureReason(String(e), null), plainOutput(String(e)));
        });
    }, 150); // one install, even when React (dev) runs this effect twice
    return () => {
      alive = false;
      clearTimeout(start);
      clearTimeout(next);
      if (started != null) void pty.kill(started);
    };
  }, [tool, attempt]);
  return { ptyId, failure };
}
