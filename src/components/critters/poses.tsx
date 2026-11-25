// The teammate's body, drawn in code: one cat (big eyes, round head, soft pastel body) in several poses.
// Everything sits in a 48×48 box. No texture or spots — it has to stay clean when it is 24px tall.
// Classes cr-arm-l / cr-arm-r / cr-foot-l / cr-foot-r let critters.css swing the limbs while walking.
import type { ReactNode } from "react";
import type { Pose } from "./state";

const INK = "#2b2520";
const PINK = "#f08a7a";

interface Colors {
  fill: string;
  shade: string;
}

type Eyes = "open" | "happy" | "closed" | "sad";
type Mouth = "w" | "open" | "frown" | "none";

function Eye({ kind, cx }: { kind: Eyes; cx: number }) {
  const mirror = cx > 24;
  if (kind === "happy") return <path d={`M${cx - 2.4} 20.4 Q${cx} 17.2 ${cx + 2.4} 20.4`} fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />;
  if (kind === "closed") return <path d={`M${cx - 2.4} 20 Q${cx} 22.2 ${cx + 2.4} 20`} fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />;
  return (
    <g>
      <ellipse cx={cx} cy="19.4" rx="2.2" ry="2.6" fill={INK} />
      <circle cx={cx + 0.7} cy="18.2" r="0.8" fill="#fff" />
      <circle cx={cx - 0.9} cy="20.6" r="0.4" fill="#fff" opacity="0.85" />
      {kind === "sad" && <path d={mirror ? "M31.4 15.8 L26.4 17" : "M16.6 15.8 L21.6 17"} stroke={INK} strokeWidth="1" strokeLinecap="round" />}
    </g>
  );
}

/** ears + head, centred on (24, 19); a parent group moves it (sleep) */
function Head({ c, eyes = "open", mouth = "w", sad = false }: { c: Colors; eyes?: Eyes; mouth?: Mouth; sad?: boolean }) {
  return (
    <g>
      <path d="M13.4 13.6 L13.2 4.8 Q13.2 3.4 14.5 4.2 L21.8 9.6 Z" fill={c.fill} stroke={c.shade} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M34.6 13.6 L34.8 4.8 Q34.8 3.4 33.5 4.2 L26.2 9.6 Z" fill={c.fill} stroke={c.shade} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M14.6 12.4 L14.7 7.6 L18.4 10.2 Z M33.4 12.4 L33.3 7.6 L29.6 10.2 Z" fill="#f4a9b3" opacity="0.85" />
      <circle cx="24" cy="19" r="11.2" fill={c.fill} stroke={c.shade} strokeWidth="1.1" />
      <ellipse cx="16.4" cy="23.4" rx="2" ry="1.2" fill={PINK} opacity={sad ? 0.22 : 0.45} />
      <ellipse cx="31.6" cy="23.4" rx="2" ry="1.2" fill={PINK} opacity={sad ? 0.22 : 0.45} />
      <Eye kind={eyes} cx={19.6} />
      <Eye kind={eyes} cx={28.4} />
      <path d="M22.9 22 L25.1 22 L24 23.2 Z" fill="#e98a9a" />
      {mouth === "w" && <path d="M22.2 24.2 Q23.1 25.4 24 24.4 Q24.9 25.4 25.8 24.2" fill="none" stroke={INK} strokeWidth="0.9" strokeLinecap="round" />}
      {mouth === "open" && <ellipse cx="24" cy="25.2" rx="1.1" ry="1.3" fill={INK} />}
      {mouth === "frown" && <path d="M22.4 25.4 Q24 24 25.6 25.4" fill="none" stroke={INK} strokeWidth="0.9" strokeLinecap="round" />}
    </g>
  );
}

/** a rounded body with a soft belly (no spots) */
function Body({ c, cx, cy, rx, ry }: { c: Colors; cx: number; cy: number; rx: number; ry: number }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={c.fill} stroke={c.shade} strokeWidth="1.1" />
      <ellipse cx={cx} cy={cy + 2.2} rx={rx * 0.56} ry={ry * 0.55} fill="#fff" opacity="0.35" />
    </g>
  );
}

function Tail({ c, d }: { c: Colors; d: string }) {
  return (
    <g className="cr-tail">
      <path d={d} fill="none" stroke={c.shade} strokeWidth="4.4" strokeLinecap="round" />
      <path d={d} fill="none" stroke={c.fill} strokeWidth="2.6" strokeLinecap="round" />
    </g>
  );
}

/** a paw / arm ellipse */
function Arm({ c, cx, cy, rx = 2.5, ry = 3.5, rotate, cls }: { c: Colors; cx: number; cy: number; rx?: number; ry?: number; rotate?: number; cls?: string }) {
  return <ellipse className={cls} cx={cx} cy={cy} rx={rx} ry={ry} fill={c.fill} stroke={c.shade} strokeWidth="1" transform={rotate ? `rotate(${rotate} ${cx} ${cy})` : undefined} />;
}

