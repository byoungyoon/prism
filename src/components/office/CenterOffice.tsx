// The middle of the 관제탑: a row of one small summary tab per team (총괄) on top — name and how many
// cards are running, in review, done — and below it the office where the team's cats work. Picking
// a team's tab shows that team's full report list instead; the 사무실 tab brings the office back.
import { useState } from "react";
import { useOfficeTeams, waitsForMe } from "../../store";
import type { TeamSnapshot } from "../../lib/api";
import { ReportFeed } from "../ReportFeed";
import { Office } from "./Office";
import { busyCrew, liveCrew } from "../../lib/crew";
import "./office.css";

const count = (t: TeamSnapshot, stage: string) => t.tasks.filter((x) => x.stage === stage).length;

export function CenterOffice() {
  const shown = useOfficeTeams();
  const [open, setOpen] = useState<string | null>(null);
  // a team that left the screen: back to the office
  const pick = open && shown.some((s) => s.project.id === open) ? open : null;

  return (
    <section aria-label="사무실" className="of-center flex min-h-0 min-w-0 flex-auto flex-col gap-2">
      {/* many teams: the row scrolls sideways (a plain mouse wheel too), fading out at the edge */}
      <div
        role="tablist"
        aria-label="팀 요약"
        className="of-tabs"
        onWheel={(e) => {
          const el = e.currentTarget;
          if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
        }}
      >
        <button role="tab" aria-selected={!pick} onClick={() => setOpen(null)} className={`of-tab of-tab-office${pick ? "" : " on"}`}>
          <span className="of-tab-name">🏢 사무실</span>
          <span className="of-tab-sub">
            팀원 {shown.reduce((n, s) => n + liveCrew(s.team).length, 0)}명 · 일하는 중 {shown.reduce((n, s) => n + busyCrew(s.team).length, 0)}명
          </span>
        </button>
        {shown.map(({ project, team }) => {
          const asks = team.chat.filter(waitsForMe).length;
          const on = pick === project.id;
          return (
            <button key={project.id} role="tab" aria-selected={on} onClick={() => setOpen(on ? null : project.id)} className={`of-tab${on ? " on" : ""}`} title={`${project.name} 보고 보기`}>
              <span className="of-tab-name">
                {project.name}
                {asks > 0 && (
                  <span className="of-tab-badge" aria-label={`답해야 할 일 ${asks}건`}>
                    {asks}
                  </span>
                )}
              </span>
              <span className="of-tab-sub">
                진행 <b>{count(team, "running")}</b> · 검토 <b>{count(team, "review")}</b> · 완료 <b>{count(team, "done")}</b>
              </span>
            </button>
          );
        })}
      </div>
      {pick ? (
        <div className="flex min-h-0 min-w-0 flex-auto flex-col [&>section]:flex-auto">
          <ReportFeed only={pick} />
        </div>
      ) : (
        <Office onTeam={setOpen} />
      )}
    </section>
  );
}
