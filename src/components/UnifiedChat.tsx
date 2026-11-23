// One conversation with every 총괄 at work. Everything they say lands in a single timeline (each
// line says which team), and orders go out from one box. Every order names its recipients with
// "@팀이름" — there is no default and no send-to-all. Attachments are copied to each recipient.
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AnimatePresence, motion } from "motion/react";
import { api, type ChatMsg, type Project, type TeamSnapshot } from "../lib/api";
import { isRemote } from "../lib/transport";
import { useApp, useShownTeams } from "../store";
import { clock } from "../data/types";
import { ATTACH_MARK, BranchTag, EscalationCard, MyMessage, TeamControls, baseName, isImage } from "./LeadChat";
import { ArrowUp, ChevronDown, Gear } from "./icons";
import { LiveWork } from "./LiveWork";
import { ReportFold, isReport } from "./ReportFold";

const spring = { type: "spring" as const, stiffness: 260, damping: 28 };

/** A file waiting to go out: a local path (desktop) or bytes (browser / pasted). */
type Pending = { name: string; path?: string; bytes?: number[] };

/** "@쇼핑몰 장바구니 고쳐줘 @블로그" → recipients + the order without the mentions. */
function parse(text: string, teams: Project[]) {
  const names = teams.map((t) => t.name).sort((a, b) => b.length - a.length); // longest first: "쇼핑몰 2" before "쇼핑몰"
  const ids = new Set<string>();
  let body = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "@") {
      const hit = names.find((n) => text.startsWith(n, i + 1));
      if (hit) {
        ids.add(teams.find((t) => t.name === hit)!.id);
        i += hit.length;
        continue;
      }
    }
    body += text[i];
  }
  return { ids: [...ids], body: body.replace(/\s+/g, " ").trim() };
}

type Item = { key: string; at: number; pid: string; m: ChatMsg; to?: string[] };

