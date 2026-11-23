import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "../lib/api";
import { isRemote } from "../lib/transport";
import { AnimatePresence, motion } from "motion/react";
import { useApp } from "../store";
import type { ChatMsg, PresetName, Project, TeamSnapshot } from "../lib/api";
import { STATUS } from "../data/types";
import { ArrowUp, ChevronDown, Gear, Power, Tower } from "./icons";
import { modelLabel } from "../data/models";

const bubbleIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97 },
  transition: { type: "spring" as const, stiffness: 260, damping: 28 },
};

function Chips({ ids, team, onPick }: { ids: string[]; team: TeamSnapshot; onPick: (id: string) => void }) {
  const selectedCard = useApp((s) => s.selectedCard);
  const known = ids.map((id) => team.tasks.find((t) => t.id === id)).filter((t) => t != null);
  if (!known.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {known.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t.id)}
          className="flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors"
          style={{ background: "var(--chip)", border: `1px solid ${t.id === selectedCard ? "var(--navy)" : "transparent"}` }}
        >
          <span className="font-mono font-medium">{t.id}</span>
          {t.title}
        </button>
      ))}
    </div>
  );
}

export function EscalationCard({ m, team, projectId }: { m: ChatMsg; team: TeamSnapshot; projectId: string }) {
  const answerEscalation = useApp((s) => s.answerEscalation);
  const answer = (id: number, text: string) => answerEscalation(id, text, projectId);
  const [draft, setDraft] = useState("");
  const e = m.escalation!;
  const path = e.path.map((id) => team.agents.find((a) => a.id === id)?.name ?? id).join(" → ");
  const done = e.answer != null;
  return (
    <div
      className="flex flex-col gap-2.5 rounded-[14px] px-[13px] py-3"
      style={done ? { background: "var(--glass2)", border: "1px solid var(--line)", opacity: 0.75 } : { background: "var(--block-bg)", border: "1px solid var(--block)" }}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: done ? "var(--text2)" : "var(--block-ink)" }}>
        <span className={`${done ? "" : "s-block"} size-[7px] rounded-full`} style={{ background: done ? "var(--done)" : "var(--block)" }} />
        {done ? "답함" : "막힘"} · {path}
      </span>
      <span className="leading-[1.55] whitespace-pre-wrap select-text">
        {e.taskId && <span className="font-mono font-medium">{e.taskId} </span>}
        {m.text}
      </span>
      {done ? (
        <span className="text-xs text-ink-2">→ {e.answer}</span>
      ) : (
        <>
          {e.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {e.options.map((o, j) => (
                <button
                  key={o}
                  onClick={() => answer(m.id, o)}
                  className="min-h-8 rounded-full px-3 text-[12.5px]"
                  style={j === 0 ? { border: 0, background: "var(--amber)", color: "#2B2520", fontWeight: 600 } : { border: "1px solid var(--line)", background: "var(--glass2)" }}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-1.5">
            <span className="sr-only">직접 답하기</span>
            <input
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && !ev.nativeEvent.isComposing && draft.trim()) {
                  answer(m.id, draft.trim());
                  setDraft("");
                }
              }}
              placeholder="직접 답하기…"
              className="min-h-8 min-w-0 flex-auto rounded-full px-3 text-[12.5px] outline-none"
              style={{ background: "var(--glass2)", border: "1px solid var(--line)" }}
            />
          </label>
        </>
      )}
    </div>
  );
}

export const ATTACH_MARK = "\n첨부 파일: ";
export const baseName = (p: string) => p.split(/[\\/]/).pop()!.replace(/^\d{10,}-/, "");
export const isImage = (p: string) => /\.(png|jpe?g|gif|webp|heic|bmp|svg)$/i.test(p);

/** "text\n첨부 파일: a, b" → text + file chips */
export function MyMessage({ text }: { text: string }) {
  const [body, files] = text.includes(ATTACH_MARK) ? [text.split(ATTACH_MARK)[0], text.split(ATTACH_MARK)[1].split(", ")] : [text, []];
  return (
    <>
      {body}
      {files.length > 0 && (
        <span className="mt-1.5 flex flex-wrap gap-1">
          {files.map((f) => (
            <span key={f} title={f} className="rounded-md px-1.5 py-0.5 text-[11px]" style={{ background: "rgba(255,255,255,0.18)" }}>
              {isImage(f) ? "🖼" : "📄"} {baseName(f)}
            </span>
          ))}
        </span>
      )}
    </>
  );
}

