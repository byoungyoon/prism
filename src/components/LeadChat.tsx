import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "../lib/api";
import { AnimatePresence, motion } from "motion/react";
import { useApp, useCurrent } from "../store";
import type { ChatMsg, TeamSnapshot } from "../lib/api";
import { STATUS } from "../data/types";
import { ArrowUp, Tower } from "./icons";
import { modelLabel } from "../data/models";

const bubbleIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97 },
  transition: { type: "spring" as const, stiffness: 260, damping: 28 },
};

function Chips({ ids, team }: { ids: string[]; team: TeamSnapshot }) {
  const { selectedCard, selectCard } = useApp();
  const known = ids.map((id) => team.tasks.find((t) => t.id === id)).filter((t) => t != null);
  if (!known.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {known.map((t) => (
        <button
          key={t.id}
          onClick={() => selectCard(t.id)}
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

function EscalationCard({ m, team }: { m: ChatMsg; team: TeamSnapshot }) {
  const answer = useApp((s) => s.answerEscalation);
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

const ATTACH_MARK = "\n첨부 파일: ";
const baseName = (p: string) => p.split(/[\\/]/).pop()!.replace(/^\d{10,}-/, "");
const isImage = (p: string) => /\.(png|jpe?g|gif|webp|heic|bmp|svg)$/i.test(p);

/** "text\n첨부 파일: a, b" → text + file chips */
function MyMessage({ text }: { text: string }) {
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

export function LeadChat() {
  const sendToLead = useApp((s) => s.sendToLead);
  const { team } = useCurrent();
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const projectId = useApp((s) => s.projectId);
  const setError = useApp((s) => s.setError);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lead = team?.agents.find((a) => a.role === "lead");
  const live = !!lead && lead.status !== "off";
  const queued = team?.tasks.filter((t) => t.stage === "queued").length ?? 0;
  const chat = team?.chat ?? [];
  const setCenter = useApp((s) => s.setCenter);
  const pendingPerms = chat.filter((m) => m.permission && !m.permission.answer).length;

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

  const pickFiles = async () => {
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

  // files dragged in from Finder / Explorer
  useEffect(() => {
    // the listener arrives asynchronously: if this effect is torn down first (StrictMode
    // mounts twice), drop it as soon as it lands — otherwise every drop attaches twice
    let off: (() => void) | undefined;
    let gone = false;
    void getCurrentWebview()
      .onDragDropEvent((ev) => {
        const t = ev.payload.type;
        if (t === "enter" || t === "over") setDropping(true);
        else if (t === "leave") setDropping(false);
        else if (t === "drop") {
          setDropping(false);
          void attach(ev.payload.paths);
        }
      })
      .then((u) => (gone ? u() : (off = u)));
    return () => {
      gone = true;
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const submit = () => {
    const text = draft.trim();
    if ((!text && !files.length) || !live) return;
    const body = (text || "첨부한 파일을 확인해줘.") + (files.length ? `${ATTACH_MARK}${files.join(", ")}` : "");
    void sendToLead(body);
    setDraft("");
    setFiles([]);
  };

  const leadStatus = lead ? STATUS[lead.status] : STATUS.off;
  const leadLine = !lead ? "출근 전" : lead.status === "work" ? "생각하는 중" : lead.status === "off" ? "퇴근" : "지시 받는 중";

  return (
    <section aria-label="총괄 채팅" className="glass flex max-w-80 min-w-0 flex-[1_1_300px] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center gap-2.5 px-4 py-3.5" style={{ borderBottom: "1px solid var(--line)" }}>
        <span className="glass-soft flex size-[34px] items-center justify-center rounded-xl">
          <Tower />
        </span>
        <div className="flex flex-auto flex-col">
          <span className="text-sm font-semibold">총괄</span>
          <span className="flex items-center gap-1.5 text-xs text-ink-2">
            <span className={`${leadStatus.cls} size-[7px] rounded-full`} style={{ background: leadStatus.color }} />
            {lead ? modelLabel(lead.model) : "-"} · {leadLine}
          </span>
        </div>
        <span className="rounded-full px-[9px] py-[3px] text-xs font-medium" style={{ background: "var(--chip)" }}>
          대기 중인 일 {queued}
        </span>
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
                    <EscalationCard m={m} team={team} />
                  </motion.div>
                );
              return (
                <motion.div key={m.id} {...bubbleIn} className="flex max-w-[92%] flex-col gap-2">
                  <div className="glass-soft rounded-[14px_14px_14px_4px] px-[13px] py-[9px] leading-normal whitespace-pre-wrap select-text">
                    {m.text}
                  </div>
                  <Chips ids={m.taskIds} team={team} />
                </motion.div>
              );
            })}
        </AnimatePresence>
        {pendingPerms > 0 && (
          <button
            onClick={() => setCenter("feed")}
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
      <label
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
        <span className="sr-only">총괄에게 지시하기</span>
        <input
          value={draft}
          disabled={!live}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => void onPaste(e)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
          placeholder={live ? "계속 말해도 돼요. 총괄이 순서대로 처리해요" : "팀이 출근하면 지시할 수 있어요"}
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
      </label>
    </section>
  );
}