export function UnifiedChat() {
  const shown = useShownTeams();
  const sendToLead = useApp((s) => s.sendToLead);
  const setError = useApp((s) => s.setError);
  const teams = shown.map((s) => s.project);
  const byId = useMemo(() => Object.fromEntries(shown.map((s) => [s.project.id, s])), [shown]);

  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [dropping, setDropping] = useState(false);
  const [menu, setMenu] = useState<{ query: string; at: number; index: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // one timeline: every team's conversation, my orders shown once even when sent to several teams
  const items = useMemo(() => {
    const out: Item[] = [];
    for (const { project, team } of shown) {
      for (const m of team.chat) {
        if (m.kind === "system" || m.kind === "permission") continue;
        if (m.kind === "me") {
          const text = m.text.split(ATTACH_MARK)[0];
          const twin = out.find((x) => x.m.kind === "me" && x.m.text.split(ATTACH_MARK)[0] === text && Math.abs(x.at - m.at) < 5000);
          if (twin) {
            twin.to!.push(project.id);
            continue;
          }
          out.push({ key: `${project.id}-${m.id}`, at: m.at, pid: project.id, m, to: [project.id] });
        } else out.push({ key: `${project.id}-${m.id}`, at: m.at, pid: project.id, m });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }, [shown]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items.length]);

  const live = (t?: TeamSnapshot) => !!t?.agents.some((a) => a.role === "lead" && a.status !== "off");
  const { ids: mentioned, body } = parse(draft, teams);
  // only who's named, and only teams at work
  const targets = mentioned.filter((id) => live(byId[id]?.team));
  const thinking = shown.filter(({ team }) => team.agents.some((a) => a.role === "lead" && a.status === "work"));
  const perms = shown.reduce((n, { team }) => n + team.chat.filter((m) => m.permission && !m.permission.answer && !m.permission.decider).length, 0);

  // ── @ autocomplete ───────────────────────────────
  const options = menu ? teams.map((t) => t.name).filter((n) => n.toLowerCase().includes(menu.query.toLowerCase())) : [];
  const watchMention = (value: string, caret: number) => {
    const m = /@([^@\s]*)$/.exec(value.slice(0, caret));
    setMenu(m ? { query: m[1], at: caret - m[0].length, index: 0 } : null);
  };
  const choose = (name: string) => {
    if (!menu) return;
    const caret = input.current?.selectionStart ?? draft.length;
    const next = `${draft.slice(0, menu.at)}@${name} ${draft.slice(caret)}`;
    setDraft(next);
    setMenu(null);
    requestAnimationFrame(() => {
      const pos = menu.at + name.length + 2;
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (menu && options.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setMenu({ ...menu, index: (menu.index + d + options.length) % options.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(options[Math.min(menu.index, options.length - 1)]);
        return;
      }
    }
    if (e.key === "Escape") return setMenu(null);
    if (e.key === "Enter") void submit();
  };

  // ── attachments (copied into each recipient's folder when sent) ──
  const addBytes = async (list: FileList | File[]) => {
    for (const f of [...list]) {
      const ext = f.type.split("/")[1] || "bin";
      const name = f.name && f.name !== "image.png" ? f.name : `붙여넣기.${ext}`;
      const bytes = Array.from(new Uint8Array(await f.arrayBuffer()));
      setFiles((x) => [...x, { name, bytes }]);
    }
  };
  const pick = async () => {
    if (isRemote) return fileInput.current?.click();
    const picked = await open({ multiple: true });
    if (picked) setFiles((x) => [...x, ...(Array.isArray(picked) ? picked : [picked]).map((path) => ({ name: baseName(path), path }))]);
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const list = [...e.clipboardData.files];
    if (!list.length) return;
    e.preventDefault();
    void addBytes(list);
  };
  useEffect(() => {
    if (isRemote) return;
    let off: (() => void) | undefined;
    let gone = false;
    void getCurrentWebview()
      .onDragDropEvent((ev) => {
        const p = ev.payload;
        if (p.type === "enter" || p.type === "over") setDropping(true);
        else if (p.type === "leave") setDropping(false);
        else if (p.type === "drop") {
          setDropping(false);
          setFiles((x) => [...x, ...p.paths.map((path) => ({ name: baseName(path), path }))]);
        }
      })
      .then((u) => (gone ? u() : (off = u)));
    return () => {
      gone = true;
      off?.();
    };
  }, []);

  const submit = async () => {
    if ((!body && !files.length) || !targets.length) return;
    const text = body || "첨부한 파일을 확인해줘.";
    const pending = files;
    setDraft("");
    setFiles([]);
    setMenu(null);
    for (const pid of targets) {
      try {
        const paths = pending.filter((f) => f.path).map((f) => f.path!);
        const copied = paths.length ? await api.attachFiles(pid, paths) : [];
        for (const f of pending.filter((f) => f.bytes)) copied.push(await api.attachBytes(pid, f.name, f.bytes!));
        void sendToLead(text + (copied.length ? `${ATTACH_MARK}${copied.join(", ")}` : ""), pid);
      } catch (e) {
        setError(e);
      }
    }
  };

  return (
    <section
      aria-label="총괄 채팅"
      className="glass flex max-w-[520px] min-w-0 flex-[1_1_460px] flex-col overflow-hidden rounded-2xl"
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
        void addBytes(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addBytes(e.target.files);
          e.target.value = "";
        }}
      />

      {/* header: just the teams' settings, folded away until needed */}
      <div className="flex flex-col gap-2 px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">총괄</span>
          <span className="text-xs text-ink-2">{shown.length}팀</span>
          <button
            onClick={() => setShowSettings((v) => !v)}
            aria-expanded={showSettings}
            className="ml-auto flex min-h-7 items-center gap-1 rounded-full border-0 px-2.5 text-[12px] font-medium"
            style={{ background: showSettings ? "var(--chip)" : "transparent", color: "var(--text2)" }}
          >
            <Gear size={14} />
            팀 설정
            <ChevronDown size={12} style={{ transform: showSettings ? "rotate(180deg)" : undefined, transition: "transform 160ms" }} />
          </button>
        </div>
        {showSettings &&
          shown.map(({ project, team }) => (
            <div key={project.id} className="relative flex items-center gap-2 pb-1">
              <span className="flex min-w-0 flex-auto items-center gap-1.5">
                <span className="min-w-0 shrink truncate text-[12.5px] font-medium">{project.name}</span>
                <BranchTag team={team} />
              </span>
              <TeamControls project={project} team={team} />
            </div>
          ))}
      </div>

      {/* one timeline */}
      <div ref={scrollRef} className="flex flex-auto flex-col gap-3 overflow-y-auto p-3.5">
        {items.length === 0 && (
          <p className="m-auto max-w-[240px] text-center text-[13px] leading-relaxed text-ink-2">
            총괄들에게 하고 싶은 일을 말해보세요.
            <br />
            <b className="font-semibold">@팀이름</b>으로 받을 팀을 꼭 지정해 주세요.
          </p>
        )}
        <AnimatePresence initial={false}>
          {items.map((it) => {
            const team = byId[it.pid];
            if (!team) return null;
            if (it.m.kind === "me")
              return (
                <motion.div key={it.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex max-w-[88%] flex-col items-end gap-1 self-end">
                  <span className="text-[11px] text-ink-2">→ {it.to!.map((id) => byId[id]?.project.name).join(", ")}</span>
                  <div className="rounded-[14px_14px_4px_14px] px-[13px] py-[9px] leading-normal whitespace-pre-wrap select-text" style={{ background: "var(--me-bg)", color: "var(--me-fg)" }}>
                    <MyMessage text={it.m.text} />
                  </div>
                </motion.div>
              );
            return (
              <motion.div key={it.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex max-w-[94%] flex-col gap-1 self-start">
                <span className="text-[11px] text-ink-2">
                  {team.project.name} · {clock(it.at)}
                </span>
                {it.m.kind === "escalation" ? (
                  <EscalationCard m={it.m} team={team.team} projectId={it.pid} />
                ) : isReport(it.m.text) ? (
                  <ReportFold text={it.m.text} />
                ) : (
                  <div className="glass-soft rounded-[4px_14px_14px_14px] px-[13px] py-[9px] leading-normal whitespace-pre-wrap select-text">{it.m.text}</div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
        {perms > 0 && <span className="self-center rounded-full px-3 py-1 text-[11.5px] text-ink-2" style={{ background: "var(--chip)" }}>허락이 필요한 일 {perms}건 · 가운데 보고에서 처리해요</span>}
        {thinking.map(({ project, team }) => {
          const lead = team.agents.find((a) => a.role === "lead");
          return lead ? <LiveWork key={project.id} agent={lead} label={project.name} /> : null;
        })}
      </div>

      {/* composer */}
      <div className="relative flex flex-col gap-1.5 px-3 pt-2 pb-3" style={{ borderTop: "1px solid var(--line)" }}>
        <span className="flex min-w-0 items-center gap-1 text-[11.5px] text-ink-2">
          받는 팀
          {targets.length ? (
            targets.map((id) => (
              <span key={id} className="max-w-[120px] truncate rounded-full px-2 py-px font-medium text-[var(--text)]" style={{ background: "var(--chip)" }}>
                {byId[id]?.project.name}
              </span>
            ))
          ) : (
            <span>없음 · @로 받을 팀을 지정해 주세요</span>
          )}
        </span>

        <AnimatePresence>
          {files.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full py-1 pr-1 pl-2.5 text-[11.5px]" style={{ background: "var(--chip)" }}>
                  {isImage(f.name) ? "🖼" : "📄"} <span className="max-w-[150px] truncate">{f.name}</span>
                  <button onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={`${f.name} 빼기`} className="flex size-5 items-center justify-center rounded-full border-0 bg-transparent text-ink-2">
                    ×
                  </button>
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* @ suggestions */}
        <AnimatePresence>
          {menu && options.length > 0 && (
            <motion.ul
              role="listbox"
              aria-label="받을 팀"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="absolute right-3 bottom-[calc(100%-4px)] left-3 z-30 m-0 flex list-none flex-col gap-0.5 rounded-xl p-1"
              style={{ background: "color-mix(in srgb, var(--bg2) 97%, transparent)", border: "1px solid var(--glass-border)", boxShadow: "var(--shadow)" }}
            >
              {options.map((name, i) => (
                <li key={name}>
                  <button
                    role="option"
                    aria-selected={i === menu.index}
                    onMouseDown={(e) => {
                      e.preventDefault(); // keep focus in the input
                      choose(name);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border-0 px-2.5 py-1.5 text-left text-[13px]"
                    style={{ background: i === menu.index ? "var(--chip)" : "transparent" }}
                  >
                    <span className="text-ink-2">@</span>
                    <span className="font-medium">{name}</span>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>

        <div
          onClick={(e) => {
            // the empty space around the box focuses the input (never the attach button)
            if (e.target === e.currentTarget) input.current?.focus();
          }}
          className="glass-soft relative flex items-center gap-2 rounded-[14px] py-2 pr-2 pl-2"
          style={dropping ? { boxShadow: "0 0 0 2px var(--amber)" } : undefined}
        >
          {dropping && (
            <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[14px] text-[12.5px] font-semibold" style={{ background: "rgba(232,161,90,0.18)" }}>
              여기에 놓으면 첨부돼요
            </span>
          )}
          <button type="button" onClick={() => void pick()} aria-label="파일 첨부" title="파일 첨부 · 드래그하거나 이미지를 붙여넣어도 돼요" className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border-0 bg-transparent text-ink-2 hover:bg-[var(--chip)]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            ref={input}
            aria-label="총괄에게 지시하기 (@팀이름으로 받을 팀 지정)"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              watchMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={onKey}
            onPaste={onPaste}
            onBlur={() => setTimeout(() => setMenu(null), 100)}
            placeholder="@팀이름 으로 받을 팀을 지정하고 지시하기"
            className="min-h-[34px] min-w-0 flex-auto border-0 bg-transparent text-[13.5px] outline-none"
          />
          <button
            onClick={() => void submit()}
            disabled={(!body && !files.length) || !targets.length}
            aria-label="보내기"
            className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border-0 disabled:opacity-50"
            style={{ background: "var(--amber)", color: "#2B2520" }}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
