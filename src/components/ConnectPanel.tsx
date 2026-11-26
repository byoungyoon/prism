import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useApp } from "../store";
import { api, pty, type Account } from "../lib/api";
import { loginFailureReason, loginPhase, reopenUrl } from "../lib/login";
import { blockedReason, plainOutput } from "../lib/setupFailure";
import { PROVIDER_NAME } from "../lib/topAccount";
import { FailureDetail } from "./FailureDetail";
import { TerminalView } from "./TerminalView";

const LIMIT_MS = 10 * 60 * 1000;
const amber = { background: "var(--amber)", color: "#2B2520" };

type State = { kind: "waiting" } | { kind: "success" } | { kind: "failed"; reason: string; detail?: string } | { kind: "cancelled" };

/** One account's sign-in: the browser does it, this only says how it's going. The sign-in
 *  program runs unseen and gets the result back from the browser by itself (no code to copy). */
export function ConnectPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const acct = useApp((s) => s.accounts.find((a) => a.id === id));
  if (!acct) return null;
  return <Attempt key={attempt} acct={acct} onRetry={() => setAttempt((n) => n + 1)} onClose={onClose} />;
}

function Attempt({ acct, onRetry, onClose }: { acct: Account; onRetry: () => void; onClose: () => void }) {
  const { id, provider } = acct;
  const name = PROVIDER_NAME[provider];
  const loadAccounts = useApp((s) => s.loadAccounts);
  const [switching] = useState(acct.status.loggedIn);
  const [state, setState] = useState<State>({ kind: "waiting" });
  const [ptyId, setPtyId] = useState<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const running = useRef<number | null>(null);
  const stop = () => {
    if (running.current != null) void pty.kill(running.current);
    running.current = null;
  };

  useEffect(() => {
    let over = false;
    let detach: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let output = "";
    const began = Date.now();
    const decoder = new TextDecoder();
    const finish = (s: State) => {
      over = true;
      setState(s);
    };
    const check = async () => {
      const p = running.current;
      if (over || p == null) return;
      // ask for the exit first: the status read after it is at least as new
      const ran = await api.ptyState(p).catch(() => null);
      const exit = ran?.done ? (ran.code ?? 1) : null;
      await loadAccounts();
      if (over) return;
      const loggedIn = !!useApp.getState().accounts.find((a) => a.id === id)?.status.loggedIn;
      const phase = loginPhase({ switching, loggedIn, exit });
      if (phase === "success") return finish({ kind: "success" });
      if (phase === "failed") {
        const said = ran?.tail || output;
        return finish({ kind: "failed", reason: loginFailureReason(said), detail: `login ${provider} · exit ${exit}\n${plainOutput(said)}` });
      }
      if (Date.now() - began > LIMIT_MS) {
        stop();
        return finish({ kind: "failed", reason: "시간이 너무 오래 지났어요." });
      }
      timer = setTimeout(() => void check(), 2000);
    };
    // start on a short delay: React (dev) runs effects twice, and two sign-ins would race
    const start = setTimeout(async () => {
      try {
        const p = await api.loginAccount(id, 400, 30); // wide, so addresses aren't wrapped
        if (over) return void pty.kill(p);
        running.current = p;
        setPtyId(p);
        // a program that quit at once can't be attached to; the exit check still reports it
        detach = await pty
          .attach(p, (bytes) => {
            output = (output + decoder.decode(bytes, { stream: true })).slice(-20_000);
            const u = reopenUrl(output);
            if (u) setUrl(u);
          })
          .catch(() => undefined);
        void check();
      } catch (e) {
        if (!over) finish({ kind: "failed", reason: `로그인 프로그램을 시작하지 못했어요. ${blockedReason(String(e)) ?? ""}`, detail: `login ${provider}\n${plainOutput(String(e))}` });
      }
    }, 150);
    return () => {
      over = true;
      clearTimeout(start);
      clearTimeout(timer);
      detach?.();
      stop();
      // closed before the next check: pick up a sign-in that just landed
      void loadAccounts();
    };
  }, [id, provider, switching, loadAccounts]);

  const done = state.kind === "success";
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onClose, 1800);
    return () => clearTimeout(t);
  }, [done, onClose]);

  const cancel = () => {
    stop();
    setState({ kind: "cancelled" });
  };
  const bad = state.kind === "failed" || state.kind === "cancelled";

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex shrink-0 flex-col gap-2.5 rounded-xl px-4 py-3.5"
      style={{
        background: bad ? "var(--block-bg)" : "var(--chip)",
        border: `1px solid ${bad ? "var(--block)" : done ? "var(--work)" : "var(--amber)"}`,
      }}
    >
      {state.kind === "success" && (
        <span className="text-[14px] font-semibold" style={{ color: "var(--work-ink)" }}>
          ✓ 로그인됨: {name}
        </span>
      )}

      {state.kind === "waiting" && (
        <>
          <span className="flex items-center gap-2 text-[14px] font-semibold">
            <span className="s-work size-2 shrink-0 rounded-full" style={{ background: "var(--amber)" }} />
            {provider === "antigravity" ? `${name} 연결 중…` : "브라우저에서 로그인 중…"}
          </span>
          <span className="text-[12.5px] leading-relaxed text-ink-2">
            {provider === "antigravity"
              ? "아래 화면의 안내에 따라 Google 계정으로 로그인해 주세요."
              : `열린 브라우저에서 ${name} 로그인만 하면 돼요. 끝나면 여기가 알아서 바뀌어요.`}
            {switching && " 브라우저에 지금 계정이 이미 들어가 있으면, 그 화면에서 다른 계정으로 바꿔 주세요."}
          </span>
          <div className="flex flex-wrap gap-2">
            {provider !== "antigravity" && (
              <button onClick={() => (url ? void openUrl(url) : onRetry())} className="min-h-8 rounded-full px-3.5 text-[12.5px]" style={{ border: "1px solid var(--line)" }}>
                브라우저 다시 열기
              </button>
            )}
            <button onClick={cancel} className="min-h-8 rounded-full border-0 bg-transparent px-3 text-[12.5px] text-ink-2">
              취소
            </button>
          </div>
        </>
      )}

      {bad && (
        <>
          <span className="text-[14px] font-semibold" style={{ color: "var(--block-ink)" }}>
            {state.kind === "cancelled" ? "로그인을 취소했어요" : `${name}에 연결하지 못했어요`}
          </span>
          <span className="text-[12.5px] leading-relaxed">
            {state.kind === "failed" ? state.reason : "연결하려면 다시 시도를 눌러 주세요."}
            {switching && " 원래 계정은 그대로예요."}
          </span>
          {state.kind === "failed" && state.detail && <FailureDetail text={state.detail} />}
          <div className="flex gap-2">
            <button onClick={onRetry} className="min-h-9 rounded-full border-0 px-4 text-[13px] font-semibold" style={amber}>
              다시 시도
            </button>
            <button onClick={onClose} className="min-h-9 rounded-full border-0 bg-transparent px-3 text-[12.5px] text-ink-2">
              닫기
            </button>
          </div>
        </>
      )}

      {/* Antigravity signs in from inside its own screen, so that one stays visible */}
      {provider === "antigravity" && state.kind === "waiting" && ptyId != null && (
        <div className="h-[160px] rounded-xl p-3" style={{ background: "var(--term-bg)" }}>
          <TerminalView ptyId={ptyId} fontSize={11.5} className="h-full w-full" />
        </div>
      )}
    </motion.div>
  );
}
