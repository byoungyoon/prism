// 작업 보드: who is doing what, as a tree of who handed work to whom — each team's 총괄 on top, its
// 팀장 (and the 작업자 it gave cards to directly) under it, and under each 팀장 the 작업자 it asked,
// each with the card they hold. (The work itself, with results, is in the report feed.)
// Below: one merged progress log.
import { useState, type ReactNode } from "react";
import { isLive, useApp, useShownTeams, waitsForMe } from "../store";
import type { Agent, Project, Role, TeamSnapshot } from "../lib/api";
import { clock } from "../data/types";
import { modelLabel } from "../data/models";
import { ChevronDown } from "./icons";
import { currentCard, finishedCrew, liveCrew, useDismissed } from "../lib/crew";
import { MergeActions, MergeAllButton } from "./MergeActions";
import { TeamUsageBox } from "./TokenUse";
import { catName } from "./critters/pixel/coats";

const FLOORS: { role: Role; name: string }[] = [
  { role: "lead", name: "총괄" },
  { role: "mgr", name: "팀장" },
  { role: "worker", name: "작업자" },
];

const WORD: Record<string, string> = { queued: "대기", running: "진행 중", review: "합치기 대기", done: "완료", failed: "실패" };

/** What a member is on, in plain words; only problems get color. */
function stateOf(a: Agent, team: TeamSnapshot) {
  // its card now (a card that is already over is not shown next to a member still at work)
  const task = currentCard(team, a);
  if (a.restSince) return { task: undefined, word: "휴게실", problem: false };
  if (a.status === "block") return { task, word: "막힘", problem: true };
  if (task?.stage === "failed") return { task, word: "실패", problem: true };
  if (a.role === "lead") return { task, word: a.status === "work" ? "지시를 나누는 중" : a.status === "off" ? "퇴근" : "지시를 기다려요", problem: false };
  if (task) return { task, word: a.status === "done" && task.stage === "review" ? "보고함" : WORD[task.stage], problem: false };
  return { task, word: a.status === "done" ? "끝남" : a.status === "work" ? "작업 중" : "대기", problem: false };
}

