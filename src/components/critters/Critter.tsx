// A round little teammate drawn in SVG. Role picks the prop (총괄: headset, 팀장: clipboard + bow tie,
// 작업자: hard hat + mallet), the name picks the color, the state picks the motion (critters.css).
import { memo } from "react";
import type { Agent, Role, Task } from "../../lib/api";
import { colorOf, critterState, STATE_WORD, type CritterState } from "./state";
import "./critters.css";

const INK = "#2b2520";

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
  /** height in px */
  size?: number;
  /** face left (walking back) */
  flip?: boolean;
  /** decorative next to a text label (default): hidden from screen readers */
  labelled?: boolean;
  className?: string;
}

function Headset() {
  return (
    <g className="cr-prop">
      <path d="M12.6 24 C12.6 11.2 35.4 11.2 35.4 24" fill="none" stroke="#3b4257" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="9.3" y="21.5" width="5.4" height="8" rx="2.4" fill="#3b4257" />
      <rect x="33.3" y="21.5" width="5.4" height="8" rx="2.4" fill="#3b4257" />
      <path d="M11.8 29 Q12.6 35.6 19.2 35.8" fill="none" stroke="#3b4257" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="19.8" cy="35.8" r="1.5" fill="#3b4257" />
      <circle className="cr-beacon" cx="24" cy="13.6" r="1.4" fill="#f0a35a" />
    </g>
  );
}

function HardHat() {
  return (
    <g className="cr-prop">
      <path d="M13.2 21.2 C13.2 11.6 34.8 11.6 34.8 21.2 Z" fill="#f2b84b" />
      <path d="M24 13 L24 20.6" stroke="#d99a2b" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="10.6" y="19.8" width="26.8" height="3" rx="1.5" fill="#e2a43a" />
    </g>
  );
}

function BowTie() {
  return (
    <g className="cr-prop">
      <path d="M24 37.6 L20.4 35.6 L20.4 39.6 Z M24 37.6 L27.6 35.6 L27.6 39.6 Z" fill="#d9725f" />
      <circle cx="24" cy="37.6" r="1.1" fill="#b85a48" />
    </g>
  );
}

function Clipboard() {
  return (
    <g className="cr-clip">
      <rect x="31.2" y="27.6" width="10.4" height="12.6" rx="1.6" fill="#c99a63" />
      <rect x="32.6" y="29.8" width="7.6" height="9" rx="0.8" fill="#fffaf2" />
      <path d="M34 32.2 H38.8 M34 34.4 H38.8 M34 36.6 H37" stroke="#b9ad9e" strokeWidth="0.9" strokeLinecap="round" />
      <rect x="34.2" y="26.6" width="4.4" height="2.6" rx="0.9" fill="#8a8f9a" />
    </g>
  );
}

/** a tiny mallet held up in the right hand */
function Mallet() {
  return (
    <g className="cr-tool">
      <g transform="translate(38 32) rotate(28)">
        <rect x="-1.1" y="-11" width="2.2" height="11.4" rx="1.1" fill="#b98552" />
        <rect x="-4.4" y="-15" width="8.8" height="5" rx="1.6" fill="#8d97a6" />
        <rect x="-4.4" y="-15" width="2.4" height="5" rx="1" fill="#a9b2bf" />
      </g>
    </g>
  );
}

