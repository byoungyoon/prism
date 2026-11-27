// The report card's decision area: what changed, how the checks went, captures, and 적용하기 / 다시 해줘.
// Nothing is applied until the user presses the button. After that it shrinks to "적용했어요 · 되돌리기".
// A clash is taken back out and handed to the 총괄 to sort out.
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

/** A report's words as plain text: markdown marks off, the first two lines that say something. */
export function brief(text: string | null | undefined) {
  return (text ?? "")
    .replace(/ — (브랜치 |확인 후 complete_task)[\s\S]*$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/, "").replace(/\*\*|__|`/g, "").trim())
    .filter((l) => l && !/^[-|:=*]+$/.test(l))
    .slice(0, 2)
    .join("\n");
}

/** The newest unfinished follow-up of a card (directly or further down): it is being done again there. */
export function redoOf(tasks: Task[], taskId: string): Task | undefined {
  const after = (t: Task) => {
    let up = t.followOf;
    for (let i = 0; up && i < tasks.length; i++) {
      if (up === taskId) return true;
      up = tasks.find((x) => x.id === up)?.followOf ?? null;
    }
    return false;
  };
  return [...tasks].reverse().find((t) => (t.stage === "queued" || t.stage === "running" || t.stage === "review") && after(t));
}

/** Whether a card has anything to show here: waiting to be applied, applied, or taken back. */
export const hasDecision = (t: Task) => t.stage === "review" || !!t.undone || (t.stage === "done" && !!t.applied);

/** A chat report's card, found by its id in the team's cards. `text`: what the 총괄 said about it. */
export function ReportMerge({ project, team, taskId, text }: { project: Project; team: { tasks: Task[] }; taskId: string | undefined; text?: string }) {
  const task = team.tasks.find((t) => t.id === taskId);
  if (!task || !hasDecision(task)) return null;
  return (
    <div className="px-3 pb-2.5">
      <MergeActions project={project} task={task} what={text === undefined ? undefined : brief(text)} />
    </div>
  );
}

/**
 * One report card's decision area. `what`: the one or two lines saying what changed
 * (left out: the card's report; null: already on screen right above).
 */
export function MergeActions({ project, task, pick, what }: { project: Project; task: Task; pick?: Pick; what?: string | null }) {
  if (task.undone) return <span className="block pt-0.5 text-[12px] text-ink-2">↩ 적용한 걸 되돌렸어요</span>;
  if (task.stage === "done" && task.applied) return <AppliedRow project={project} task={task} />;
  // only a card waiting for review is looked at (git runs per check), so the rest cost nothing
  if (task.stage !== "review") return null;
  return <ReviewRow project={project} task={task} pick={pick} what={what} />;
}

/** "적용했어요 · 되돌리기", asked once more before anything is taken back. */
function AppliedRow({ project, task }: { project: Project; task: Task }) {
  const setError = useApp((s) => s.setError);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const undo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.taskUndo(project.id, task.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      setSure(false);
    }
  };
  const link = "min-h-7 shrink-0 border-0 bg-transparent p-0 text-[12px] text-ink-2 underline disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-x-2 pt-0.5 text-[12px] text-ink-2">
      <span className="font-semibold text-[var(--work-ink)]">✓ 적용했어요</span>
      <span aria-hidden="true">·</span>
      {sure ? (
        <>
          <span>적용하기 전으로 되돌릴까요?</span>
          <button onClick={() => void undo()} disabled={busy} className={`${link} font-semibold`}>
            {busy ? "되돌리는 중…" : "네, 되돌리기"}
          </button>
          <button onClick={() => setSure(false)} disabled={busy} className={link}>
            아니요
          </button>
        </>
      ) : (
        <button onClick={() => setSure(true)} className={link}>
          되돌리기
        </button>
      )}
    </div>
  );
}

function CheckBadge({ check }: { check: Task["check"] }) {
  const style =
    check === "failed" ? { background: "var(--block-bg)", color: "var(--block-ink)" } : { background: "var(--chip)", color: check === "passed" ? "var(--work-ink)" : "var(--text2)" };
  return (
    <span className="shrink-0 rounded-full px-2 py-px text-[11.5px] font-semibold" style={style}>
      {check === "passed" ? "✓ 검사 통과" : check === "failed" ? "✕ 검사 실패" : "검사 결과 없음"}
    </span>
  );
}

const mimeOf = (path: string) => (/\.jpe?g$/i.test(path) ? "image/jpeg" : /\.webp$/i.test(path) ? "image/webp" : "image/png");

/** The captures of the changed screens, read only once they're opened. */
function Shots({ pid, task }: { pid: string; task: Task }) {
  const paths = task.shots ?? [];
  const [urls, setUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    let alive = true;
    void Promise.all(
      paths.map((p) =>
        api
          .taskFileBytes(pid, task.id, p)
          .then((f) => `data:${mimeOf(p)};base64,${f.b64}`)
          .catch(() => null),
      ),
    ).then((u) => alive && setUrls(u));
    return () => {
      alive = false;
    };
  }, [pid, task.id, paths.join("\n")]);
  return (
    <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
      {paths.map((p, i) =>
        urls[i] ? (
          <img key={p} src={urls[i]!} alt={`바뀐 화면 캡처 ${i + 1}`} className="block w-full rounded-lg" style={{ border: "1px solid var(--line)" }} />
        ) : (
          <span key={p} className="text-[12px] text-ink-2">
            {urls.length ? "캡처를 열지 못했어요" : "캡처 불러오는 중…"}
          </span>
        ),
      )}
    </div>
  );
}

/** 다시 해줘: what to change goes to whoever did the card, as its follow-up. */
function RedoBox({ project, task, onClose }: { project: Project; task: Task; onClose: () => void }) {
  const setError = useApp((s) => s.setError);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await api.followUp(project.id, task.id, t);
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <div className="glass-soft flex items-center gap-2 rounded-xl py-1.5 pr-1.5 pl-3">
      <input
        autoFocus
        aria-label={`${task.id} 다시 해달라고 할 내용`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") void send();
          if (e.key === "Escape") onClose();
        }}
        placeholder="어떻게 고칠까요? (예: 버튼 색을 파란색으로)"
        className="min-h-8 min-w-0 flex-auto border-0 bg-transparent text-[13px] outline-none"
      />
      <button onClick={() => void send()} disabled={!text.trim() || busy} className="min-h-8 shrink-0 rounded-full border-0 px-3 text-[12.5px] font-semibold disabled:opacity-50" style={quiet}>
        {busy ? "보내는 중…" : "보내기"}
      </button>
    </div>
  );
}

function ReviewRow({ project, task, pick, what }: { project: Project; task: Task; pick?: Pick; what?: string | null }) {
  const setError = useApp((s) => s.setError);
  const redo = useApp((s) => redoOf(s.teams[project.id]?.tasks ?? [], task.id));
  const check = useMergeCheck(project.id, task);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<MergeOutcome | null>(null);
  const [asking, setAsking] = useState(false);
  const [showShots, setShowShots] = useState(false);
  const summary = what === undefined ? brief(task.summary) : what;
  const shots = task.shots?.length ?? 0;

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

  const button = "min-h-8 shrink-0 rounded-full border-0 px-3.5 text-[12.5px] font-semibold disabled:opacity-50";
  return (
    <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
      {summary && <p className="m-0 line-clamp-2 text-[13px] leading-snug whitespace-pre-line select-text">{summary}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <CheckBadge check={task.check} />
        {shots > 0 && (
          <button onClick={() => setShowShots((v) => !v)} aria-expanded={showShots} className="shrink-0 rounded-full border-0 px-2 py-px text-[11.5px] font-semibold" style={quiet}>
            🖼 바뀐 화면 {shots}장 {showShots ? "접기" : "보기"}
          </button>
        )}
        {check && check.commits > 0 && <span className="text-[12px] text-ink-2">파일 {check.files}개 바뀜</span>}
      </div>
      {showShots && shots > 0 && <Shots pid={project.id} task={task} />}
      {redo ? (
        <span className="text-[12px] text-ink-2">{redo.id}에서 다시 하고 있어요. 그 보고에서 적용해 주세요.</span>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {pick && check && check.commits > 0 && (
            <label className="mr-auto flex shrink-0 items-center gap-1.5 text-[12px] text-ink-2">
              <input type="checkbox" checked={pick.on} onChange={pick.toggle} className="size-4" />
              같이 고르기
            </label>
          )}
          {!check && <span className="mr-auto text-[12px] text-ink-2">바뀐 내용 확인 중…</span>}
          {check?.commits === 0 && <span className="mr-auto text-[12px] text-ink-2">적용할 변경이 없어요</span>}
          <button onClick={() => setAsking((v) => !v)} aria-expanded={asking} disabled={busy} className={button} style={quiet}>
            다시 해줘
          </button>
          {check?.commits === 0 ? (
            <button onClick={() => void complete()} disabled={busy} className={button} style={primary}>
              완료
            </button>
          ) : (
            <button onClick={() => void merge()} disabled={busy || !check} className={button} style={primary}>
              {busy ? "적용하는 중…" : "적용하기"}
            </button>
          )}
        </div>
      )}
      {asking && !redo && <RedoBox project={project} task={task} onClose={() => setAsking(false)} />}
      {note && note.result !== "merged" && <NoteLine note={note} />}
    </div>
  );
}

/** 선택한 보고들을 한 번에 적용하기. Each card is tried in turn; a clash on one doesn't stop the rest. */
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
        <span className="text-[13px] font-semibold">{merged}장을 적용했어요{notes.length > merged ? ` · ${notes.length - merged}장은 그대로 둬요` : ""}</span>
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
      <span className="min-w-0 flex-auto text-[12.5px]">{taskIds.length ? `${taskIds.length}장 고름 · 한꺼번에 적용해요` : "적용할 보고를 골라주세요"}</span>
      <button onClick={onClose} className="min-h-8 shrink-0 rounded-full border-0 px-3 text-[12.5px]" style={quiet}>
        그만두기
      </button>
      <button onClick={() => void run()} disabled={!taskIds.length || busy} className="min-h-8 shrink-0 rounded-full border-0 px-3.5 text-[12.5px] font-semibold disabled:opacity-50" style={primary}>
        {busy ? "적용하는 중…" : "고른 것 적용하기"}
      </button>
    </div>
  );
}

/** Run 적용하기 on cards one by one; stops at the first clash or failure. Returns what happened so far. */
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

/** 같은 팀의 적용 대기 카드 여러 장을 한 카드로: 카드마다 같은 결정 영역 + 모두 적용하기. */
export function MergeGroup({ project, tasks }: { project: Project; tasks: Task[] }) {
  const setError = useApp((s) => s.setError);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<MergeOutcome[]>([]);
  const [stoppedAt, setStoppedAt] = useState<string | null>(null);

  const run = async (ids: string[]) => {
    if (busy) return;
    setBusy(true);
    setStoppedAt(null);
    try {
      const r = await mergeInOrder(project.id, ids);
      setNotes(r.notes);
      setStoppedAt(r.stoppedAt);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (tasks.length === 0) return null;
  const merged = notes.filter((n) => n.result === "merged").length;
  return (
    <div className="glass-soft flex flex-col gap-2 rounded-xl px-3 py-2.5">
      <span className="text-[12.5px] font-semibold">적용을 기다리는 카드 {tasks.length}장</span>
      <div className="flex flex-col gap-1">
        {tasks.map((t) => (
          <div key={t.id} className="flex min-w-0 flex-col gap-1 pb-1.5" style={{ borderBottom: "1px solid var(--line)" }}>
            <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
              <span className="shrink-0 font-mono text-[11px] font-semibold">{t.id}</span>
              <span className="min-w-0 flex-auto truncate font-semibold">{t.title}</span>
            </span>
            <MergeActions project={project} task={t} />
          </div>
        ))}
      </div>
      <button onClick={() => void run(tasks.map((t) => t.id))} disabled={busy} className="min-h-8 self-end rounded-full border-0 px-3.5 text-[12.5px] font-semibold disabled:opacity-50" style={primary}>
        {busy ? "차례로 적용하는 중…" : `모두 적용하기 (${tasks.length}장)`}
      </button>
      {notes.length > 0 && (
        <div className="flex flex-col gap-1">
          {merged > 0 && <span className="text-[12px] text-ink-2">{merged}장을 적용했어요</span>}
          {stoppedAt && <span className="text-[12px] font-semibold" style={{ color: "var(--block-ink)" }}>{stoppedAt} 카드에서 멈췄어요. 뒤의 카드는 적용하지 않았어요.</span>}
          {notes.filter((n) => n.result !== "merged").map((n) => (
            <NoteLine key={n.taskId} note={n} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 보고함용: 같은 팀 대기 카드가 2장 이상일 때 나오는 모두 적용하기 버튼. */
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
      setMsg(r.stoppedAt ? `${ok}장 적용하고 ${r.stoppedAt}에서 멈췄어요` : `${ok}장을 적용했어요`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 pb-1">
      <button onClick={() => void run()} disabled={busy} className="min-h-8 shrink-0 rounded-full border-0 px-3.5 text-[12.5px] font-semibold disabled:opacity-50" style={primary}>
        {busy ? "적용하는 중…" : `${project.name} 모두 적용하기 (${tasks.length}장)`}
      </button>
      {msg && <span className="text-[12px] text-ink-2">{msg}</span>}
    </div>
  );
}
