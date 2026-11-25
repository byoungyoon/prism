// 합치기 · 완료 on a report card. 합치기 puts the card's work into the team's branch; 완료 just closes
// a card that has nothing to merge. A clash is taken back out and handed to the 총괄 to sort out.
import { useEffect, useState } from "react";
import { useApp } from "../store";
import { api, type MergeCheck, type MergeOutcome, type Project, type Task } from "../lib/api";

/** Picking several cards at once: this card is one of them */
export type Pick = { on: boolean; toggle: () => void };

/** What merging this card would bring in; read again when the card's state changes. */
function useMergeCheck(pid: string, task: Task): MergeCheck | null {
  const [check, setCheck] = useState<MergeCheck | null>(null);
  useEffect(() => {
    let alive = true;
    setCheck(null);
    api
      .taskMergeCheck(pid, task.id)
      .then((c) => alive && setCheck(c))
      .catch(() => alive && setCheck(null));
    return () => {
      alive = false;
    };
  }, [pid, task.id, task.stage, task.branch]);
  return check;
}

const primary = { background: "var(--amber)", color: "#2B2520" } as const;
const quiet = { background: "var(--chip)", color: "var(--text)" } as const;

/** One line of what a merge outcome means, in plain words. */
function NoteLine({ note }: { note: MergeOutcome }) {
  return (
    <span className="text-[12px] leading-snug" style={{ color: note.result === "failed" ? "var(--block-ink)" : "var(--text2)" }}>
      {note.result === "conflict" ? "⚠ " : ""}
      {note.message}
    </span>
  );
}

/** A chat report's card, found by its id in the team's cards. */
export function ReportMerge({ project, team, taskId }: { project: Project; team: { tasks: Task[] }; taskId: string | undefined }) {
  const task = team.tasks.find((t) => t.id === taskId);
  if (!task || task.stage !== "review") return null;
  return (
    <div className="px-3 pb-2.5">
      <MergeActions project={project} task={task} />
    </div>
  );
}

/** The 합치기 / 완료 row of one report card. Shows nothing unless the card is waiting for review. */
export function MergeActions({ project, task, pick }: { project: Project; task: Task; pick?: Pick }) {
  // only a card waiting for review is looked at (git runs per check), so the rest cost nothing
  if (task.stage !== "review") return null;
  return <MergeRow project={project} task={task} pick={pick} />;
}