const PRESETS: { id: PresetName; label: string; note: string }[] = [
  { id: "save", label: "절약", note: "가벼운 AI 위주 · 작은 수정에 좋아요" },
  { id: "bal", label: "균형", note: "판단은 똑똑한 AI, 실행은 가벼운 AI" },
  { id: "power", label: "파워", note: "품질 최우선 · 사용량이 빨리 줄어요" },
];

/** The team's preset as a small pill that opens a menu (styled like the app, not the OS). */
function PresetMenu({ project }: { project: Project }) {
  const setPreset = useApp((s) => s.setPreset);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const preset = project.team.preset;
  const cur = PRESETS.find((p) => p.id === preset);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="mr-0.5">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${project.name} 추천 설정: ${cur?.label ?? "직접 설정"}`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-7 items-center gap-1 rounded-full border-0 pr-2 pl-2.5 text-[12px] font-medium transition-colors"
        style={{ background: open ? "var(--amber)" : "var(--chip)", color: open ? "#2B2520" : "var(--text)" }}
      >
        {cur?.label ?? "직접 설정"}
        <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 160ms" }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="추천 설정"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="absolute top-[calc(100%+6px)] right-0 z-30 flex w-[200px] origin-top-right flex-col gap-0.5 rounded-xl p-1"
            style={{ background: "color-mix(in srgb, var(--bg2) 96%, transparent)", border: "1px solid var(--glass-border)", boxShadow: "var(--shadow)" }}
          >
            {PRESETS.map((p) => {
              const on = p.id === preset;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  onClick={() => {
                    if (!on) void setPreset(p.id, project.id);
                    setOpen(false);
                  }}
                  className="flex items-start gap-2 rounded-lg border-0 px-2.5 py-2 text-left hover:bg-[var(--chip)]"
                  style={{ background: on ? "var(--glass2)" : "transparent" }}
                >
                  <span
                    className="mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full"
                    style={{ border: `1.5px solid ${on ? "var(--amber)" : "color-mix(in srgb, var(--text) 30%, transparent)"}` }}
                  >
                    {on && <span className="size-1.5 rounded-full" style={{ background: "var(--amber)" }} />}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[12.5px] font-semibold">{p.label}</span>
                    <span className="text-[11px] leading-snug text-ink-2">{p.note}</span>
                  </span>
                </button>
              );
            })}
            <span className="px-2.5 pt-1 pb-1.5 text-[10.5px] text-ink-2">이후에 출근하는 AI부터 적용돼요</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The team's own controls, at the right of its 총괄 header: preset, settings, clock-out. */
export function TeamControls({ project, team }: { project: Project; team?: TeamSnapshot }) {
  const stopTeam = useApp((s) => s.stopTeam);
  const openIn = useApp((s) => s.openIn);
  const [confirmStop, setConfirmStop] = useState(false);
  const running = !!team?.agents.some((a) => a.status !== "off");
  const btn = "flex size-7 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-ink-2 hover:bg-[var(--chip)]";
  return (
    <div data-nodrag className="relative flex shrink-0 items-center gap-0.5">
      <PresetMenu project={project} />
      <button onClick={() => openIn(project.id, { name: "settings" })} aria-label={`${project.name} 팀 설정`} title="팀 설정" className={btn}>
        <Gear size={15} />
      </button>
      {running && (
        <button
          onClick={() => (confirmStop ? (setConfirmStop(false), void stopTeam(project.id)) : setConfirmStop(true))}
          onBlur={() => setConfirmStop(false)}
          aria-label={`${project.name} 팀 퇴근 (모든 AI 작업 종료)`}
          title="팀 퇴근"
          className={confirmStop ? "flex min-h-7 shrink-0 items-center gap-1 rounded-full border-0 px-2.5 text-[11.5px] font-semibold" : btn}
          style={confirmStop ? { background: "var(--block)", color: "#fff" } : undefined}
        >
          <Power size={14} />
          {confirmStop && "퇴근?"}
        </button>
      )}
    </div>
  );
}

/**
 * One team's 총괄 chat. Without `projectId` it follows the current team. With several teams at
 * work, the 관제탑 stacks one per team (`projectId` + `multi`); touching one makes it the current
 * team, so the report feed and task board show its results.
 */
export function LeadChat({ projectId: forProject, multi = false }: { projectId?: string; multi?: boolean } = {}) {
  const sendToLead = useApp((s) => s.sendToLead);
  const current = useApp((s) => s.projectId);
  const projectId = forProject ?? current;
  const team = useApp((s) => (projectId ? s.teams[projectId] : undefined));
  const project = useApp((s) => s.projects.find((p) => p.id === projectId));
  const switchTeam = useApp((s) => s.switchTeam);
  const selectCard = useApp((s) => s.selectCard);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const setError = useApp((s) => s.setError);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const lead = team?.agents.find((a) => a.role === "lead");
  const live = !!lead && lead.status !== "off";
  const queued = team?.tasks.filter((t) => t.stage === "queued").length ?? 0;
  const chat = team?.chat ?? [];
  const pendingPerms = chat.filter((m) => m.permission && !m.permission.answer && !m.permission.decider).length;
  const waiting = pendingPerms + chat.filter((m) => m.escalation && !m.escalation.answer).length;
  const active = !multi || projectId === current;
  /** make this the team the report feed and board show */
  const openTeam = () => {
    if (multi && projectId && projectId !== current) switchTeam(projectId);
  };
  const pickCard = (id: string) => {
    openTeam();
    selectCard(id);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.length]);

  const attach = async (paths: string[]) => {
    if (!projectId || !paths.length) return;
    try {
      const copied = await api.attachFiles(projectId, paths);
      setFiles((f) => [...f, ...copied]);
    } catch (e) {
      setError(e);
    }
  };

  const fileInput = useRef<HTMLInputElement>(null);

  /** browser (remote) side: upload the bytes instead of passing local paths */
  const uploadFiles = async (list: FileList | File[]) => {
    if (!projectId) return;
    for (const f of [...list]) {
      try {
        const bytes = Array.from(new Uint8Array(await f.arrayBuffer()));
        const path = await api.attachBytes(projectId, f.name || "첨부파일", bytes);
        setFiles((x) => [...x, path]);
      } catch (err) {
        setError(err);
      }
    }
  };

  const pickFiles = async () => {
    if (isRemote) return fileInput.current?.click();
    const picked = await open({ multiple: true });
    if (picked) void attach(Array.isArray(picked) ? picked : [picked]);
  };

  // pasted screenshots/images arrive as bytes
  const onPaste = async (e: ClipboardEvent<HTMLInputElement>) => {
    const items = [...e.clipboardData.files];
    if (!items.length || !projectId) return;
    e.preventDefault();
    for (const f of items) {
      try {
        const bytes = Array.from(new Uint8Array(await f.arrayBuffer()));
        const ext = f.type.split("/")[1] || "bin";
        const path = await api.attachBytes(projectId, f.name && f.name !== "image.png" ? f.name : `붙여넣기.${ext}`, bytes);
        setFiles((x) => [...x, path]);
      } catch (err) {
        setError(err);
      }
    }
  };

  // files dragged in from Finder / Explorer. With several chats on screen, only the one under the
  // cursor takes them (positions arrive in physical pixels).
  const under = (p?: { x: number; y: number }) => {
    if (!multi) return true;
    const r = sectionRef.current?.getBoundingClientRect();
    if (!r || !p) return false;
    const x = p.x / window.devicePixelRatio;
    const y = p.y / window.devicePixelRatio;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  useEffect(() => {
    if (isRemote) return; // browsers get HTML drag-and-drop instead (see the section below)
    // the listener arrives asynchronously: if this effect is torn down first (StrictMode
    // mounts twice), drop it as soon as it lands — otherwise every drop attaches twice
    let off: (() => void) | undefined;
    let gone = false;
    void getCurrentWebview()
      .onDragDropEvent((ev) => {
        const t = ev.payload.type;
        const here = under("position" in ev.payload ? ev.payload.position : undefined);
        if (t === "enter" || t === "over") setDropping(here);
        else if (t === "leave") setDropping(false);
        else if (t === "drop") {
          setDropping(false);
          if (here) void attach(ev.payload.paths);
        }
      })
      .then((u) => (gone ? u() : (off = u)));
    return () => {
      gone = true;
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, multi]);

  const submit = () => {
    const text = draft.trim();
    if ((!text && !files.length) || !live) return;
    const body = (text || "첨부한 파일을 확인해줘.") + (files.length ? `${ATTACH_MARK}${files.join(", ")}` : "");
    void sendToLead(body, projectId ?? undefined);
    setDraft("");
    setFiles([]);
  };

  const leadStatus = lead ? STATUS[lead.status] : STATUS.off;
  const leadLine = !lead ? "출근 전" : lead.status === "work" ? "생각하는 중" : lead.status === "off" ? "퇴근" : "지시 받는 중";

  return (
    <section
      ref={sectionRef}
      aria-label={multi ? `${project?.name ?? ""} 총괄 채팅` : "총괄 채팅"}
      className={`glass flex min-w-0 flex-col overflow-hidden rounded-2xl transition-shadow ${multi ? "min-h-[240px] flex-[1_1_0]" : "max-w-[460px] flex-[1_1_400px]"}`}
      style={multi ? { boxShadow: active ? "0 0 0 1.5px var(--amber), var(--shadow-sm)" : "var(--shadow-sm), var(--hi)" } : undefined}
      onPointerDown={openTeam}
      onDragOver={(e) => {
        if (!isRemote) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => isRemote && setDropping(false)}
      onDrop={(e) => {
        if (!isRemote) return;
        e.preventDefault();
        setDropping(false);
        void uploadFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-2 py-3 pr-2.5 pl-3.5" style={{ borderBottom: "1px solid var(--line)" }}>
        {!multi && (
          <span className="glass-soft flex size-[34px] shrink-0 items-center justify-center rounded-xl">
            <Tower />
          </span>
        )}
        <div className="flex min-w-0 flex-auto flex-col">
          <button
            onClick={openTeam}
            title={[multi && "이 팀 결과 보기", team?.branch && `작업 위치 ${team.branch}`].filter(Boolean).join(" · ") || undefined}
            className={`flex max-w-full min-w-0 items-center gap-1.5 self-start rounded-md border-0 bg-transparent p-0 text-left text-sm font-semibold ${multi ? "hover:underline" : "cursor-default"}`}
          >
            <span className="truncate">{project?.name ?? "총괄"}</span>
            {waiting > 0 && (
              <span aria-label={`답해야 할 일 ${waiting}건`} title="답해야 할 일" className="shrink-0 rounded-full px-[6px] text-[11px] leading-[17px] font-semibold" style={{ background: "var(--block)", color: "#fff" }}>
                {waiting}
              </span>
            )}
          </button>
          <span className="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-ink-2">
            <span className={`${leadStatus.cls} size-[7px] shrink-0 rounded-full`} style={{ background: leadStatus.color }} />
            <span className="truncate">
              {[multi ? null : lead ? modelLabel(lead.model) : null, leadLine, queued > 0 ? `대기 ${queued}` : null].filter(Boolean).join(" · ")}
            </span>
          </span>
        </div>
        {project && <TeamControls project={project} team={team} />}
      </div>

      <div ref={scrollRef} className="flex flex-auto flex-col gap-3 overflow-y-auto p-3.5">
        {chat.length === 0 && (
          <p className="m-auto max-w-[220px] text-center text-[13px] leading-relaxed text-ink-2">
            총괄에게 하고 싶은 일을 말해보세요.
            <br />
            작업 카드로 쪼개서 팀에 나눠줘요.
          </p>
        )}
        <AnimatePresence initial={false}>
          {team &&
            chat.map((m) => {
              if (m.kind === "me")
                return (
                  <motion.div
                    key={m.id}
                    {...bubbleIn}
                    className="max-w-[85%] self-end rounded-[14px_14px_4px_14px] px-[13px] py-[9px] leading-normal whitespace-pre-wrap select-text"
                    style={{ background: "var(--me-bg)", color: "var(--me-fg)" }}
                  >
                    <MyMessage text={m.text} />
                  </motion.div>
                );
              if (m.kind === "permission") return null; // gathered in the report feed
              if (m.kind === "escalation")
                return (
                  <motion.div key={m.id} {...bubbleIn}>
                    <EscalationCard m={m} team={team} projectId={projectId!} />
                  </motion.div>
                );
              return (
                <motion.div key={m.id} {...bubbleIn} className="flex max-w-[92%] flex-col gap-2">
                  <div className="glass-soft rounded-[14px_14px_14px_4px] px-[13px] py-[9px] leading-normal whitespace-pre-wrap select-text">
                    {m.text}
                  </div>
                  <Chips ids={m.taskIds} team={team} onPick={pickCard} />
                </motion.div>
              );
            })}
        </AnimatePresence>
        {pendingPerms > 0 && (
          <button
            onClick={openTeam}
            className="flex items-center gap-2 self-stretch rounded-[14px] px-3 py-2.5 text-left text-[12.5px]"
            style={{ background: "rgba(232,161,90,0.12)", border: "1px solid var(--amber)" }}
          >
            <span className="s-work size-2 rounded-full" style={{ background: "var(--amber)" }} />
            <span className="flex-auto">허락이 필요한 일 {pendingPerms}건 · 보고에서 한 번에 처리</span>
            <span aria-hidden="true">→</span>
          </button>
        )}
        {lead?.status === "work" && (
          <div className="flex gap-1 self-start px-2" aria-label="총괄이 생각하는 중">
            {[0, 1, 2].map((i) => (
              <span key={i} className="s-work size-1.5 rounded-full" style={{ background: "var(--text2)", animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {files.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="mx-3 mb-1.5 flex flex-wrap gap-1.5">
            {files.map((f) => (
              <span key={f} title={f} className="flex items-center gap-1 rounded-full py-1 pr-1 pl-2.5 text-[11.5px]" style={{ background: "var(--chip)" }}>
                {isImage(f) ? "🖼" : "📄"} <span className="max-w-[150px] truncate">{baseName(f)}</span>
                <button onClick={() => setFiles((x) => x.filter((y) => y !== f))} aria-label={`${baseName(f)} 빼기`} className="flex size-5 items-center justify-center rounded-full border-0 bg-transparent text-ink-2">
                  ×
                </button>
              </span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <div
        onClick={(e) => {
          // the empty space around the box focuses the input (never the attach button)
          if (e.target === e.currentTarget) e.currentTarget.querySelector("input")?.focus();
        }}
        className="glass-soft relative mx-3 mb-3 flex items-end gap-2 rounded-[14px] py-2 pr-2 pl-2"
        style={dropping && live ? { boxShadow: "0 0 0 2px var(--amber)" } : undefined}
      >
        {dropping && live && (
          <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[14px] text-[12.5px] font-semibold" style={{ background: "rgba(232,161,90,0.18)" }}>
            여기에 놓으면 첨부돼요
          </span>
        )}
        <button
          type="button"
          onClick={() => void pickFiles()}
          disabled={!live}
          aria-label="파일 첨부"
          title="파일 첨부 · 드래그하거나 이미지를 붙여넣어도 돼요"
          className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border-0 bg-transparent text-ink-2 hover:bg-[var(--chip)] disabled:opacity-50"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          aria-label="총괄에게 지시하기"
          value={draft}
          disabled={!live}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => void onPaste(e)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
          placeholder={live ? (multi ? "지시하기" : "총괄에게 지시하기") : "출근하면 지시할 수 있어요"}
          title={live ? "계속 말해도 돼요. 총괄이 순서대로 처리해요" : undefined}
          className="min-h-[34px] min-w-0 flex-auto border-0 bg-transparent text-[13.5px] outline-none disabled:opacity-60"
        />
        <button
          onClick={submit}
          disabled={!live}
          aria-label="보내기"
          className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border-0 disabled:opacity-50"
          style={{ background: "var(--amber)", color: "#2B2520" }}
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </section>
  );
}
