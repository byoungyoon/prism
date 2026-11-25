// The permission requests the user has to decide, shown right above a chat's input box so they can
// answer without leaving the chat. Same answers as the report feed (allow / always / deny).
import { AnimatePresence, motion } from "motion/react";
import { useApp, waitsForMe } from "../store";
import type { ChatMsg, Project, TeamSnapshot } from "../lib/api";
import { plainAction } from "../lib/plainAction";
import { TeamTag } from "./TeamTag";
import { catName } from "./critters/pixel/coats";

type Group = { project: Project; team: TeamSnapshot };

/** the requests waiting for the user in one team (a 팀장/총괄 still deciding doesn't count) */
const askingFor =(team: TeamSnapshot): ChatMsg[] => team.chat.filter((m) => m.permission && waitsForMe(m));

export function PermissionAsks({ groups, multi = false }: { groups: Group[]; multi?: boolean }) {
  const answerPermission = useApp((s) => s.answerPermission);
  const rows = groups.flatMap((g) => askingFor(g.team).map((m) => ({ ...g, m })));
  if (!rows.length) return null;

  const answerAll = () => rows.forEach((r) => void answerPermission(r.m.id, "allow", r.project.id));

  return (
    <section aria-label="허락 요청" className="flex max-h-[40vh] min-w-0 shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain rounded-[14px] p-2.5" style={{ background: "rgba(232,161,90,0.12)", border: "1px solid var(--amber)" }}>
      <div className="flex items-center gap-2 px-0.5">
        <span className="s-work size-2 rounded-full" style={{ background: "var(--amber)" }} />
        <h3 className="m-0 min-w-0 flex-auto text-[12.5px] font-semibold">허락이 필요해요 · {rows.length}건</h3>
        {rows.length > 1 && (
          <button onClick={answerAll} className="min-h-7 shrink-0 whitespace-nowrap rounded-full border-0 px-3 text-[12px] font-semibold" style={{ background: "var(--amber)", color: "#2B2520" }}>
            모두 허락
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {rows.map(({ project, team, m }) => {
          const p = m.permission!;
          const ag = team.agents.find((a) => a.id === p.agentId);
          const who = ag ? catName(ag) : "팀원";
          const answer = (a: "allow" | "always" | "deny") => answerPermission(m.id, a, project.id);
          return (
            <motion.div key={`${project.id}-${m.id}`} data-critter-anchor={`ask:${project.id}:${p.agentId}`} layout="position" exit={{ opacity: 0, height: 0 }} className="flex min-w-0 shrink-0 flex-col gap-1.5 overflow-hidden rounded-xl px-3 py-2" style={{ background: "var(--glass2)" }}>
              <div className="flex flex-wrap items-center gap-2">
                {multi && <TeamTag project={project} className="text-[11px]" />}
                <span className="min-w-0 flex-[1_1_9rem] text-[12.5px] leading-snug [overflow-wrap:anywhere]">
                  <span className="font-semibold">{who}</span> · {plainAction(p.tool, p.detail)}
                </span>
                <span className="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
                  <button onClick={() => answer("allow")} className="min-h-7 whitespace-nowrap rounded-full border-0 px-3 text-[12px] font-semibold" style={{ background: "var(--amber)", color: "#2B2520" }}>
                    허락
                  </button>
                  <button onClick={() => answer("always")} className="min-h-7 whitespace-nowrap rounded-full px-2.5 text-[12px]" style={{ border: "1px solid var(--line)", background: "var(--tile)" }}>
                    항상 허락
                  </button>
                  <button onClick={() => answer("deny")} className="min-h-7 whitespace-nowrap rounded-full px-2.5 text-[12px]" style={{ border: "1px solid var(--line)", color: "var(--block-ink)" }}>
                    거절
                  </button>
                </span>
              </div>
              <details className="text-[11.5px] text-ink-2">
                <summary className="cursor-pointer select-none">명령 원문 보기</summary>
                <code className="mt-1 block max-h-40 overflow-y-auto rounded-md px-2 py-1 font-mono break-all whitespace-pre-wrap select-text" style={{ background: "var(--term-bg)", color: "#efe6d8" }}>
                  {p.tool === "Bash" ? p.detail : `${p.tool} · ${p.detail}`}
                </code>
              </details>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </section>
  );
}
