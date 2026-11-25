import { useEffect, useState, type ReactNode } from "react";
import { api, type GitChange } from "../lib/api";
import { ModelPicker } from "../components/ModelPicker";
import { useApp, useCurrent } from "../store";
import { ROLE_NAME, STATUS, elapsed, usd } from "../data/types";
import { TerminalView } from "../components/TerminalView";
import { Transcript } from "../components/Transcript";
import { ChevronLeft } from "../components/icons";
import { MemberUsage } from "../components/TokenUse";
import { catName } from "../components/critters/pixel/coats";

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const pill = "flex min-h-[34px] items-center gap-1.5 rounded-full px-3 text-[13px]";

export function AgentScreen({ id }: { id: string }) {
  const { team } = useCurrent();
  const go = useApp((s) => s.go);
  const agent = team?.agents.find((a) => a.id === id);

  const [text, setText] = useState("");
  const [confirmKill, setConfirmKill] = useState(false);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const cwd = agent?.cwd;
  const status = agent?.status;

  useEffect(() => {
    if (!cwd) return;
    let alive = true;
    const load = () =>
      api.gitChanges(cwd).then((c) => alive && setChanges(c)).catch(() => alive && setChanges([]));
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [cwd, status]);

  useEffect(() => {
    if (!cwd || !sel) return setDiff(null);
    let alive = true;
    api.gitDiff(cwd, sel).then((d) => alive && setDiff(d)).catch((e) => alive && setDiff(String(e)));
    return () => {
      alive = false;
    };
  }, [cwd, sel, status, changes.length]);

  if (!team || !agent) {
    return (
      <div className="flex min-h-0 flex-auto flex-col items-center justify-center gap-3 p-3">
        <span className="text-[13px] text-ink-2">AI를 찾을 수 없어요 ({id})</span>
        <button onClick={() => go({ name: "main" })} className={`glass ${pill}`}>
          스택으로
        </button>
      </div>
    );
  }

  const s = STATUS[agent.status];
  const task = team.tasks.find((t) => t.id === agent.taskId);
  const parent = team.agents.find((a) => a.id === agent.parentId);
  const children = team.agents.filter((a) => a.parentId === id);
  const escs = team.chat.filter((m) => m.escalation && !m.escalation.answer && m.escalation.agentId === id);
  const live = (agent.structured || agent.ptyId != null) && agent.status !== "off" && agent.status !== "done";
  const app = useApp.getState();

  const send = () => {
    const v = text.trim();
    if (!v) return;
    void app.messageAgent(id, v);
    setText("");
  };

  return (
    <div className="flex min-h-0 flex-auto flex-col" style={{ color: "var(--text)" }}>
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-1 max-[820px]:gap-x-2" style={{ minHeight: 46 }}>
        <button onClick={() => go({ name: "main" })} aria-label="뒤로" title="관제탑으로 돌아가기" className="flex size-[34px] items-center justify-center rounded-[10px] border-0 bg-transparent text-ink-2 hover:bg-[var(--chip)]">
          <ChevronLeft size={18} />
        </button>
        <span className="text-[15px] font-semibold">{catName(agent)}</span>
        <span
          className="flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12.5px] font-medium"
          style={{ background: agent.status === "block" ? "var(--block-bg)" : "var(--chip)", color: s.ink }}
        >
          <span className={`${s.cls} size-[7px] rounded-full`} style={{ background: s.color }} />
          {s.label} · {elapsed(agent.statusSince)}째
        </span>
        <span className="rounded-full px-2 py-0.5 font-mono text-[11.5px]" style={{ background: "var(--chip)" }}>
          {agent.model}
        </span>
        <span className="font-mono text-[12px] text-ink-2">{usd(agent.costUsd)}</span>
        <div className="flex-auto" />
        {agent.status === "off" ? (
          <button onClick={() => void app.resumeAgent(id)} title="하던 대화를 이어서 다시 시작해요" className={`glass ${pill}`}>
            <Svg><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Svg>이어서 다시 시작
          </button>
        ) : agent.status !== "done" ? (
          <button onClick={() => void app.pauseAgent(id)} title="잠시 멈춰요. 나중에 이어서 할 수 있어요" className={`glass ${pill}`}>
            <Svg><path d="M9 5v14M15 5v14" /></Svg>일시정지
          </button>
        ) : null}
        {confirmKill ? (
          <span className="flex items-center gap-2 text-[13px]" role="alertdialog" aria-label="종료 확인">
            <span style={{ color: "var(--block-ink)" }}>{catName(agent)}을(를) 멈출까요?</span>
            <button
              onClick={() => {
                void app.killAgent(id);
                setConfirmKill(false);
              }}
              className={pill}
              style={{ background: "var(--block)", color: "#fff" }}
            >
              종료
            </button>
            <button onClick={() => setConfirmKill(false)} className={`glass ${pill}`}>
              취소
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmKill(true)}
            disabled={agent.status === "off"}
            className={`${pill} disabled:opacity-50`}
            style={{ border: "1px solid var(--block)", color: "var(--block-ink)" }}
          >
            종료
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-auto flex-wrap gap-3 overflow-auto p-3">
        <section
          aria-label={`${catName(agent)} 작업 화면`}
          className={`flex min-h-[420px] min-w-0 flex-[999_1_560px] flex-col overflow-hidden rounded-2xl ${agent.structured ? "glass" : ""}`}
          style={agent.structured ? undefined : { background: "var(--term-bg)", color: "#e9e1d5", boxShadow: "0 20px 40px rgba(120,90,50,0.22)" }}
        >
          <div
            className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px]"
            style={agent.structured ? { borderBottom: "1px solid var(--line)", color: "var(--text2)" } : { borderBottom: "1px solid rgba(255,240,220,0.10)", color: "#a89c8e" }}
          >
            <span className="truncate font-mono">claude · {agent.model} · {agent.cwd}</span>
            <span className="flex-auto" />
            <span className="shrink-0 whitespace-nowrap">{live ? "실시간 화면" : "작업 종료"}</span>
          </div>
          <div className={`min-h-0 flex-auto ${agent.structured ? "flex flex-col" : "p-3"}`}>
            {agent.structured ? (
              <Transcript projectId={team?.projectId ?? null} agentId={agent.id} working={agent.status === "work"} />
            ) : live ? (
              <TerminalView ptyId={agent.ptyId} className="h-full w-full" />
            ) : (
              <div className="flex h-full items-center justify-center text-[13px]" style={{ color: "#a89c8e" }}>
                작업 종료
              </div>
            )}
          </div>
          <div
            className="mx-3 mb-3 flex items-center gap-2.5 rounded-xl py-1.5 pl-3.5 pr-1.5"
            style={{ background: "rgba(255,248,238,0.07)", border: "1px solid rgba(255,240,220,0.14)" }}
          >
            <span className="font-mono" style={{ color: "var(--amber)" }}>›</span>
            <input
              aria-label={`${catName(agent)}에게 메시지 보내기`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={!live}
              placeholder={parent ? `직접 지시하기 — 입력하면 ${catName(parent)}에게도 기록돼요` : "메시지 보내기"}
              className="min-h-[34px] min-w-0 flex-auto border-0 bg-transparent font-mono text-[13px] outline-none"
              style={{ color: "#f3ece2" }}
            />
            <button
              onClick={send}
              disabled={!live || !text.trim()}
              className="min-h-[34px] rounded-[9px] px-3.5 text-[13px] font-semibold disabled:opacity-50"
              style={{ background: "var(--amber)", color: "#1c1814" }}
            >
              메시지 보내기
            </button>
          </div>
        </section>

        <aside aria-label={`${catName(agent)} 정보`} className="flex min-w-0 max-w-[360px] flex-[1_1_320px] flex-col gap-3">
          {escs.map((m) => (
            <div key={m.id} className="glass flex flex-col gap-2 rounded-2xl p-4" style={{ borderColor: "var(--block)" }}>
              <span className="text-[12px] font-semibold" style={{ color: "var(--block-ink)" }}>결정 필요</span>
              <p className="m-0 text-[13px] leading-normal">{m.text}</p>
              <div className="flex flex-wrap gap-1.5">
                {m.escalation!.options.map((o) => (
                  <button key={o} onClick={() => void app.answerEscalation(m.id, o)} className="glass min-h-[32px] rounded-full px-3 text-[12.5px]">
                    {o}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = (answers[m.id] ?? "").trim();
                  if (!v) return;
                  void app.answerEscalation(m.id, v);
                  setAnswers((a) => ({ ...a, [m.id]: "" }));
                }}
              >
                <input
                  aria-label="직접 답하기"
                  value={answers[m.id] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [m.id]: e.target.value }))}
                  placeholder="직접 답하기"
                  className="min-h-[32px] min-w-0 flex-auto rounded-[10px] px-2.5 text-[12.5px] outline-none"
                  style={{ border: "1px solid var(--line)", background: "var(--glass2)" }}
                />
                <button type="submit" className="min-h-[32px] rounded-full px-3 text-[12.5px] font-semibold" style={{ background: "var(--amber)", color: "#1c1814" }}>
                  답하기
                </button>
              </form>
            </div>
          ))}

          <div className="glass flex flex-col gap-2.5 rounded-2xl p-4">
            {task ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="rounded-full px-[9px] py-[3px] font-mono text-[12px] font-medium" style={{ background: "var(--chip)" }}>
                    {task.id}
                  </span>
                  <span className="text-[12px] text-ink-2">맡은 작업 · {task.stage}</span>
                </div>
                <h2 className="m-0 text-[16px] font-semibold leading-snug">{task.title}</h2>
                {task.goal ? <p className="m-0 text-[12.5px] leading-normal text-ink-2">{task.goal}</p> : null}
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                  {task.files.length > 0 && (
                    <>
                      <dt className="text-ink-2">파일</dt>
                      <dd className="m-0 break-all font-mono">{task.files.join(", ")}</dd>
                    </>
                  )}
                  {task.doneWhen.length > 0 && (
                    <>
                      <dt className="text-ink-2">완료 조건</dt>
                      <dd className="m-0 font-mono">{task.doneWhen.join(" · ")}</dd>
                    </>
                  )}
                  <dt className="text-ink-2">비용</dt>
                  <dd className="m-0 font-mono">{usd(agent.costUsd)}</dd>
                </dl>
                {task.summary ? <p className="m-0 text-[12.5px] leading-normal">{task.summary}</p> : null}
              </>
            ) : (
              <span className="text-[13px] text-ink-2">{ROLE_NAME[agent.role]} · 맡은 작업 없음</span>
            )}
            {agent.lastNote ? (
              <div className="rounded-[10px] p-2.5 text-[12.5px] leading-normal" style={{ background: "var(--chip)" }}>
                <span className="mb-1 block text-[11.5px] text-ink-2">최근 메시지</span>
                <span className="line-clamp-6 whitespace-pre-wrap">{agent.lastNote}</span>
              </div>
            ) : null}
          </div>

          <div className="glass flex flex-col gap-3 rounded-2xl p-4">
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-medium">AI 모델</span>
              {agent.kind === "claude" ? (
                <ModelPicker uid={`agent-${id}`} value={agent.model} onChange={(m) => void app.setAgentModel(id, m)} compact />
              ) : (
                <span className="flex items-center gap-2 text-[12.5px]">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--chip)" }}>
                    {agent.kind === "antigravity" ? "Gemini" : "Codex"}
                  </span>
                  <span className="font-mono">{agent.model}</span>
                  <span className="text-[11px] text-ink-2">· 작업 중에는 Claude만 바꿀 수 있어요</span>
                </span>
              )}
            </div>
            {team && <MemberUsage team={team} agentId={id} />}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium">보고 받는 쪽</span>
              <span className="flex items-center gap-1.5 text-[13px]">
                {parent ? (
                  <button onClick={() => go({ name: "agent", id: parent.id })} className="min-h-[30px] rounded-full px-2.5" style={{ background: "var(--glass2)" }}>
                    {catName(parent)}
                  </button>
                ) : (
                  <span className="text-ink-2">없음</span>
                )}
              </span>
            </div>
            {children.length > 0 && (
              <div className="flex items-start justify-between gap-3">
                <span className="text-[13px] font-medium">맡긴 작업자</span>
                <span className="flex flex-wrap justify-end gap-1.5">
                  {children.map((c) => (
                    <button key={c.id} onClick={() => go({ name: "agent", id: c.id })} className="flex min-h-[30px] items-center gap-1.5 rounded-full px-2.5 text-[13px]" style={{ background: "var(--glass2)" }}>
                      <span className={`${STATUS[c.status].cls} size-1.5 rounded-full`} style={{ background: STATUS[c.status].color }} />
                      {catName(c)}
                    </button>
                  ))}
                </span>
              </div>
            )}
          </div>

          <div className="glass flex min-h-[140px] flex-auto flex-col gap-2 rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="m-0 text-[13px] font-semibold">바뀐 파일</h2>
              <span className="truncate font-mono text-[10.5px] text-ink-2 opacity-70" title="작업본 이름 (자세한 정보)">{agent.branch ?? "-"}</span>
            </div>
            {changes.length === 0 ? (
              <span className="text-[12.5px] text-ink-2">바뀐 내용 없음</span>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0 font-mono text-[12px]">
                {changes.map((c) => (
                  <li key={c.path} style={{ borderBottom: "1px solid var(--line)" }}>
                    <button
                      onClick={() => setSel(sel === c.path ? null : c.path)}
                      aria-pressed={sel === c.path}
                      className="flex w-full justify-between gap-2 py-[7px] text-left"
                      style={{ fontWeight: sel === c.path ? 600 : 400 }}
                    >
                      <span className="break-all">{c.path}</span>
                      <span style={{ color: c.code === "D" ? "var(--block-ink)" : "var(--work-ink)" }}>{c.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {sel && diff != null && (
              <pre
                aria-label={`${sel} 바뀐 내용`}
                className="m-0 max-h-[280px] overflow-auto rounded-[10px] p-2 font-mono text-[12px] leading-snug"
                style={{ background: "var(--chip)" }}
              >
                {diff === "" ? "(바뀐 내용 없음)" : diff.split("\n").map((l, i) => (
                  <div
                    key={i}
                    className="whitespace-pre"
                    style={{
                      color: l.startsWith("+") && !l.startsWith("+++") ? "var(--work-ink)" : l.startsWith("-") && !l.startsWith("---") ? "var(--block-ink)" : undefined,
                    }}
                  >
                    {l || " "}
                  </div>
                ))}
              </pre>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