function MergeRow({ project, task, pick }: { project: Project; task: Task; pick?: Pick }) {
  const setError = useApp((s) => s.setError);
  const check = useMergeCheck(project.id, task);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<MergeOutcome | null>(null);

  const merge = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const [r] = await api.taskMerge(project.id, [task.id]);
      setNote(r ?? null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await api.taskComplete(project.id, task.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 pt-0.5">
      <div className="flex flex-wrap items-center gap-2">
        {!check ? (
          <span className="text-[12px] text-ink-2">바뀐 내용 확인 중…</span>
        ) : check.commits === 0 ? (
          <>
            <span className="min-w-0 flex-auto text-[12px] text-ink-2">합칠 변경이 없어요</span>
            <button onClick={() => void complete()} disabled={busy} className="min-h-8 shrink-0 rounded-full border-0 px-3.5 text-[12.5px] font-semibold disabled:opacity-50" style={quiet}>
              완료
            </button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-auto text-[12px] text-ink-2">파일 {check.files}개가 팀 작업에 합쳐져요</span>
            {pick && (
              <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-2">
                <input type="checkbox" checked={pick.on} onChange={pick.toggle} className="size-4" />
                같이 고르기
              </label>
            )}
            <button onClick={() => void merge()} disabled={busy} className="min-h-8 shrink-0 rounded-full border-0 px-3.5 text-[12.5px] font-semibold disabled:opacity-50" style={primary}>
              {busy ? "합치는 중…" : "합치기"}
            </button>
          </>
        )}
      </div>
      {note && <NoteLine note={note} />}
    </div>
  );
}

/** 선택한 보고들을 한 번에 합치기. Each card is tried in turn; a clash on one doesn't stop the rest. */
export function MergeBulk({ project, taskIds, onClose }: { project: Project; taskIds: string[]; onClose: () => void }) {
  const setError = useApp((s) => s.setError);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<MergeOutcome[] | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      setNotes(await api.taskMerge(project.id, taskIds));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (notes) {
    const merged = notes.filter((n) => n.result === "merged").length;
    return (
      <div className="flex flex-col gap-1.5 rounded-xl px-3 py-2.5" style={{ background: "var(--glass2)" }}>
        <span className="text-[13px] font-semibold">{merged}장을 합쳤어요{notes.length > merged ? ` · ${notes.length - merged}장은 그대로 둬요` : ""}</span>
        {notes.map((n) => (
          <NoteLine key={n.taskId} note={n} />
        ))}
        <button onClick={onClose} className="mt-1 self-end min-h-8 rounded-full border-0 px-3.5 text-[12.5px] font-semibold" style={quiet}>
          닫기
        </button>
      </div>
    );
  }

  return (
    <div className="glass-soft flex flex-wrap items-center gap-2 rounded-xl py-2 pr-2 pl-3">
      <span className="min-w-0 flex-auto text-[12.5px]">{taskIds.length ? `${taskIds.length}장 고름 · 팀 작업에 한꺼번에 합쳐요` : "합칠 보고를 골라주세요"}</span>
      <button onClick={onClose} className="min-h-8 shrink-0 rounded-full border-0 px-3 text-[12.5px]" style={quiet}>
        그만두기
      </button>
      <button onClick={() => void run()} disabled={!taskIds.length || busy} className="min-h-8 shrink-0 rounded-full border-0 px-3.5 text-[12.5px] font-semibold disabled:opacity-50" style={primary}>
        {busy ? "합치는 중…" : "고른 것 합치기"}
      </button>
    </div>
  );
}

/** Run 합치기 on cards one by one; stops at the first clash or failure. Returns what happened so far. */
async function mergeInOrder(pid: string, ids: string[]): Promise<{ notes: MergeOutcome[]; stoppedAt: string | null }> {
  const notes: MergeOutcome[] = [];
  for (const id of ids) {
    const [r] = await api.taskMerge(pid, [id]);
    if (!r) continue;
    notes.push(r);
    if (r.result === "conflict" || r.result === "failed") return { notes, stoppedAt: id };
  }
  return { notes, stoppedAt: null };
}

/** 같은 팀의 합치기 대기 카드 여러 장을 한 카드로: 목록 + 모두 합치기, 개별 합치기도 가능. */
export function MergeGroup({ project, tasks }: { project: Project; tasks: Task[] }) {
  const setError = useApp((s) => s.setError);
  const [busy, setBusy] = useState<string | null>(null); // "all" or a task id
  const [notes, setNotes] = useState<MergeOutcome[]>([]);
  const [stoppedAt, setStoppedAt] = useState<string | null>(null);

  const run = async (ids: string[], key: string) => {
    if (busy) return;
    setBusy(key);
    setStoppedAt(null);
    try {
      const r = await mergeInOrder(project.id, ids);
      setNotes(r.notes);
      setStoppedAt(r.stoppedAt);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  if (tasks.length === 0) return null;
  const merged = notes.filter((n) => n.result === "merged").length;
  return (
    <div className="glass-soft flex flex-col gap-2 rounded-xl px-3 py-2.5">
      <span className="text-[12.5px] font-semibold">합치기를 기다리는 카드 {tasks.length}장</span>
      <div className="flex flex-col gap-1">
        {tasks.map((t) => (
          <div key={t.id} className="flex min-w-0 items-center gap-2 text-[12.5px]">
            <span className="shrink-0 font-mono text-[11px] font-semibold">{t.id}</span>
            <span className="min-w-0 flex-auto truncate">{t.title}</span>
            <button onClick={() => void run([t.id], t.id)} disabled={!!busy} className="min-h-7 shrink-0 rounded-full border-0 px-3 text-[12px] font-semibold disabled:opacity-50" style={quiet}>
              {busy === t.id ? "합치는 중…" : "합치기"}
            </button>
          </div>
        ))}
      </div>
      <button onClick={() => void run(tasks.map((t) => t.id), "all")} disabled={!!busy} className="min-h-8 self-end rounded-full border-0 px-3.5 text-[12.5px] font-semibold disabled:opacity-50" style={primary}>
        {busy === "all" ? "차례로 합치는 중…" : `모두 합치기 (${tasks.length}장)`}
      </button>
      {notes.length > 0 && (
        <div className="flex flex-col gap-1">
          {merged > 0 && <span className="text-[12px] text-ink-2">{merged}장을 합쳤어요</span>}
          {stoppedAt && <span className="text-[12px] font-semibold" style={{ color: "var(--block-ink)" }}>{stoppedAt} 카드에서 멈췄어요. 뒤의 카드는 합치지 않았어요.</span>}
          {notes.filter((n) => n.result !== "merged").map((n) => (
            <NoteLine key={n.taskId} note={n} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 보고함용: 같은 팀 대기 카드가 2장 이상일 때 나오는 모두 합치기 버튼. */
export function MergeAllButton({ project, tasks }: { project: Project; tasks: Task[] }) {
  const setError = useApp((s) => s.setError);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (tasks.length < 2) return null;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await mergeInOrder(project.id, tasks.map((t) => t.id));
      const ok = r.notes.filter((n) => n.result === "merged").length;
      setMsg(r.stoppedAt ? `${ok}장 합치고 ${r.stoppedAt}에서 멈췄어요` : `${ok}장을 합쳤어요`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 pb-1">
      <button onClick={() => void run()} disabled={busy} className="min-h-8 shrink-0 rounded-full border-0 px-3.5 text-[12.5px] font-semibold disabled:opacity-50" style={primary}>
        {busy ? "합치는 중…" : `${tasks.length > 0 ? project.name + " " : ""}모두 합치기 (${tasks.length}장)`}
      </button>
      {msg && <span className="text-[12px] text-ink-2">{msg}</span>}
    </div>
  );
}
