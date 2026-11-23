// The control tower's report feed: one card per task, newest first, with live activity while it runs
// and the actual result (files, diff, HTML preview) when it's done. Pending permission requests
// are gathered into a single card on top so the user answers them in one place.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useApp, useShownTeams } from "../store";
import { api, type Agent, type ChatMsg, type FileStat, type Project, type Task, type TeamSnapshot } from "../lib/api";
import { TeamTag } from "./TeamTag";
import { elapsed } from "../data/types";
import { modelLabel } from "../data/models";
import { ChevronDown } from "./icons";
import { FailPill } from "./ReportFold";

const spring = { type: "spring" as const, stiffness: 260, damping: 28 };


// ── permissions, gathered ─────────────────────────────

function PermissionsCard({ items, team, project, multi }: { items: ChatMsg[]; team: TeamSnapshot; project: Project; multi: boolean }) {
  const answerPermission = useApp((s) => s.answerPermission);
  const answer = (id: number, a: "allow" | "always" | "deny") => answerPermission(id, a, project.id);
  const name = (id: string) => team.agents.find((a) => a.id === id)?.name ?? id;
  // requests a 팀장/총괄 is deciding don't need the user (who can still answer first)
  const mine = items.filter((m) => !m.permission!.decider);
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={spring}
      className="glass flex flex-col gap-3 rounded-2xl p-4"
      style={{ border: `1.5px solid ${mine.length ? "var(--amber)" : "var(--line)"}`, boxShadow: "var(--shadow-sm), var(--hi)" }}
    >
      <div className="flex items-center gap-2">
        {mine.length > 0 && <span className="s-work size-2 rounded-full" style={{ background: "var(--amber)" }} />}
        {multi && <TeamTag project={project} className="text-[12px]" />}
        <h3 className="m-0 flex-auto text-[14px] font-semibold">
          {mine.length ? `허락이 필요해요 · ${mine.length}건` : `윗선이 판단 중 · ${items.length}건`}
        </h3>
        {mine.length > 1 && (
          <button
            onClick={() => mine.forEach((m) => void answer(m.id, "allow"))}
            className="min-h-8 rounded-full border-0 px-3.5 text-[12.5px] font-semibold"
            style={{ background: "var(--amber)", color: "#2B2520" }}
          >
            모두 허용
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {items.map((m) => {
          const p = m.permission!;
          return (
            <motion.div key={m.id} layout exit={{ opacity: 0, height: 0 }} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "var(--glass2)" }}>
              <span className="shrink-0 text-[12.5px] font-semibold">{name(p.agentId)}</span>
              {p.decider && <span className="shrink-0 text-[11.5px] text-ink-2">{name(p.decider)}가 판단 중</span>}
              <code className="min-w-0 flex-[1_1_200px] truncate rounded-md px-2 py-1 font-mono text-[11.5px] select-text" style={{ background: "var(--term-bg)", color: "#efe6d8" }} title={p.detail}>
                {p.tool === "Bash" ? `명령 실행 · ${p.detail}` : `${p.tool} · ${p.detail}`}
              </code>
              <span className="flex shrink-0 gap-1">
                <button onClick={() => answer(m.id, "allow")} className="min-h-7 rounded-full border-0 px-3 text-[12px] font-semibold" style={{ background: "var(--amber)", color: "#2B2520" }}>
                  허용
                </button>
                <button onClick={() => answer(m.id, "always")} className="min-h-7 rounded-full px-2.5 text-[12px]" style={{ border: "1px solid var(--line)", background: "var(--tile)" }}>
                  항상 허용
                </button>
                <button onClick={() => answer(m.id, "deny")} className="min-h-7 rounded-full px-2.5 text-[12px]" style={{ border: "1px solid var(--line)", color: "var(--block-ink)" }}>
                  거부
                </button>
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </motion.section>
  );
}

// ── results ───────────────────────────────────────────

const isHtml = (p: string) => /\.html?$/i.test(p);
const isPreviewable = (p: string) => isHtml(p) || /\.svg$/i.test(p);

function DiffView({ text }: { text: string }) {
  return (
    <pre className="m-0 max-h-80 overflow-auto rounded-xl p-3 font-mono text-[11.5px] leading-relaxed select-text" style={{ background: "var(--term-bg)", color: "#e8dfd2" }}>
      {text.split("\n").map((l, i) => (
        <div
          key={i}
          style={{
            color: l.startsWith("+") && !l.startsWith("+++") ? "#9cc9a6" : l.startsWith("-") && !l.startsWith("---") ? "#ec8b77" : l.startsWith("@@") ? "#aebde3" : undefined,
          }}
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

function Results({ task, pid }: { task: Task; pid: string }) {
  const [files, setFiles] = useState<FileStat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [content, setContent] = useState<{ path: string; kind: "preview" | "diff"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .taskFiles(pid, task.id)
      .then((f) => {
        if (!alive) return;
        setFiles(f);
        const first = f.find((x) => isPreviewable(x.path));
        if (first) setOpen(first.path);
      })
      .catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [pid, task.id, task.stage]);

  useEffect(() => {
    if (!open) return setContent(null);
    let alive = true;
    const kind = isPreviewable(open) ? "preview" : "diff";
    (kind === "preview" ? api.taskFile(pid, task.id, open) : api.taskDiff(pid, task.id, open))
      .then((text) => alive && setContent({ path: open, kind, text }))
      .catch((e) => alive && setContent({ path: open, kind: "diff", text: String(e) }));
    return () => {
      alive = false;
    };
  }, [pid, task.id, open]);

  if (err) return null;
  if (!files) return <span className="text-xs text-ink-2">결과 불러오는 중…</span>;
  if (!files.length) return <span className="text-xs text-ink-2">바뀐 파일이 없어요.</span>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {files.map((f) => {
          const on = f.path === open;
          return (
            <button
              key={f.path}
              onClick={() => setOpen(on ? null : f.path)}
              className="flex min-h-7 items-center gap-1.5 rounded-full px-2.5 font-mono text-[11.5px]"
              style={{ background: on ? "var(--navy)" : "var(--chip)", color: on ? "var(--me-fg)" : "var(--text)" }}
              title={f.path}
            >
              {isPreviewable(f.path) && <span aria-hidden="true">👁</span>}
              <span className="max-w-[220px] truncate">{f.path}</span>
              {f.added >= 0 && (
                <span className="opacity-80">
                  <span style={{ color: on ? undefined : "var(--work-ink)" }}>+{f.added}</span>{" "}
                  <span style={{ color: on ? undefined : "var(--block-ink)" }}>−{f.removed}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait">
        {content && (
          <motion.div key={content.path} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
            {content.kind === "preview" ? (
              <div className="overflow-hidden rounded-xl" style={{ border: "1px solid var(--glass-border)", boxShadow: "0 10px 24px rgba(120,90,50,0.14)" }}>
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-ink-2" style={{ background: "var(--glass2)" }}>
                  <span className="size-2 rounded-full" style={{ background: "#ec8b77" }} />
                  <span className="size-2 rounded-full" style={{ background: "#f0cd85" }} />
                  <span className="size-2 rounded-full" style={{ background: "#9cc9a6" }} />
                  <span className="ml-2 font-mono">{content.path} · 미리보기</span>
                </div>
                {/* sandboxed: scripts run, but no access to the app */}
                <iframe title={`${content.path} 미리보기`} srcDoc={content.text} sandbox="allow-scripts" className="block h-[360px] w-full border-0 bg-white" />
              </div>
            ) : (
              <>
                <div className="mb-1 text-[11px] text-ink-2">바뀐 내용 (자세한 정보)</div>
                <DiffView text={content.text} />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── one piece of work ─────────────────────────────

const WORD: Record<Task["stage"], string> = { queued: "대기", running: "진행 중", review: "검토", done: "완료", failed: "실패" };

/** State in plain words; only problems get color. */
function stateOf(task: Task, team: TeamSnapshot) {
  const a = team.agents.find((x) => x.id === task.assignee);
  if (task.stage === "failed") return { word: "실패", problem: true };
  if (task.stage === "running" && a?.status === "block") return { word: "막힘", problem: true };
  return { word: WORD[task.stage], problem: false };
}

/** The card a task was split from: its requester's own card (a 팀장 handing work to 작업자). */
const parentOf = (task: Task, team: TeamSnapshot) => {
  const by = team.agents.find((a) => a.id === task.requestedBy);
  return by && by.role !== "lead" ? by.taskId : null;
};

/** The newest thing anyone on this work did, as one line. */
function latest(agents: Agent[]) {
  return agents.flatMap((a) => a.activity.map((x) => ({ ...x, who: a.name }))).sort((a, b) => b.at - a.at)[0];
}

function SubRow({ task, team, onOpen }: { task: Task; team: TeamSnapshot; onOpen: (id: string) => void }) {
  const a = team.agents.find((x) => x.id === task.assignee);
  const st = stateOf(task, team);
  const follow = !!task.followOf;
  return (
    <button
      onClick={() => a && onOpen(a.id)}
      disabled={!a}
      className="flex min-h-8 w-full flex-wrap items-center gap-x-2 rounded-lg border-0 bg-transparent px-2 py-1 text-left text-[12.5px] hover:bg-[var(--chip)] disabled:hover:bg-transparent"
    >
      <span className="w-9 shrink-0 font-mono text-[11.5px] font-semibold">{task.id}</span>
      {follow && (
        <span className="shrink-0 rounded px-1.5 text-[10.5px] font-medium text-ink-2" style={{ background: "var(--chip)" }}>
          이어서
        </span>
      )}
      <span className="min-w-0 flex-auto truncate">{task.title}</span>
      <span className="shrink-0 text-[11.5px] text-ink-2">{a?.name ?? "배정 전"}</span>
      <span className="w-12 shrink-0 text-right text-[11.5px] font-medium" style={{ color: st.problem ? "var(--block-ink)" : "var(--text2)" }}>
        {st.word}
      </span>
      {follow && task.summary && (task.stage === "review" || task.stage === "done") && (
        <span className="basis-full pt-0.5 pl-11 text-[12px] leading-snug text-ink-2 select-text">{task.summary}</span>
      )}
    </button>
  );
}

/** "이어서 시키기": hand more work on this card to whoever did it, right from the report. */
function FollowUp({ project, target, who }: { project: Project; target: Task; who: string }) {
  const setError = useApp((s) => s.setError);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await api.followUp(project.id, target.id, t);
      setText("");
      setOpen(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="self-start rounded-full border-0 px-3 py-1 text-[12px] font-medium" style={{ background: "var(--chip)", color: "var(--text)" }}>
        이어서 시키기
      </button>
    );
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.querySelector("input")?.focus();
      }}
      className="glass-soft flex items-center gap-2 rounded-xl py-1.5 pr-1.5 pl-3"
    >
      <input
        autoFocus
        aria-label={`${who}에게 이어서 시킬 일`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") void send();
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => !text.trim() && setOpen(false)}
        placeholder={`${who}에게 이어서 시킬 일 (예: 버튼 색을 파란색으로)`}
        className="min-h-8 min-w-0 flex-auto border-0 bg-transparent text-[13px] outline-none"
      />
      <button
        onClick={() => void send()}
        disabled={!text.trim() || busy}
        aria-label="이어서 시키기"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border-0 disabled:opacity-50"
        style={{ background: "var(--amber)", color: "#2B2520" }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}

/** A finished piece of work folds to one line unless opened; `fold` is absent while work is still going. */
type Fold = { open: boolean; toggle: () => void };

function TaskCard({ task, subs, team, project, fold }: { task: Task; subs: Task[]; team: TeamSnapshot; project: Project; fold?: Fold }) {
  const openIn = useApp((s) => s.openIn);
  const open = (id: string) => openIn(project.id, { name: "agent", id });
  const st = stateOf(task, team);
  const assignee = team.agents.find((a) => a.id === task.assignee);
  // everyone on this piece of work: its owner and whoever works under them
  const crew = team.agents.filter((a) => a.id === task.assignee || (assignee && a.parentId === assignee.id));
  const last = latest(crew);
  const leadNote = [...team.chat].reverse().find((m) => (m.kind === "lead" || m.kind === "report") && m.taskIds.includes(task.id) && m.at >= task.updatedAt - 1000);
  const finished = task.stage === "review" || task.stage === "done" || task.stage === "failed";
  const doneSubs = subs.filter((t) => t.stage === "done").length;
  // follow-ups go to the newest card in this line of work, so one in progress isn't overtaken
  const target = [task, ...subs.filter((t) => t.followOf)].sort((a, b) => a.createdAt - b.createdAt).pop()!;
  const canFollow = !!target.assignee && target.stage !== "queued";
  // folded: only the first line of the result shows until the card is opened
  const shut = !!fold && !fold.open;
  const firstLine = (leadNote?.text ?? task.summary ?? "").split("\n").find((l) => l.trim())?.trim() ?? "";

  const head = (
    <>
      <span className="shrink-0 font-mono text-[12px] font-semibold text-ink-2">{task.id}</span>
      <span role="heading" aria-level={3} className="m-0 min-w-0 flex-auto truncate text-[15px] font-semibold">
        {task.title}
      </span>
      {task.stage === "failed" ? (
        <FailPill />
      ) : (
        <span className="shrink-0 text-[12px] font-medium" style={{ color: st.problem ? "var(--block-ink)" : "var(--text2)" }}>
          {st.word}
        </span>
      )}
      <span className="shrink-0 text-[11.5px] text-ink-2">· {elapsed(task.updatedAt)} 전</span>
      {fold && <ChevronDown size={15} className="shrink-0 self-center text-ink-2" style={{ transform: fold.open ? "rotate(180deg)" : undefined, transition: "transform 160ms" }} />}
    </>
  );

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="glass flex flex-col gap-2.5 rounded-2xl px-4 py-3.5"
      style={{ boxShadow: `${st.problem ? "inset 3px 0 0 var(--block), " : ""}var(--shadow-sm), var(--hi)` }}
    >
      {fold ? (
        <button type="button" aria-expanded={fold.open} onClick={fold.toggle} className="flex w-full min-w-0 items-baseline gap-2 border-0 bg-transparent p-0 text-left">
          {head}
        </button>
      ) : (
        <header className="flex items-baseline gap-2">{head}</header>
      )}

      <div className="flex min-w-0 items-center gap-2 text-[12px] text-ink-2">
        {assignee ? (
          <button onClick={() => open(assignee.id)} className="border-0 bg-transparent p-0 text-[12px] text-ink-2 hover:text-[var(--text)] hover:underline" title="작업 화면 보기">
            {assignee.name} · <span className="font-mono text-[11px]">{modelLabel(assignee.model)}</span>
          </button>
        ) : (
          <span>맡을 사람을 기다려요</span>
        )}
        {!finished && last && (
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px]">
            <span aria-hidden="true">›</span>
            <span className="shrink-0">{last.who}</span>
            <span className="truncate text-[var(--text)]">{last.text}</span>
          </span>
        )}
        {!finished && !last && task.stage === "running" && <span>· 시작하는 중</span>}
      </div>

      {shut && firstLine && (
        <p className="m-0 truncate pl-0.5 text-[13px]" style={{ color: task.stage === "failed" ? "var(--block-ink)" : "var(--text2)" }}>
          {firstLine}
        </p>
      )}
      {finished && !shut && (task.summary || leadNote) && (
        <div className="flex flex-col gap-1.5 rounded-xl px-3 py-2.5" style={{ background: task.stage === "failed" ? "var(--block-bg)" : "var(--glass2)" }}>
          {leadNote ? (
            <p className="m-0 text-[13.5px] leading-relaxed whitespace-pre-wrap select-text">{leadNote.text}</p>
          ) : (
            <p className="m-0 text-[13.5px] leading-relaxed whitespace-pre-wrap select-text">{task.summary}</p>
          )}
          {leadNote && task.summary && <p className="m-0 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2 select-text">{assignee?.name ?? "작업자"}: {task.summary}</p>}
        </div>
      )}
      {finished && !shut && task.stage !== "failed" && <Results task={task} pid={project.id} />}

      {subs.length > 0 && !shut && (
        <div className="flex flex-col gap-1 pt-1" style={{ borderTop: "1px solid var(--line)" }}>
          <span className="flex items-center gap-2 px-2 pt-1 text-[11.5px] text-ink-2">
            {subs.some((t) => !t.followOf) ? "하위 작업" : "이어서 한 일"} {doneSubs}/{subs.length} 완료
            <span className="h-1 max-w-[120px] flex-auto overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
              <span className="block h-full rounded-full" style={{ width: `${(doneSubs / subs.length) * 100}%`, background: "var(--text2)" }} />
            </span>
          </span>
          {subs.map((t) => (
            <SubRow key={t.id} task={t} team={team} onOpen={open} />
          ))}
        </div>
      )}
      {canFollow && !shut && <FollowUp project={project} target={target} who={team.agents.find((a) => a.id === target.assignee)?.name ?? "담당자"} />}
    </motion.article>
  );
}

// ── feed ──────────────────────────────────────────────

/** problems first, then work in progress, then results to check, then what's waiting, then done */
const ORDER: Record<string, number> = { problem: 0, running: 1, review: 2, queued: 3, failed: 0, done: 4 };
const rank = (t: Task, team: TeamSnapshot) => (stateOf(t, team).problem ? 0 : ORDER[t.stage]);

function TeamSection({ project, team, multi }: { project: Project; team: TeamSnapshot; multi: boolean }) {
  const [allDone, setAllDone] = useState(false);
  const byId = new Map(team.tasks.map((t) => [t.id, t]));
  // the card a piece of work hangs under: follow-ups and sub-work climb to their first card
  const rootOf = (t: Task): Task => {
    for (let cur = t, i = 0; i < 20; i++) {
      const up = byId.get(cur.followOf ?? parentOf(cur, team) ?? "");
      if (!up) return cur;
      cur = up;
    }
    return t;
  };
  const top = team.tasks.filter((t) => rootOf(t) === t);
  const subsOf = (t: Task) => team.tasks.filter((x) => x !== t && rootOf(x) === t).sort((a, b) => a.createdAt - b.createdAt);
  // a finished card with a follow-up in progress counts as in progress
  const eff = (t: Task) => Math.min(rank(t, team), ...subsOf(t).map((x) => rank(x, team)));
  const last = (t: Task) => Math.max(t.updatedAt, ...subsOf(t).map((x) => x.updatedAt));
  const sorted = [...top].sort((a, b) => eff(a) - eff(b) || last(b) - last(a));
  const active = sorted.filter((t) => eff(t) < ORDER.done);
  const done = sorted.filter((t) => eff(t) >= ORDER.done);
  const shownDone = allDone ? done : done.slice(0, 3);
  // a piece of work is a finished report once nothing on it is still going; reports fold unless opened
  const settled = (x: Task) => x.stage === "review" || x.stage === "done" || x.stage === "failed";
  const isSettled = (t: Task) => settled(t) && subsOf(t).every(settled);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const isOpen = (t: Task) => !isSettled(t) || !!opened[t.id];
  const reports = sorted.filter(isSettled);
  const anyOpen = reports.some(isOpen);
  const setAll = (open: boolean) => setOpened(Object.fromEntries(reports.map((t) => [t.id, open])));
  const foldOf = (t: Task): Fold | undefined => (isSettled(t) ? { open: isOpen(t), toggle: () => setOpened((o) => ({ ...o, [t.id]: !isOpen(t) })) } : undefined);
  if (!top.length) return null;
  return (
    <section aria-label={`${project.name} 보고`} className="flex flex-col gap-2.5">
      {multi && (
        <h2 className="m-0 flex items-baseline gap-2 px-1 pt-1 text-[14px] font-semibold">
          {project.name}
          <span className="text-[12px] font-normal text-ink-2">
            진행 {active.length} · 완료 {done.length}
          </span>
        </h2>
      )}
      {reports.length > 1 && (
        <button onClick={() => setAll(!anyOpen)} className="self-end border-0 bg-transparent px-1 text-[12px] text-ink-2 underline">
          {anyOpen ? "완료된 보고 모두 접기" : "완료된 보고 모두 펼치기"}
        </button>
      )}
      {[...active, ...shownDone].map((t) => (
        <TaskCard key={t.id} task={t} subs={subsOf(t)} team={team} project={project} fold={foldOf(t)} />
      ))}
      {done.length > 3 && (
        <button onClick={() => setAllDone((v) => !v)} className="self-start border-0 bg-transparent px-1 text-[12px] text-ink-2 underline">
          {allDone ? "완료된 일 접기" : `완료된 일 ${done.length - 3}개 더 보기`}
        </button>
      )}
    </section>
  );
}

export function ReportFeed() {
  const shown = useShownTeams();
  if (!shown.length) return null;
  const multi = shown.length > 1;
  const permGroups = shown
    .map(({ project, team }) => ({ project, team, items: team.chat.filter((m) => m.permission && !m.permission.answer) }))
    .filter((g) => g.items.length);
  const any = shown.some(({ team }) => team.tasks.length);

  return (
    <section aria-label="보고 피드" className="flex min-h-0 min-w-0 flex-auto flex-col gap-4 overflow-y-auto px-1 pt-1 pb-4">
      <AnimatePresence initial={false}>
        {permGroups.map((g) => (
          <PermissionsCard key={`perms-${g.project.id}`} items={g.items} team={g.team} project={g.project} multi={multi} />
        ))}
      </AnimatePresence>
      {!any && permGroups.length === 0 && (
        <div className="m-auto flex max-w-[300px] flex-col items-center gap-2 text-center">
          <span className="text-[15px] font-semibold">아직 보고가 없어요</span>
          <span className="text-[13px] leading-relaxed text-ink-2">왼쪽에서 총괄에게 일을 시키면, 작업마다 진행 상황과 결과물이 여기 카드로 쌓여요.</span>
        </div>
      )}
      {shown.map(({ project, team }) => (
        <TeamSection key={project.id} project={project} team={team} multi={multi} />
      ))}
    </section>
  );
}