/** sitting, front view: the base of most poses */
function Sitting({ c, eyes, mouth, sad, children }: { c: Colors; eyes?: Eyes; mouth?: Mouth; sad?: boolean; children?: ReactNode }) {
  return (
    <g>
      <Tail c={c} d="M32.6 40.4 C40.6 40.8 43 34.6 41 28.6" />
      <ellipse className="cr-foot cr-foot-l" cx="19.4" cy="42.2" rx="3.6" ry="2" fill={c.shade} />
      <ellipse className="cr-foot cr-foot-r" cx="28.6" cy="42.2" rx="3.6" ry="2" fill={c.shade} />
      <Body c={c} cx={24} cy={34} rx={10.6} ry={9} />
      {children}
      <Head c={c} eyes={eyes} mouth={mouth} sad={sad} />
    </g>
  );
}

/** Draws one teammate body in the given pose. `c` = [fill, shade] from the palette. */
export function CatBody({ pose, fill, shade }: { pose: Pose } & Colors) {
  const c = { fill, shade };
  switch (pose) {
    case "type":
      // paws on the keyboard, screen behind (laptop base in front of the paws)
      return (
        <g>
          <rect x="30.4" y="17.4" width="15.4" height="14.4" rx="1.8" fill="#5b6275" />
          <rect x="32" y="19" width="12.2" height="11.2" rx="0.9" fill="#d6ecf7" />
          <path d="M34.4 23.4 H41.8 M34.4 25.8 H40 M34.4 28.2 H38.4" stroke="#8fb6d6" strokeWidth="0.8" strokeLinecap="round" />
          <Sitting c={c} eyes="open" mouth="w">
            <Arm c={c} cx={19.2} cy={38.4} rx={2.8} ry={2.1} />
            <Arm c={c} cx={28.8} cy={38.4} rx={2.8} ry={2.1} />
          </Sitting>
          <rect x="8.2" y="38.8" width="31.6" height="2.8" rx="1.3" fill="#5b6275" />
        </g>
      );
    case "think":
      return (
        <Sitting c={c} eyes="open" mouth="none">
          <Arm c={c} cx={33.4} cy={27} rx={2.4} ry={2.8} />
        </Sitting>
      );
    case "coffee":
      return (
        <Sitting c={c} eyes="happy" mouth="w">
          <path d="M39.4 33.4 Q43.2 33.4 43.2 36.4 Q43.2 39.4 39.4 39.4" fill="none" stroke={c.shade} strokeWidth="1.2" />
          <rect x="33" y="31.4" width="7.6" height="8.6" rx="1.8" fill="#fffaf2" stroke="#b9ad9e" strokeWidth="0.9" />
          <ellipse cx="36.8" cy="31.8" rx="3.2" ry="0.8" fill="#a0673c" />
          <path d="M35.2 28 q-1.2 -1.6 0 -3.2 q1.2 -1.6 0 -3.2" fill="none" stroke="#b9ad9e" strokeWidth="0.9" strokeLinecap="round" opacity="0.8" />
          <Arm c={c} cx={33.6} cy={36.4} rx={2.2} ry={2.4} />
        </Sitting>
      );
    case "sleep":
      // curled up, head resting on the paws
      return (
        <g>
          <Tail c={c} d="M38.4 40.2 C45.2 40.6 45.8 34 41.2 33" />
          <Body c={c} cx={25} cy={37} rx={15} ry={6.8} />
          <Arm c={c} cx={12.6} cy={40.4} rx={3} ry={1.6} />
          <g transform="translate(-8.4 13.4)">
            <Head c={c} eyes="closed" mouth="w" />
          </g>
        </g>
      );
    case "walk":
      // standing, front view; legs and arms are swung by critters.css (cr-walk)
      return (
        <g>
          <Tail c={c} d="M31.4 38.6 C38.4 38.4 40.6 33 39.4 26.4" />
          <ellipse className="cr-foot cr-foot-l" cx="20" cy="41.8" rx="3.4" ry="2" fill={c.shade} />
          <ellipse className="cr-foot cr-foot-r" cx="28" cy="41.8" rx="3.4" ry="2" fill={c.shade} />
          <Body c={c} cx={24} cy={32} rx={9} ry={10} />
          <Arm c={c} cx={14.6} cy={32} rx={2.4} ry={3.4} cls="cr-arm cr-arm-l" />
          <Arm c={c} cx={33.4} cy={32} rx={2.4} ry={3.4} cls="cr-arm cr-arm-r" />
          <Head c={c} eyes="open" mouth="w" />
        </g>
      );
    case "cheer":
      return (
        <Sitting c={c} eyes="happy" mouth="open">
          <Arm c={c} cx={11.6} cy={23} rx={2.5} ry={4.2} rotate={-28} />
          <Arm c={c} cx={36.4} cy={23} rx={2.5} ry={4.2} rotate={28} />
        </Sitting>
      );
    case "raise":
      // one paw up for a question
      return (
        <Sitting c={c} eyes="open" mouth="w">
          <Arm c={c} cx={37.4} cy={15.6} rx={2.5} ry={4.4} rotate={18} />
        </Sitting>
      );
    case "sad":
      return <Sitting c={c} eyes="sad" mouth="frown" sad />;
    case "sit":
    default:
      return <Sitting c={c} eyes="open" mouth="w" />;
  }
}
