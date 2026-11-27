// The middle of the 관제탑: a slim row of tabs on top (사무실 + one per team) — each team's name with
// small badges for cards running and waiting to merge, and a red mark when someone is stuck; the full
// numbers are in the tooltip — and below it the office where the team's cats work. Picking a team's
// tab shows that team's full report list instead; the 사무실 tab brings the office back.
import { useCallback, useEffect, useRef, useState } from "react";
import { useOfficeTeams, waitsForMe } from "../../store";
import type { TeamSnapshot } from "../../lib/api";
import { ReportFeed } from "../ReportFeed";
import { Office } from "./Office";
import { busyCrew, liveCrew } from "../../lib/crew";
import "./office.css";

const count = (t: TeamSnapshot, stage: string) => t.tasks.filter((x) => x.stage === stage).length;
const blockedCount = (t: TeamSnapshot) => liveCrew(t).filter((a) => a.status === "block" || a.stuck).length;

/** The tab row scrolls sideways when it overflows: fade whichever end has more, and keep the picked tab in view. */
function useTabScroll(picked: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const fade = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.toggleAttribute("data-more-left", el.scrollLeft > 1);
    el.toggleAttribute("data-more-right", el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);
  // every render: a team or a badge may have changed the row's width
  useEffect(fade);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const watch = new ResizeObserver(fade);
    watch.observe(el);
    return () => watch.disconnect();
  }, [fade]);
  // a team can be picked from the office below while its tab is scrolled out of sight
  useEffect(() => {
    const el = ref.current;
    const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !tab) return;
    const row = el.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    const room = 28; // clear of the faded ends
    if (box.left < row.left + room) el.scrollLeft -= row.left + room - box.left;
    else if (box.right > row.right - room) el.scrollLeft += box.right - (row.right - room);
  }, [picked]);
  return { ref, fade };
}

export function CenterOffice() {
  const shown = useOfficeTeams();
  const [open, setOpen] = useState<string | null>(null);
  // a team that left the screen: back to the office
  const pick = open && shown.some((s) => s.project.id === open) ? open : null;
  const tabs = useTabScroll(pick);
  const members = shown.reduce((n, s) => n + liveCrew(s.team).length, 0);
  const busy = shown.reduce((n, s) => n + busyCrew(s.team).length, 0);

  return (
    <section aria-label="사무실" className="of-center flex min-h-0 min-w-0 flex-auto flex-col gap-2">
      {/* many teams: the row scrolls sideways (a plain mouse wheel too), fading out at the ends */}
      <div className="of-tabbar">
        <div
          ref={tabs.ref}
          role="tablist"
          aria-label="팀 요약"
          className="of-tabs"
          onScroll={tabs.fade}
          onWheel={(e) => {
            const el = e.currentTarget;
            if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
          }}
        >
          <button role="tab" aria-selected={!pick} onClick={() => setOpen(null)} className={`of-tab${pick ? "" : " on"}`} title={`팀원 ${members}명 · 일하는 중 ${busy}명`}>
            <span className="of-tab-name">🏢 사무실</span>
          </button>
          {shown.map(({ project, team }) => {
            const asks = team.chat.filter(waitsForMe).length;
            const running = count(team, "running");
            const review = count(team, "review");
            const blocked = blockedCount(team);
            const on = pick === project.id;
            const detail = [`진행 ${running} · 적용 대기 ${review} · 완료 ${count(team, "done")}`, blocked > 0 && `막힘 ${blocked}명`, asks > 0 && `답해야 할 일 ${asks}건`].filter(Boolean).join("\n");
            return (
              <button key={project.id} role="tab" aria-selected={on} onClick={() => setOpen(on ? null : project.id)} className={`of-tab${on ? " on" : ""}`} title={`${project.name}\n${detail}`}>
                <span className="of-tab-name">{project.name}</span>
                {running > 0 && (
                  <span className="of-tab-run" aria-label={`진행 ${running}`}>
                    {running}
                  </span>
                )}
                {review > 0 && (
                  <span className="of-tab-review" aria-label={`적용 대기 ${review}`}>
                    대기 {review}
                  </span>
                )}
                {/* a question for the user outranks the plain stuck dot: one red mark per tab */}
                {asks > 0 ? (
                  <span className="of-tab-badge" aria-label={`답해야 할 일 ${asks}건`}>
                    {asks}
                  </span>
                ) : (
                  blocked > 0 && <span className="of-tab-block" role="img" aria-label={`막힘 ${blocked}명`} />
                )}
              </button>
            );
          })}
        </div>
      </div>
      {/* the office stays mounted (just hidden) so the cats, lounge and scroll keep their place */}
      <div hidden={!!pick} className={pick ? undefined : "flex min-h-0 min-w-0 flex-auto flex-col"} style={pick ? { display: "none" } : undefined}>
        <Office onTeam={setOpen} paused={!!pick} />
      </div>
      {pick && (
        <div className="flex min-h-0 min-w-0 flex-auto flex-col [&>section]:flex-auto">
          <ReportFeed only={pick} />
        </div>
      )}
    </section>
  );
}
