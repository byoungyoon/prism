// A round little teammate: a cat drawn in code (poses.tsx). The state picks the pose and the motion
// (critters.css), the name (or colorKey) picks the color. No role props: a role shows as its name tag and colour.
import { memo } from "react";
import type { Agent, Role, Task } from "../../lib/api";
import { CatBody } from "./poses";
import { colorOf, critterState, POSE_OF, STATE_WORD, type CritterState, type Pose } from "./state";
import "./critters.css";

export interface CritterLook {
  name: string;
  role: Role;
  state: CritterState;
}

interface Props {
  /** the teammate; or pass `look` directly */
  agent?: Agent;
  /** the card it holds (so a failed card shows a sad face) */
  task?: Task;
  look?: CritterLook;
  /** picks the color instead of the name (e.g. the team name for a 총괄 — they are all called 총괄) */
  colorKey?: string;
  /** overrides the state worked out from the agent */
  state?: CritterState;
  /** overrides the pose the state would show (see POSE_OF in state.ts) */
  pose?: Pose;
  /** height in px */
  size?: number;
  /** face left (walking back) */
  flip?: boolean;
  /** decorative next to a text label (default): hidden from screen readers */
  labelled?: boolean;
  className?: string;
}

/** Bits that float around the critter for some states. */
function Overlay({ state }: { state: CritterState }) {
  switch (state) {
    case "think":
      return (
        <g className="cr-think">
          <circle cx="36.6" cy="15.6" r="1.1" fill="var(--cr-bubble)" stroke="var(--cr-bubble-line)" strokeWidth="0.6" />
          <rect x="32.4" y="3" width="14.6" height="8.6" rx="4.3" fill="var(--cr-bubble)" stroke="var(--cr-bubble-line)" strokeWidth="0.6" />
          {[36, 39.7, 43.4].map((x, i) => (
            <circle key={x} className="cr-dot" style={{ animationDelay: `${i * 0.22}s` }} cx={x} cy="7.3" r="1.1" fill="var(--text2)" />
          ))}
        </g>
      );
    case "block":
      return (
        <g className="cr-ask">
          <circle cx="40" cy="8" r="5.6" fill="#e2b866" />
          <text x="40" y="11" textAnchor="middle" fontSize="8.4" fontWeight="800" fill="#5c400c" fontFamily="system-ui, sans-serif">
            ?
          </text>
        </g>
      );
    case "done":
      return (
        <g>
          {[
            [7, 12, 0],
            [41, 9, 0.35],
            [38, 20, 0.7],
          ].map(([x, y, d]) => (
            <path
              key={x}
              className="cr-spark"
              style={{ animationDelay: `${d}s` }}
              d={`M${x} ${y - 3.4} Q${x + 0.6} ${y - 0.6} ${x + 3.4} ${y} Q${x + 0.6} ${y + 0.6} ${x} ${y + 3.4} Q${x - 0.6} ${y + 0.6} ${x - 3.4} ${y} Q${x - 0.6} ${y - 0.6} ${x} ${y - 3.4} Z`}
              fill="#f2c14e"
            />
          ))}
        </g>
      );
    case "fail":
      return <path className="cr-drop" d="M36.4 17.4 Q38.6 20.6 38.6 22 a2.2 2.2 0 0 1 -4.4 0 Q34.2 20.6 36.4 17.4 Z" fill="#8fc1e8" />;
    case "off":
      return (
        <text className="cr-z" x="35" y="13" fontSize="7" fontWeight="700" fill="var(--text2)" fontFamily="system-ui, sans-serif">
          z
        </text>
      );
    case "work":
      return (
        <path className="cr-tap" d="M5 33 L3 31.6 M5.4 30.6 L3.6 28.6 M43 33 L45 31.6 M42.6 30.6 L44.4 28.6" stroke="var(--text2)" strokeWidth="0.9" strokeLinecap="round" />
      );
    default:
      return null;
  }
}

function CritterSvg({ name, role, state, pose, size, flip, label, className, colorKey }: CritterLook & { pose: Pose; size: number; flip?: boolean; label?: string; className?: string; colorKey?: string }) {
  const [fill, shade] = colorOf(colorKey ?? name, role);
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={`critter cr-${state} cr-pose-${pose} cr-r-${role}${className ? ` ${className}` : ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <g className={flip ? "cr-flip" : undefined}>
        <ellipse className="cr-shadow" cx="24" cy="44" rx="12" ry="2" fill="#000" opacity="0.12" />
        <g className="cr-whole">
          <g className="cr-body">
            <CatBody pose={pose} fill={fill} shade={shade} />
          </g>
        </g>
        <Overlay state={state} />
      </g>
    </svg>
  );
}

/** `<Critter agent={a} />` — state comes from the agent unless `state` says otherwise; `pose` overrides the state's pose. */
export const Critter = memo(function Critter({ agent, task, look, colorKey, state, pose, size = 28, flip, labelled, className }: Props) {
  const name = look?.name ?? agent?.name ?? "";
  const role = look?.role ?? agent?.role ?? "worker";
  const st = state ?? look?.state ?? (agent ? critterState(agent, task) : "idle");
  return (
    <CritterSvg
      name={name}
      role={role}
      state={st}
      pose={pose ?? POSE_OF[st]}
      size={size}
      flip={flip}
      label={labelled ? `${name} · ${STATE_WORD[st]}` : undefined}
      className={className}
      colorKey={colorKey}
    />
  );
});
