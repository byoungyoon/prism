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
      <path d="M12.6 24 C12.6 9.6 35.4 9.6 35.4 24" fill="none" stroke="#3b4257" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="9.3" y="21.5" width="5.4" height="8" rx="2.4" fill="#3b4257" />
      <rect x="33.3" y="21.5" width="5.4" height="8" rx="2.4" fill="#3b4257" />
      <path d="M11.8 29 Q12.6 35.6 19.2 35.8" fill="none" stroke="#3b4257" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="19.8" cy="35.8" r="1.5" fill="#3b4257" />
      <circle className="cr-beacon" cx="24" cy="12.4" r="1.4" fill="#f0a35a" />
    </g>
  );
}

function HardHat() {
  return (
    <g className="cr-prop">
      <path d="M16.4 19 C16.4 11.6 31.6 11.6 31.6 19 Z" fill="#f2b84b" />
      <path d="M24 12.6 L24 18.4" stroke="#d99a2b" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="14.4" y="17.8" width="19.2" height="2.6" rx="1.3" fill="#e2a43a" />
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

function Face({ state, shade }: { state: CritterState; shade: string }) {
  const sleepy = state === "off";
  const sad = state === "fail";
  const happy = state === "done";
  return (
    <g className="cr-face">
      {/* whiskers */}
      <path d="M14.6 30.4 L8.6 29.2 M14.6 32.2 L8.8 33 M33.4 30.4 L39.4 29.2 M33.4 32.2 L39.2 33" stroke={shade} strokeWidth="0.75" strokeLinecap="round" opacity="0.8" />
      {sleepy ? (
        <path d="M17.2 27.4 Q19.3 29 21.4 27.4 M26.6 27.4 Q28.7 29 30.8 27.4" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
      ) : happy ? (
        <path d="M17.2 28 Q19.3 25.2 21.4 28 M26.6 28 Q28.7 25.2 30.8 28" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        <g className="cr-eyes">
          <ellipse cx="19.3" cy="27" rx="2.5" ry="2.7" fill={INK} />
          <ellipse cx="28.7" cy="27" rx="2.5" ry="2.7" fill={INK} />
          <circle cx="20.2" cy="25.9" r="0.95" fill="#fff" />
          <circle cx="29.6" cy="25.9" r="0.95" fill="#fff" />
          <circle cx="18.6" cy="28.1" r="0.45" fill="#fff" opacity="0.8" />
          <circle cx="28" cy="28.1" r="0.45" fill="#fff" opacity="0.8" />
          {sad && <path d="M16.6 24 Q18.8 23.8 20.8 22.6 M31.4 24 Q29.2 23.8 27.2 22.6" stroke={INK} strokeWidth="1.1" strokeLinecap="round" fill="none" />}
        </g>
      )}
      <ellipse cx="15.2" cy="31.6" rx="2.3" ry="1.3" fill="#f08a7a" opacity={sad ? 0.25 : 0.5} />
      <ellipse cx="32.8" cy="31.6" rx="2.3" ry="1.3" fill="#f08a7a" opacity={sad ? 0.25 : 0.5} />
      {/* nose */}
      <path d="M22.9 29.9 L25.1 29.9 L24 31.1 Z" fill="#e98a9a" />
      {sad ? (
        <path d="M22.2 33.2 Q24 31.8 25.8 33.2" fill="none" stroke={INK} strokeWidth="1.1" strokeLinecap="round" />
      ) : state === "block" || state === "think" ? (
        <ellipse cx="24" cy="32.6" rx="0.9" ry="1" fill={INK} />
      ) : (
        <path d="M21.9 31.6 Q23 33 24 31.4 Q25 33 26.1 31.6" fill="none" stroke={INK} strokeWidth="1" strokeLinecap="round" />
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
          {/* tail, behind everything: it swishes */}
          <g className="cr-tail">
            <path d="M33.6 39.4 C41.4 40 44.6 34 42.6 27.6" fill="none" stroke={shade} strokeWidth="4.6" strokeLinecap="round" />
            <path d="M33.6 39.4 C41.4 40 44.6 34 42.6 27.6" fill="none" stroke={fill} strokeWidth="3" strokeLinecap="round" />
          </g>
          <ellipse className="cr-foot cr-foot-l" cx="18.4" cy="42.4" rx="4" ry="2.4" fill={shade} />
          <ellipse className="cr-foot cr-foot-r" cx="29.6" cy="42.4" rx="4" ry="2.4" fill={shade} />
          <g className="cr-body">
            {/* ears, under the head's outline */}
            <path d="M11.4 22.6 L12.6 10.4 Q13.1 9 14.4 9.8 L22.2 15.4 Z" fill={fill} stroke={shade} strokeWidth="1.1" strokeLinejoin="round" />
            <path d="M36.6 22.6 L35.4 10.4 Q34.9 9 33.6 9.8 L25.8 15.4 Z" fill={fill} stroke={shade} strokeWidth="1.1" strokeLinejoin="round" />
            <path d="M13.6 18.6 L14.3 12.4 L19 15.8 Z" fill="#f4a9b3" opacity="0.85" />
            <path d="M34.4 18.6 L33.7 12.4 L29 15.8 Z" fill="#f4a9b3" opacity="0.85" />
            <path d="M24 14.2 C33.4 14.2 38.2 21 38.2 29 C38.2 37.2 32.2 42.4 24 42.4 C15.8 42.4 9.8 37.2 9.8 29 C9.8 21 14.6 14.2 24 14.2 Z" fill={fill} stroke={shade} strokeWidth="1.1" />
            <ellipse cx="24" cy="36" rx="7.6" ry="5" fill="#fff" opacity="0.32" />
            {/* tabby stripes on the forehead */}
            {role !== "worker" && <path d="M21.6 16.4 L22 19 M24 15.8 L24 19.4 M26.4 16.4 L26 19" stroke={shade} strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />}
            <Face state={state} shade={shade} />
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
