// The big editing screen for a file an outside editor opens. It puts the team's copy into the
// editor's frame, then every 2 s asks the team whether the file changed. A change the person didn't
// make is loaded in by itself; unsaved edits of theirs turn it into a choice. Saving goes through
// the engine and writes the file back to the task folder.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../store";
import { useEngineEdit, type EditTarget } from "./editing";
import { engineAvailable } from "./registry";
import { fromBase64, toBase64 } from "./bytes";
import { EditorCritters } from "./EditorCritters";
import { stageDirector } from "./drawShow";

const TICK_MS = 2000;
const READY_MS = 15000;
const FLASH_MS = 3000;
const NOT_READY = "편집기가 제때 열리지 않았어요. 잠시 뒤에 다시 열어 보세요.";

const basename = (p: string) => p.split(/[\\/]/).pop() || p;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** actions the buttons call; they live inside the effect that owns the state */
interface Editor {
  save(): Promise<boolean>;
  reload(): Promise<void>;
  keep(): void;
  /** asked live, not from the 2 s check: closing must not lose an edit made a moment ago */
  dirtyNow(): Promise<boolean>;
}

export function EngineStage({ target, hidden }: { target: EditTarget; hidden: boolean }) {
  const { projectId: pid, taskId, path, engine } = target;
  const name = basename(path);
  const close = useEngineEdit((s) => s.close);
  const setError = useApp((s) => s.setError);
  // the AI is changing this file while its task (or a follow-up on it) runs
  const working = useApp((s) => {
    const t = s.teams[pid];
    return !!t && t.tasks.some((x) => x.stage === "running" && (x.id === taskId || x.followOf === taskId));
  });

  const frame = useRef<HTMLIFrameElement>(null);
  const editor = useRef<Editor | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [failMsg, setFailMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [flash, setFlash] = useState(false);
  // counts the team's changes loaded into the editor (the critters hop on each one)
  const [changes, setChanges] = useState(0);
  const [askClose, setAskClose] = useState(false);
  const [busy, setBusy] = useState(false);
  // whether this build ships the editor for the file; undefined while checking
  const [installed, setInstalled] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setInstalled(undefined);
    engineAvailable(engine).then((ok) => alive && setInstalled(ok));
    return () => {
      alive = false;
    };
  }, [engine]);

  useEffect(() => {
    // no editor in this build: nothing to start, the screen shows the 설치 필요 note
    if (installed !== true) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    let busyNow = false;
    let gen = 0; // bumped by save/reload: a check that started before them is stale
    let shown = ""; // stamp of the copy the editor shows now
    let seen = ""; // the team's newer stamp while a conflict waits for the person's choice
    const win = () => frame.current?.contentWindow ?? null;

    // takes the team's copy into the editor; its stamp becomes the one we show
    const pull = async () => {
      const { b64, stamp } = await api.taskFileBytes(pid, taskId, path);
      const w = win();
      if (!w) throw new Error("편집 화면이 닫혔어요");
      await engine.load(w, fromBase64(b64), name);
      shown = stamp;
    };

    const waitForEngine = async () => {
      const t0 = Date.now();
      while (alive) {
        const w = win();
        let ok = false;
        try {
          ok = !!w && engine.ready(w);
        } catch {
          ok = false;
        }
        if (ok) return true;
        if (Date.now() - t0 > READY_MS) throw new Error(NOT_READY);
        await sleep(200);
      }
      return false;
    };

    const save = async () => {
      const w = win();
      if (!w || busyNow) return false;
      busyNow = true;
      gen++;
      setBusy(true);
      try {
        const bytes = await engine.save(w);
        shown = await api.taskFileSave(pid, taskId, path, toBase64(bytes));
        if (alive) {
          setDirty(false);
          setConflict(false);
        }
        return true;
      } catch (e) {
        setError(`저장하지 못했어요: ${messageOf(e)}`);
        return false;
      } finally {
        busyNow = false;
        if (alive) setBusy(false);
      }
    };

    editor.current = {
      save,
      reload: async () => {
        busyNow = true;
        gen++;
        setBusy(true);
        try {
          await pull();
          if (alive) {
            setDirty(false);
            setConflict(false);
          }
        } catch (e) {
          setError(`파일을 다시 불러오지 못했어요: ${messageOf(e)}`);
        } finally {
          busyNow = false;
          if (alive) setBusy(false);
        }
      },
      // the person keeps their own copy: it will overwrite the team's change on save
      keep: () => {
        shown = seen;
        setConflict(false);
      },
      dirtyNow: async () => {
        const w = win();
        return !!w && !!engine.isDirty && (await engine.isDirty(w));
      },
    };

    // one check: did the team's copy change, and did the person edit the editor's copy
    const tick = async () => {
      const w = win();
      if (!alive || !w || busyNow) return;
      const startGen = gen;
      try {
        const stamp = await api.taskFileStamp(pid, taskId, path);
        const edited = engine.isDirty ? await engine.isDirty(w) : false;
        // a save or reload happened meanwhile: its result is newer than what this check read
        if (!alive || gen !== startGen || busyNow) return;
        setDirty(edited);
        if (stamp === shown) {
          setConflict(false);
          return;
        }
        if (edited) {
          seen = stamp;
          setConflict(true);
          return;
        }
        // the team changed it and the person has nothing unsaved: take the new copy in
        // (the critters' drawing show covers the old picture first, then draws the change in)
        busyNow = true;
        try {
          await stageDirector.before(w);
          await pull();
        } finally {
          busyNow = false;
        }
        if (!alive) return;
        void stageDirector.after(w);
        setDirty(false);
        setFlash(true);
        setChanges((n) => n + 1);
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => alive && setFlash(false), FLASH_MS);
      } catch {
        // a dropped connection or a busy engine: the next tick tries again
      }
    };

    const loop = async () => {
      await tick();
      if (alive) timer = setTimeout(loop, TICK_MS);
    };

    (async () => {
      try {
        if (!(await waitForEngine())) return;
        await pull();
        if (!alive) return;
        setPhase("ready");
        timer = setTimeout(loop, TICK_MS);
      } catch (e) {
        if (!alive) return;
        setFailMsg(messageOf(e));
        setPhase("failed");
      }
    })();

    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(flashTimer);
      editor.current = null;
    };
  }, [pid, taskId, path, engine, name, setError, installed]);

  const tryClose = async () => {
    // ask the editor now, but don't hang on an engine that doesn't answer: fall back to the last check
    const live = await Promise.race([
      editor.current?.dirtyNow().catch(() => dirty),
      new Promise<boolean>((r) => setTimeout(() => r(dirty), 1500)),
    ]);
    if (live ?? dirty) setAskClose(true);
    else close();
  };
  const saveAndClose = async () => {
    if (await editor.current?.save()) close();
    else setAskClose(false);
  };

  const status = installed === false
    ? { text: "설치 필요", color: "var(--text2)" }
    : busy
    ? { text: "저장하는 중…", color: "var(--text2)" }
    : working
      ? { text: "AI가 고치는 중", color: "var(--amber)" }
      : dirty
        ? { text: "바뀜 (저장 안 함)", color: "var(--block-ink)" }
        : { text: "저장됨", color: "var(--work-ink)" };

  return (
    <div className={`${hidden ? "hidden" : "flex"} relative min-h-0 min-w-0 flex-auto flex-col gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]`}>
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl px-3.5 py-2.5">
        <span aria-hidden="true" className="text-[16px]">
          {engine.icon}
        </span>
        <span className="min-w-0 flex-auto truncate font-mono text-[13px] font-semibold" title={path}>
          {name}
        </span>
        <span className="shrink-0 text-[12px] font-medium" style={{ color: status.color }} role="status">
          {status.text}
        </span>
        <span className="flex shrink-0 gap-1.5">
          <button
            onClick={() => void editor.current?.save()}
            disabled={phase !== "ready" || busy}
            className="min-h-8 rounded-full border-0 px-3.5 text-[12.5px] font-semibold disabled:opacity-50"
            style={{ background: "var(--amber)", color: "#2B2520" }}
          >
            저장
          </button>
          <button onClick={tryClose} className="min-h-8 rounded-full px-3 text-[12.5px]" style={{ border: "1px solid var(--line)", background: "var(--tile)" }}>
            닫기
          </button>
        </span>
      </div>

      {flash && (
        <p role="status" className="m-0 px-1 text-[12.5px]" style={{ color: "var(--work-ink)" }}>
          방금 AI가 고쳤어요. 새 내용을 불러왔어요.
        </p>
      )}

      {conflict && (
        <div role="alert" className="glass flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px]" style={{ border: "1.5px solid var(--amber)" }}>
          <div className="min-w-0 flex-auto">
            <div className="font-semibold">팀이 파일을 고쳤어요</div>
            <div className="text-[12px] text-ink-2">새 것을 불러오면 저장 안 한 내 수정은 사라져요. 내 것을 유지하면 저장할 때 팀의 수정이 덮어써져요.</div>
          </div>
          <span className="flex shrink-0 gap-1.5">
            <button onClick={() => void editor.current?.reload()} className="min-h-8 rounded-full border-0 px-3 text-[12.5px] font-semibold" style={{ background: "var(--amber)", color: "#2B2520" }}>
              새 것 불러오기
            </button>
            <button onClick={() => editor.current?.keep()} className="min-h-8 rounded-full px-3 text-[12.5px]" style={{ border: "1px solid var(--line)", background: "var(--tile)" }}>
              내 것 유지
            </button>
          </span>
        </div>
      )}

      {askClose && (
        <div role="alert" className="glass flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px]" style={{ border: "1.5px solid var(--block)" }}>
          <span className="min-w-0 flex-auto font-semibold">저장하지 않은 내용이 있어요</span>
          <span className="flex shrink-0 gap-1.5">
            <button onClick={() => void saveAndClose()} className="min-h-8 rounded-full border-0 px-3 text-[12.5px] font-semibold" style={{ background: "var(--amber)", color: "#2B2520" }}>
              저장하고 닫기
            </button>
            <button onClick={close} className="min-h-8 rounded-full px-3 text-[12.5px]" style={{ border: "1px solid var(--line)", color: "var(--block-ink)" }}>
              버리고 닫기
            </button>
            <button onClick={() => setAskClose(false)} className="min-h-8 rounded-full px-3 text-[12.5px]" style={{ border: "1px solid var(--line)", background: "var(--tile)" }}>
              계속 편집
            </button>
          </span>
        </div>
      )}

      <div className="relative min-h-0 flex-auto overflow-hidden rounded-2xl bg-white" style={{ border: "1px solid var(--glass-border)" }}>
        {installed === false ? (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="max-w-[380px] text-[14px] leading-relaxed text-[var(--text)]">이 파일을 고치는 편집기가 이 앱에 설치돼 있지 않아요 (설치 필요).</span>
            <span className="max-w-[380px] text-[12.5px] text-ink-2">지금은 고칠 수 없어요. 바뀐 내용은 작업 보고에서 볼 수 있어요.</span>
            <button onClick={close} className="min-h-8 rounded-full px-3.5 text-[12.5px]" style={{ border: "1px solid var(--line)", background: "var(--tile)" }}>
              닫기
            </button>
          </div>
        ) : phase === "failed" ? (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="max-w-[360px] text-[14px] leading-relaxed text-[var(--text)]">{failMsg}</span>
            <button onClick={close} className="min-h-8 rounded-full px-3.5 text-[12.5px]" style={{ border: "1px solid var(--line)", background: "var(--tile)" }}>
              닫기
            </button>
          </div>
        ) : (
          <>
            {installed === true && <iframe ref={frame} src={engine.url} title={`${name} 편집`} className="block size-full border-0" />}
            {installed === true && <EditorCritters target={target} frame={frame} ready={phase === "ready"} changed={changes} />}
            {(installed === undefined || phase === "loading") && (
              <div className="absolute inset-0 z-10 flex items-center justify-center text-[13px] text-ink-2" style={{ background: "var(--bg1)" }}>
                편집기를 준비하는 중…
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
