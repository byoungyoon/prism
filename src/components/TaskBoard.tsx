// 작업 보드: who is doing what, floor by floor — 총괄 on top, then every 팀장, then every 작업자,
// each with the card they hold. (The work itself, with results, is in the report feed.)
// Below: one merged progress log.
import { useState } from "react";
import { useApp, useShownTeams, waitsForMe } from "../store";
import type { Agent, Project, Role, TeamSnapshot } from "../lib/api";
import { clock } from "../data/types";
import { modelLabel } from "../data/models";
import { ChevronDown } from "./icons";
import { Critter } from "./critters";

const FLOORS: { role: Role; name: string }[] = [
  { role: "lead", name: "총괄" },
  { role: "mgr", name: "팀장" },
  { role: "worker", name: "작업자" },
];

const WORD: Record<string, string> = { queued: "대기", running: "진행 중", review: "검토", done: "완료", failed: "실패" };

/** What a member is on, in plain words; only problems get color. */
function stateOf(a: Agent, team: TeamSnapshot) {
  const task = a.taskId ? team.tasks.find((t) => t.id === a.taskId) : undefined;
  if (a.status === "block") return { task, word: "막힘", problem: true };
  if (task?.stage === "failed") return { task, word: "실패", problem: true };
  if (a.role === "lead") return { task, word: a.status === "work" ? "지시를 나누는 중" : a.status === "off" ? "퇴근" : "지시를 기다려요", problem: false };
  if (task) return { task, word: WORD[task.stage], problem: false };
  return { task, word: a.status === "done" ? "끝남" : "대기", problem: false };
}

function MemberRow({ a, team, project, multi }: { a: Agent; team: TeamSnapshot; project: Project; multi: boolean }) {
  const openIn = useApp((s) => s.openIn);
  const critters = useApp((s) => s.critters);
  const st = stateOf(a, team);
  const waiting = a.role === "lead" ? team.chat.filter(waitsForMe).length : 0;
  return (
    <button
      onClick={() => openIn(project.id, { name: "agent", id: a.id })}
      title={`${a.name} 작업 화면 · ${modelLabel(a.model)}`}
      className="flex min-h-8 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-[12.5px] hover:bg-[var(--chip)]"
    >
      {critters && <Critter agent={a} task={st.task} colorKey={a.role === "lead" ? project.name : undefined} size={24} className="-my-1 -ml-0.5" />}
      <span className="w-[68px] shrink-0 truncate font-medium">{a.role === "lead" && multi ? project.name : a.name}</span>
      <span className="flex min-w-0 flex-auto items-baseline gap-1.5 text-ink-2">
        {st.task && <span className="shrink-0 font-mono text-[11px] font-semibold text-[var(--text)]">{st.task.id}</span>}
        <span className="truncate">{st.task ? st.task.title : a.role === "lead" ? "" : (a.lastNote ?? "")}</span>
      </span>
      {waiting > 0 && (
        <span aria-label={`답해야 할 일 ${waiting}건`} className="shrink-0 rounded-full px-1.5 text-[10.5px] leading-[16px] font-semibold" style={{ background: "var(--block)", color: "#fff" }}>
          {waiting}
        </span>
      )}
      <span className="shrink-0 text-right text-[11.5px] font-medium" style={{ color: st.problem ? "var(--block-ink)" : "var(--text2)" }}>
        {st.word}
      </span>
    </button>
  );
}

