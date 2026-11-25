// A round little teammate: a cute cat (public/critters/kawaii-cat.svg, CC0 — see LICENSE-kawaii-cat.md).
// Role picks the prop on top (총괄: headset, 팀장: clipboard + bow tie, 작업자: hard hat + mallet), the name
// picks the color (a hue shift of the cat), the state picks the motion and the bubble (critters.css).
import { memo } from "react";
import type { Agent, Role, Task } from "../../lib/api";
import { colorOf, critterState, STATE_WORD, type CritterState } from "./state";
import "./critters.css";

/** the cat's own orange, as a hue (degrees): a body colour from PALETTE is shifted from it */
const BASE_HUE = 35;
const CAT_SRC = "/critters/kawaii-cat.svg";

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

/** hue in degrees of a "#rrggbb" colour */
function hueOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function Headset() {
  return (
    <g className="cr-prop">
      <path d="M11.6 19 C11.6 4.6 36.4 4.6 36.4 19" fill="none" stroke="#3b4257" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="8.6" y="16.4" width="5" height="8" rx="2.3" fill="#3b4257" />
      <rect x="34.4" y="16.4" width="5" height="8" rx="2.3" fill="#3b4257" />
      <path d="M10.9 24 Q11.6 30.4 17.6 30.8" fill="none" stroke="#3b4257" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="18" cy="30.8" r="1.4" fill="#3b4257" />
      <circle className="cr-beacon" cx="24" cy="6.6" r="1.3" fill="#f0a35a" />
    </g>
  );
}

function HardHat() {
  return (
    <g className="cr-prop">
      <path d="M16.2 11.4 C16.2 4.4 31.8 4.4 31.8 11.4 Z" fill="#f2b84b" />
      <path d="M24 5.6 L24 10.2" stroke="#d99a2b" strokeWidth="1.3" strokeLinecap="round" />
      <rect x="14.2" y="10" width="19.6" height="2.4" rx="1.2" fill="#e2a43a" />
    </g>
  );
}

function BowTie() {
  return (
    <g className="cr-prop">
      <path d="M24 29.6 L20.6 27.6 L20.6 31.6 Z M24 29.6 L27.4 27.6 L27.4 31.6 Z" fill="#d9725f" />
      <circle cx="24" cy="29.6" r="1.1" fill="#b85a48" />
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
  const [fill] = colorOf(colorKey ?? name, role);
  const shift = (hueOf(fill) - BASE_HUE + 360) % 360;
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
          <g className="cr-body">
            <image
              href={CAT_SRC}
              x="0"
              y="0"
              width="48"
              height="48"
              preserveAspectRatio="xMidYMid meet"
              style={{ filter: `hue-rotate(${shift}deg)` }}
            />
            {role === "lead" && <Headset />}
            {role === "worker" && <HardHat />}
            {role === "mgr" && <BowTie />}
          </g>
          {role === "mgr" && <Clipboard />}
          {role === "worker" && <Mallet />}
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