function Face({ state }: { state: CritterState }) {
  const sleepy = state === "off";
  const sad = state === "fail";
  const happy = state === "done";
  return (
    <g className="cr-face">
      {sleepy ? (
        <path d="M17.6 27.4 Q19.5 28.8 21.4 27.4 M26.6 27.4 Q28.5 28.8 30.4 27.4" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
      ) : happy ? (
        <path d="M17.6 28 Q19.5 25.6 21.4 28 M26.6 28 Q28.5 25.6 30.4 28" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        <g className="cr-eyes">
          <circle cx="19.5" cy="27" r="2" fill={INK} />
          <circle cx="28.5" cy="27" r="2" fill={INK} />
          <circle cx="20.2" cy="26.2" r="0.7" fill="#fff" />
          <circle cx="29.2" cy="26.2" r="0.7" fill="#fff" />
          {sad && <path d="M17.2 24.6 Q19.4 24.4 21.2 23.2 M30.8 24.6 Q28.6 24.4 26.8 23.2" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />}
        </g>
      )}
      <ellipse cx="15.6" cy="31" rx="2.4" ry="1.4" fill="#f08a7a" opacity={sad ? 0.25 : 0.55} />
      <ellipse cx="32.4" cy="31" rx="2.4" ry="1.4" fill="#f08a7a" opacity={sad ? 0.25 : 0.55} />
      {sad ? (
        <path d="M22.4 32.8 Q24 31.4 25.6 32.8" fill="none" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      ) : state === "block" || state === "think" ? (
        <circle cx="24" cy="32" r="0.95" fill={INK} />
      ) : (
        <path d="M22.4 31.2 Q24 33 25.6 31.2" fill="none" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
      )}
    </g>
  );
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
        <g className="cr-desk">
          <rect x="14" y="37.4" width="20" height="4.6" rx="1.6" fill="#5b6275" />
          <path d="M16.6 39.7 H31.4" stroke="#8d95aa" strokeWidth="1.2" strokeDasharray="1.6 1" />
          <path className="cr-tap" d="M12 33 L10 31.6 M12.4 30.6 L10.6 28.6 M36 33 L38 31.6 M35.6 30.6 L37.4 28.6" stroke="var(--text2)" strokeWidth="0.9" strokeLinecap="round" />
        </g>
      );
    default:
      return null;
  }
}

function CritterSvg({ name, role, state, size, flip, label, className, colorKey }: CritterLook & { size: number; flip?: boolean; label?: string; className?: string; colorKey?: string }) {
  const [fill, shade] = colorOf(colorKey ?? name, role);
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={`critter cr-${state} cr-r-${role}${className ? ` ${className}` : ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <g className={flip ? "cr-flip" : undefined}>
        <ellipse className="cr-shadow" cx="24" cy="44" rx="12" ry="2" fill="#000" opacity="0.12" />
        <g className="cr-whole">
          <ellipse className="cr-foot cr-foot-l" cx="18.4" cy="42.4" rx="4" ry="2.4" fill={shade} />
          <ellipse className="cr-foot cr-foot-r" cx="29.6" cy="42.4" rx="4" ry="2.4" fill={shade} />
          <g className="cr-body">
            <path d="M24 14.2 C33.4 14.2 38.2 21 38.2 29 C38.2 37.2 32.2 42.4 24 42.4 C15.8 42.4 9.8 37.2 9.8 29 C9.8 21 14.6 14.2 24 14.2 Z" fill={fill} stroke={shade} strokeWidth="1.1" />
            <ellipse cx="24" cy="35" rx="8" ry="5.4" fill="#fff" opacity="0.28" />
            {role !== "worker" && <path className="cr-sprout" d="M24 14.6 C23.4 11.6 21 10.4 19.4 10.8 C20.2 12.6 21.8 13.8 24 14.6 Z" fill={shade} />}
            <Face state={state} />
            {role === "lead" && <Headset />}
            {role === "worker" && <HardHat />}
            {role === "mgr" && <BowTie />}
          </g>
          <ellipse className="cr-arm cr-arm-l" cx="10.4" cy="32" rx="2.7" ry="3.6" fill={fill} stroke={shade} strokeWidth="1" />
          {role === "mgr" && <Clipboard />}
          {role === "worker" && <Mallet />}
          <ellipse className="cr-arm cr-arm-r" cx="37.6" cy="32" rx="2.7" ry="3.6" fill={fill} stroke={shade} strokeWidth="1" />
        </g>
        <Overlay state={state} />
      </g>
    </svg>
  );
}

/** `<Critter agent={a} />` — state comes from the agent unless `state` says otherwise. */
export const Critter = memo(function Critter({ agent, task, look, colorKey, state, size = 28, flip, labelled, className }: Props) {
  const name = look?.name ?? agent?.name ?? "";
  const role = look?.role ?? agent?.role ?? "worker";
  const st = state ?? look?.state ?? (agent ? critterState(agent, task) : "idle");
  return <CritterSvg name={name} role={role} state={st} size={size} flip={flip} label={labelled ? `${name} · ${STATE_WORD[st]}` : undefined} className={className} colorKey={colorKey} />;
});