/** Every shown team's people, floor by floor, and one merged progress log. */
export function TaskBoard() {
  const openIn = useApp((s) => s.openIn);
  const shown = useShownTeams();
  const multi = shown.length > 1;
  const [logOpen, setLogOpen] = useState(true);
  const [doneOpen, setDoneOpen] = useState(false);

  const tasks = shown.flatMap(({ team }) => team.tasks);
  const count = (stage: string) => tasks.filter((t) => t.stage === stage).length;
  // finished 팀장·작업자 are folded into one line below; the 총괄 always stays on top
  const members = (team: TeamSnapshot, role: Role) =>
    team.agents.filter((a) => a.role === role && (a.status !== "off" || role === "lead") && (a.status !== "done" || role === "lead")).sort((x, y) => x.name.localeCompare(y.name, "ko"));
  const doneGroups = shown
    .map(({ project, team }) => ({ project, team, list: team.agents.filter((a) => a.role !== "lead" && a.status === "done").sort((x, y) => x.name.localeCompare(y.name, "ko")) }))
    .filter((g) => g.list.length);
  const doneN = doneGroups.reduce((k, g) => k + g.list.length, 0);
  const unassigned = shown.flatMap(({ project, team }) => team.tasks.filter((t) => t.stage === "queued").map((t) => ({ t, project, team })));
  const events = shown
    .flatMap(({ project, team }) => team.events.map((e) => ({ ...e, project })))
    .sort((a, b) => b.at - a.at)
    .slice(0, 150);

  return (
    <section aria-label="작업 보드" className="glass flex max-w-[360px] min-w-0 flex-[1_1_330px] flex-col overflow-hidden rounded-2xl">
      <div className="flex flex-col gap-1 px-4 pt-3.5 pb-2">
        <h2 className="m-0 text-sm font-semibold">작업 보드</h2>
        <span className="text-[11.5px] text-ink-2">
          진행 <b className="font-semibold text-[var(--text)]">{count("running")}</b> · 검토 <b className="font-semibold text-[var(--text)]">{count("review")}</b> · 대기{" "}
          <b className="font-semibold text-[var(--text)]">{count("queued")}</b> · 완료 <b className="font-semibold text-[var(--text)]">{count("done")}</b>
        </span>
      </div>

      <div className="flex min-h-0 flex-auto flex-col overflow-y-auto px-2 pb-3">
        {FLOORS.map((f) => {
          const groups = shown.map(({ project, team }) => ({ project, team, list: members(team, f.role) })).filter((g) => g.list.length);
          const n = groups.reduce((k, g) => k + g.list.length, 0);
          return (
            <div key={f.role} className="flex flex-col gap-0.5 py-2" style={{ borderTop: f.role === "lead" ? undefined : "1px solid var(--line)" }}>
              <span className="px-2 pb-0.5 text-[11.5px] font-semibold text-ink-2">
                {f.name} <span className="font-normal">{n}</span>
              </span>
              {n === 0 && <span className="px-2 text-[12px] text-ink-2">아직 없어요</span>}
              {f.role === "lead"
                ? groups.map((g) => g.list.map((a) => <MemberRow key={`${g.project.id}-${a.id}`} a={a} team={g.team} project={g.project} multi={multi} />))
                : groups.map((g) => (
                    <div key={g.project.id} className="flex flex-col">
                      {multi && <span className="px-2 pt-1 text-[11px] text-ink-2">{g.project.name}</span>}
                      {g.list.map((a) => (
                        <MemberRow key={a.id} a={a} team={g.team} project={g.project} multi={multi} />
                      ))}
                    </div>
                  ))}
            </div>
          );
        })}

        {doneN > 0 && (
          <div className="flex flex-col gap-0.5 py-2" style={{ borderTop: "1px solid var(--line)" }}>
            <button
              onClick={() => setDoneOpen((v) => !v)}
              aria-expanded={doneOpen}
              className="flex min-h-8 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-[12px] text-ink-2 hover:bg-[var(--chip)]"
            >
              끝난 작업자 {doneN}명
              <ChevronDown size={13} className="ml-auto" style={{ transform: doneOpen ? undefined : "rotate(-90deg)", transition: "transform 160ms" }} />
            </button>
            {doneOpen &&
              doneGroups.map((g) => (
                <div key={g.project.id} className="flex flex-col">
                  {multi && <span className="px-2 pt-1 text-[11px] text-ink-2">{g.project.name}</span>}
                  {g.list.map((a) => (
                    <MemberRow key={a.id} a={a} team={g.team} project={g.project} multi={multi} />
                  ))}
                </div>
              ))}
          </div>
        )}

        {unassigned.length > 0 && (
          <div className="flex flex-col gap-0.5 py-2" style={{ borderTop: "1px solid var(--line)" }}>
            <span className="px-2 pb-0.5 text-[11.5px] font-semibold text-ink-2">
              맡을 사람 기다리는 일 <span className="font-normal">{unassigned.length}</span>
            </span>
            {unassigned.map(({ t, project, team }) => {
              const by = team.agents.find((a) => a.id === t.requestedBy);
              return (
                <button
                  key={`${project.id}-${t.id}`}
                  onClick={() => by && openIn(project.id, { name: "agent", id: by.id })}
                  title={by ? `${by.name}이(가) 나눈 일` : undefined}
                  className="flex min-h-8 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-[12.5px] hover:bg-[var(--chip)]"
                >
                  <span className="shrink-0 font-mono text-[11px] font-semibold">{t.id}</span>
                  <span className="min-w-0 flex-auto truncate">{t.title}</span>
                  {multi && <span className="max-w-[90px] shrink-0 truncate text-[11px] text-ink-2">{project.name}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex max-h-[38%] min-h-0 flex-col max-[820px]:max-h-[26%]" style={{ borderTop: "1px solid var(--line)" }}>
        <button onClick={() => setLogOpen((v) => !v)} aria-expanded={logOpen} className="flex items-center gap-1.5 border-0 bg-transparent px-4 pt-2.5 pb-1.5 text-left text-[13px] font-semibold">
          진행 기록
          <span className="text-[11.5px] font-normal text-ink-2">{events.length}</span>
          <ChevronDown size={13} className="ml-auto text-ink-2" style={{ transform: logOpen ? undefined : "rotate(-90deg)", transition: "transform 160ms" }} />
        </button>
        {logOpen && (
          <ol className="m-0 flex min-h-0 list-none flex-col gap-1.5 overflow-y-auto px-4 pt-0.5 pb-3">
            {events.map((e, i) => (
              <li key={`${e.project.id}-${e.at}-${i}`} className="flex gap-2 text-[12.5px] leading-[1.45]">
                <span className="w-9 shrink-0 pt-px font-mono text-[11px] text-ink-2">{clock(e.at)}</span>
                {/* a problem gets a red dot; the text stays plain */}
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: e.tone === "block" ? "var(--block)" : "transparent" }} />
                <span className="line-clamp-2 min-w-0">
                  {multi && <span className="text-ink-2">{e.project.name} · </span>}
                  {e.text}
                </span>
              </li>
            ))}
            {events.length === 0 && <li className="text-[12px] text-ink-2">아직 기록이 없어요</li>}
          </ol>
        )}
      </div>
    </section>
  );
}