function MemberRow({ a, team, project, multi, tree }: { a: Agent; team: TeamSnapshot; project: Project; multi: boolean; tree?: boolean }) {
  const openIn = useApp((s) => s.openIn);
  const st = stateOf(a, team);
  const waiting = a.role === "lead" ? team.chat.filter(waitsForMe).length : 0;
  return (
    <button
      data-critter-anchor={`member:${project.id}:${a.id}${st.task ? ` task:${project.id}:${st.task.id}` : ""}`}
      onClick={() => openIn(project.id, { name: "agent", id: a.id })}
      title={`${catName(a)} 작업 화면 · ${modelLabel(a.model)}`}
      className="flex min-h-8 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-[12.5px] hover:bg-[var(--chip)]"
    >
      {/* in the tree the indent already takes width, so the name takes only what it needs */}
      <span className={`${tree ? "max-w-[68px]" : "w-[68px]"} shrink-0 truncate font-medium`}>{a.role === "lead" && multi ? project.name : catName(a)}</span>
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

type TreeNode = { a: Agent; kids: Agent[] };

/**
 * The members at work as a tree. A 작업자 hangs under the 팀장 who asked for its card (no card: the
 * one who brought it in), everyone else right under the 총괄. A 팀장 whose 작업자 are still at work
 * stays in the tree even when idle or finished itself.
 */
function teamTree(team: TeamSnapshot, active: Agent[]) {
  const nodes = new Map<string, TreeNode>();
  const nodeOf = (a: Agent) => {
    let n = nodes.get(a.id);
    if (!n) nodes.set(a.id, (n = { a, kids: [] }));
    return n;
  };
  active.filter((a) => a.role === "mgr").forEach(nodeOf);
  for (const a of active.filter((x) => x.role === "worker")) {
    const by = currentCard(team, a)?.requestedBy ?? a.parentId;
    const boss = team.agents.find((x) => x.id === by && x.role === "mgr");
    if (boss) nodeOf(boss).kids.push(a);
    else nodeOf(a);
  }
  // 팀장 first, then the 작업자 the 총괄 asked directly
  const children = [...nodes.values()].sort((x, y) => Number(x.a.role !== "mgr") - Number(y.a.role !== "mgr") || x.a.name.localeCompare(y.a.name, "ko"));
  const lead = active.find((a) => a.role === "lead");
  const ids = new Set([...(lead ? [lead] : []), ...children.flatMap((n) => [n.a, ...n.kids])].map((a) => a.id));
  return { lead, children, ids };
}

/** One child in the tree: the connector line from its parent, then its row (and its own children). */
function Branch({ last, children }: { last: boolean; children: ReactNode }) {
  return (
    <li className="relative min-w-0 pl-2.5">
      {/* rows are 32px tall, so the elbow sits at 16px; the last child's line stops there */}
      <span aria-hidden className="absolute top-0 left-0 w-px bg-[var(--text2)] opacity-35" style={{ height: last ? 16 : "100%" }} />
      <span aria-hidden className="absolute top-4 left-0 h-px w-2.5 bg-[var(--text2)] opacity-35" />
      {children}
    </li>
  );
}

const TREE_LIST = "m-0 ml-3.5 flex list-none flex-col p-0";

/** Every shown team's people as a tree, and one merged progress log. */
const reportKey = (pid: string, t: { id: string; updatedAt: number }) => `report:${pid}:${t.id}:${t.updatedAt}`; // 새로 보고되면(updatedAt 변경) 키가 달라져 다시 보인다

export function TaskBoard() {
  const openIn = useApp((s) => s.openIn);
  // teams whose 총괄 went home (off) stay out of the whole board, counts included
  const shown = useShownTeams().filter(({ team }) => {
    const lead = team.agents.find((a) => a.role === "lead");
    return lead ? lead.status !== "off" : isLive(team);
  });
  const multi = shown.length > 1;
  const [logOpen, setLogOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const { has: isDismissed, dismiss } = useDismissed();
  // 팀장 lines the user folded (open by default)
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggleFold = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const tasks = shown.flatMap(({ team }) => team.tasks);
  const count = (stage: string) => tasks.filter((t) => t.stage === stage).length;
  // finished 팀장·작업자 are folded into one line below; the 총괄 always stays on top
  // one rule for "who is on the team" (lib/crew): the same people the office and the team tabs show
  const members = (team: TeamSnapshot, role: Role) => liveCrew(team, { withLead: true }).filter((a) => a.role === role);
  // only who is at work (or the 총괄) shows by default; idle and finished members fold into one line
  const isActive = (a: Agent, team: TeamSnapshot) => a.role === "lead" || a.status === "work" || a.status === "block" || (!a.restSince && !!currentCard(team, a));
  const crewOf = (team: TeamSnapshot) => FLOORS.flatMap((f) => members(team, f.role));
  const trees = shown.map(({ project, team }) => ({ project, team, ...teamTree(team, crewOf(team).filter((a) => isActive(a, team))) }));
  const activeN = trees.reduce((k, t) => k + t.ids.size, 0);
  // whoever is already in the tree isn't listed again below
  const doneGroups = trees
    .map(({ project, team, ids }) => ({ project, team, list: [...crewOf(team).filter((a) => !isActive(a, team)), ...finishedCrew(team)].filter((a) => !ids.has(a.id)) }))
    .filter((g) => g.list.length);
  const doneN = doneGroups.reduce((k, g) => k + g.list.length, 0);
  // reports waiting in the 보고함: each one can be merged (합치기) or closed (완료) right here
  const reports = shown.flatMap(({ project, team }) => team.tasks.filter((t) => t.stage === "review" && !isDismissed(reportKey(project.id, t))).map((t) => ({ t, project })));
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
          진행 <b className="font-semibold text-[var(--text)]">{count("running")}</b>
          {count("review") > 0 && <> · 합치기 대기 <b className="font-semibold text-[var(--text)]">{count("review")}</b></>}
          {count("queued") > 0 && <> · 대기 {count("queued")}</>}
        </span>
      </div>

      <div className="flex min-h-0 flex-auto flex-col overflow-y-auto px-2 pb-3">
        {shown.length === 0 && <span className="px-2 py-3 text-[12px] text-ink-2">출근한 팀이 없어요</span>}

        {reports.length > 0 && (
          <div className="flex flex-col gap-1.5 py-2">
            <span className="px-2 pb-0.5 text-[11.5px] font-semibold text-ink-2">
              보고함 <span className="font-normal">{reports.length}</span>
            </span>
            {reports.length > 1 && (
              <button
                onClick={() => reports.forEach(({ t, project }) => dismiss(reportKey(project.id, t)))}
                title="합치지 않고 목록에서만 치워요 (카드와 브랜치는 그대로)"
                className="mx-2 min-h-7 self-start rounded-full border-0 px-3 text-[12px] text-ink-2 hover:bg-[var(--chip)]"
                style={{ background: "var(--chip)" }}
              >
                모두 치우기 ({reports.length}장)
              </button>
            )}
            {[...new Set(reports.map((r) => r.project))].map((p) => (
              <MergeAllButton key={p.id} project={p} tasks={reports.filter((r) => r.project === p).map((r) => r.t)} />
            ))}
            {reports.map(({ t, project }) => (
              <div key={`${project.id}-${t.id}`} className="flex flex-col gap-1 rounded-lg px-2 py-1.5" style={{ background: "var(--glass2)" }}>
                <span className="flex min-w-0 items-baseline gap-2 text-[12.5px]">
                  <span className="shrink-0 font-mono text-[11px] font-semibold">{t.id}</span>
                  <span className="min-w-0 flex-auto truncate">{t.title}</span>
                  {multi && <span className="max-w-[90px] shrink-0 truncate text-[11px] text-ink-2">{project.name}</span>}
                  <button onClick={() => dismiss(reportKey(project.id, t))} aria-label="보고함에서 치우기" title="합치지 않고 목록에서만 치워요 (카드와 브랜치는 그대로)" className="size-5 shrink-0 cursor-pointer self-center rounded border-0 bg-transparent p-0 text-[12px] leading-none text-ink-2 hover:bg-[var(--chip)]">
                    ✕
                  </button>
                </span>
                <MergeActions project={project} task={t} />
              </div>
            ))}
          </div>
        )}

        {shown.length > 0 && (
          <div className="flex flex-col gap-0.5 py-2" style={{ borderTop: reports.length ? "1px solid var(--line)" : undefined }}>
            <span className="px-2 pb-0.5 text-[11.5px] font-semibold text-ink-2">
              지금 하는 일 <span className="font-normal">{activeN}</span>
            </span>
            {trees.map(({ project, team, lead, children }) => {
              const row = (a: Agent) => <MemberRow a={a} team={team} project={project} multi={multi} tree />;
              return (
                <div key={project.id} className="flex min-w-0 flex-col">
                  {lead ? row(lead) : multi && <span className="px-2 pt-1 text-[11px] text-ink-2">{project.name}</span>}
                  <ul aria-label={`${project.name} 맡긴 일`} className={TREE_LIST}>
                    {children.map(({ a, kids }, i) => {
                      const key = `${project.id}:${a.id}`;
                      const open = !folded.has(key);
                      // a folded line still tells when someone under it is in trouble
                      const trouble = !open && kids.some((k) => stateOf(k, team).problem);
                      return (
                        <Branch key={a.id} last={i === children.length - 1}>
                          {kids.length === 0 ? (
                            row(a)
                          ) : (
                            <>
                              <div className="flex min-w-0 items-center">
                                <div className="min-w-0 flex-auto">{row(a)}</div>
                                <button
                                  onClick={() => toggleFold(key)}
                                  aria-expanded={open}
                                  aria-label={`${catName(a)}에게 딸린 작업자 ${kids.length}명 ${open ? "접기" : "펼치기"}${trouble ? " (문제 있음)" : ""}`}
                                  title={open ? "접기" : "펼치기"}
                                  className="flex h-8 shrink-0 cursor-pointer items-center gap-0.5 rounded-lg border-0 bg-transparent px-1 text-[11px] text-ink-2 hover:bg-[var(--chip)]"
                                  style={trouble ? { color: "var(--block-ink)", fontWeight: 600 } : undefined}
                                >
                                  {!open && <span>{trouble ? "문제 · " : ""}{kids.length}명</span>}
                                  <ChevronDown size={13} style={{ transform: open ? undefined : "rotate(-90deg)", transition: "transform 160ms" }} />
                                </button>
                              </div>
                              {open && (
                                <ul className={TREE_LIST}>
                                  {kids.map((k, j) => (
                                    <Branch key={k.id} last={j === kids.length - 1}>
                                      {row(k)}
                                    </Branch>
                                  ))}
                                </ul>
                              )}
                            </>
                          )}
                        </Branch>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {doneN > 0 && (
          <div className="flex flex-col gap-0.5 py-2" style={{ borderTop: "1px solid var(--line)" }}>
            <button
              onClick={() => setDoneOpen((v) => !v)}
              aria-expanded={doneOpen}
              className="flex min-h-8 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-[12px] text-ink-2 hover:bg-[var(--chip)]"
            >
              쉬는·끝난 팀원 {doneN}명
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
            <button onClick={() => setQueueOpen((v) => !v)} aria-expanded={queueOpen} className="flex min-h-8 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-[12px] text-ink-2 hover:bg-[var(--chip)]">
              맡을 사람 기다리는 일 {unassigned.length}
              <ChevronDown size={13} className="ml-auto" style={{ transform: queueOpen ? undefined : "rotate(-90deg)", transition: "transform 160ms" }} />
            </button>
            {queueOpen && unassigned.map(({ t, project, team }) => {
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

      {shown.length > 0 && (
        <div className="flex shrink-0 flex-col px-2 py-1" style={{ borderTop: "1px solid var(--line)" }}>
          {shown.map(({ project, team }) => (
            <TeamUsageBox key={project.id} projectId={project.id} team={team} label={multi ? project.name : undefined} />
          ))}
        </div>
      )}
      {shown.length > 0 && <div className="flex max-h-[38%] min-h-0 shrink-0 flex-col max-[820px]:max-h-[26%]" style={{ borderTop: "1px solid var(--line)" }}>
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
      </div>}
    </section>
  );
}
