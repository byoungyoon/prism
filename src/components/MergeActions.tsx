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
