// The control tower's report feed: one card per task, newest first, with live activity while it runs
// and the actual result (files, diff, HTML preview) when it's done. Pending permission requests
// are gathered into a single card on top so the user answers them in one place.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useApp, useCurrent } from "../store";
import { api, type Agent, type ChatMsg, type FileStat, type Task, type TeamSnapshot } from "../lib/api";
import { STATUS, elapsed } from "../data/types";
import { modelLabel } from "../data/models";

const spring = { type: "spring" as const, stiffness: 260, damping: 28 };

const STAGE: Record<Task["stage"], { label: string; color: string; bg: string }> = {
  queued: { label: "대기", color: "var(--wait-ink)", bg: "var(--chip)" },
  running: { label: "진행 중", color: "var(--work-ink)", bg: "rgba(127,176,138,0.16)" },
  review: { label: "검토 대기", color: "var(--wait-ink)", bg: "rgba(226,184,102,0.18)" },
  done: { label: "완료", color: "var(--text2)", bg: "var(--chip)" },
  failed: { label: "실패", color: "var(--block-ink)", bg: "var(--block-bg)" },
};

// ── permissions, gathered ─────────────────────────────

function PermissionsCard({ items, team }: { items: ChatMsg[]; team: TeamSnapshot }) {
  const answer = useApp((s) => s.answerPermission);
  const name = (id: string) => team.agents.find((a) => a.id === id)?.name ?? id;
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={spring}
      className="glass flex flex-col gap-3 rounded-2xl p-4"
      style={{ border: "1.5px solid var(--amber)" }}
    >
      <div className="flex items-center gap-2">
        <span className="s-work size-2 rounded-full" style={{ background: "var(--amber)" }} />
        <h3 className="m-0 flex-auto text-[14px] font-semibold">허락이 필요해요 · {items.length}건</h3>
        {items.length > 1 && (
          <button
            onClick={() => items.forEach((m) => void answer(m.id, "allow"))}
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

function Results({ task }: { task: Task }) {
  const pid = useApp((s) => s.projectId)!;
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

// ── one task ──────────────────────────────────────────

function Activity({ agents }: { agents: Agent[] }) {
  const lines = agents
    .flatMap((a) => a.activity.map((x) => ({ ...x, who: a.name })))
    .sort((a, b) => a.at - b.at)
    .slice(-5);
  if (!lines.length) return <span className="text-[12.5px] text-ink-2">시작하는 중…</span>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      <AnimatePresence initial={false}>
        {lines.map((l, i) => (
          <motion.li
            key={`${l.at}-${l.who}`}
            layout
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: i === lines.length - 1 ? 1 : 0.55, x: 0 }}
            transition={spring}
            className="flex gap-2 text-[12.5px] leading-snug"
          >
            <span className="min-w-12 shrink-0 font-mono text-[11px] whitespace-nowrap text-ink-2">{l.who}</span>
            <span className="min-w-0 truncate font-mono text-[12px]">{l.text}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function TaskCard({ task, team }: { task: Task; team: TeamSnapshot }) {
  const go = useApp((s) => s.go);
  const st = STAGE[task.stage];
  const assignee = team.agents.find((a) => a.id === task.assignee);
  // the assignee plus anyone working under it
  const crew = team.agents.filter((a) => a.id === task.assignee || (assignee && a.parentId === assignee.id));
  const leadNote = [...team.chat].reverse().find((m) => m.kind === "lead" && m.taskIds.includes(task.id) && m.at >= task.updatedAt - 1000);
  const finished = task.stage === "review" || task.stage === "done" || task.stage === "failed";

  return (
    <motion.article layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="glass flex flex-col gap-3 rounded-2xl p-4">
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] font-semibold">{task.id}</span>
        <h3 className="m-0 min-w-0 flex-auto truncate text-[14.5px] font-semibold">{task.title}</h3>
        <span className="rounded-full px-2.5 py-0.5 text-[11.5px] font-medium" style={{ color: st.color, background: st.bg }}>
          {st.label}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        {crew.map((a) => {
          const s = STATUS[a.status];
          return (
            <button key={a.id} onClick={() => go({ name: "agent", id: a.id })} className="flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px]" style={{ background: "var(--chip)" }} title="자세히 보기">
              <span className={`${s.cls} size-1.5 rounded-full`} style={{ background: s.color }} />
              {a.name}
              <span className="font-mono text-[10.5px] text-ink-2">{modelLabel(a.model)}</span>
            </button>
          );
        })}
        <span className="ml-auto text-[11.5px] text-ink-2">{elapsed(task.createdAt)} 전 시작</span>
      </div>

      {!finished && (
        <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--glass2)" }}>
          {task.stage === "queued" ? <span className="text-[12.5px] text-ink-2">순서를 기다리는 중이에요 · {task.goal}</span> : <Activity agents={crew} />}
        </div>
      )}

      {finished && (
        <>
          {task.summary && (
            <p className="m-0 text-[13px] leading-relaxed whitespace-pre-wrap select-text">
              <span className="mr-1.5 text-[11.5px] font-semibold text-ink-2">{assignee?.name ?? "작업자"} 보고</span>
              {task.summary}
            </p>
          )}
          {leadNote && (
            <div className="rounded-xl px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap select-text" style={{ background: "var(--glass2)" }}>
              <span className="mb-1 block text-[11.5px] font-semibold text-ink-2">총괄 보고</span>
              {leadNote.text}
            </div>
          )}
          <Results task={task} />
        </>
      )}
    </motion.article>
  );
}

// ── feed ──────────────────────────────────────────────

export function ReportFeed() {
  const { team } = useCurrent();
  if (!team) return null;
  const perms = team.chat.filter((m) => m.permission && !m.permission.answer);
  const tasks = [...team.tasks].sort((a, b) => {
    // running first, then most recently touched
    const live = (t: Task) => (t.stage === "running" || t.stage === "queued" ? 1 : 0);
    return live(b) - live(a) || b.updatedAt - a.updatedAt;
  });

  return (
    <section aria-label="보고 피드" className="flex min-h-0 min-w-0 flex-auto flex-col gap-3 overflow-y-auto px-1 pt-1 pb-4">
      <AnimatePresence initial={false}>{perms.length > 0 && <PermissionsCard key="perms" items={perms} team={team} />}</AnimatePresence>
      {tasks.length === 0 && perms.length === 0 && (
        <div className="m-auto flex max-w-[300px] flex-col items-center gap-2 text-center">
          <span className="text-[15px] font-semibold">아직 보고가 없어요</span>
          <span className="text-[13px] leading-relaxed text-ink-2">왼쪽에서 총괄에게 일을 시키면, 작업마다 진행 상황과 결과물이 여기 카드로 쌓여요.</span>
        </div>
      )}
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} team={team} />
      ))}
    </section>
  );
}
