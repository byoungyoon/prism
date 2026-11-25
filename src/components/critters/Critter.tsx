// A little teammate: a pixel cat (pixel/). The pose picks the motion — a row of its sprite sheet,
// played with CSS steps — the state its feeling (face and the sign over its head), the name (or
// colorKey) its coat. No role props: a role shows as its name tag.
import { memo, type CSSProperties } from "react";
import type { Agent, Role, Task } from "../../lib/api";
import { FH, FW, type Row } from "./pixel/art";
import { coatOf } from "./pixel/coats";
import type { Feel } from "./pixel/faces";
import { strip } from "./pixel/render";
import { critterState, POSE_OF, STATE_WORD, type CritterState, type Pose } from "./state";
import "./critters.css";

/** which way a walking cat is seen */
export type WalkDir = "front" | "back" | "side";

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
  /** which way it walks: toward you, away, or sideways (`flip` for left) */
  dir?: WalkDir;
  /** decorative next to a text label (default): hidden from screen readers */
  labelled?: boolean;
  className?: string;
}

/** what each pose plays: a row of the sprite sheet, which of its frames, and how long one round takes */
const MOTION: Record<Pose, { row: Row; frames: number[]; ms: number }> = {
  walk: { row: "side", frames: [0, 1, 2, 3], ms: 560 },
  type: { row: "sit", frames: [2, 3], ms: 2600 },
  think: { row: "look", frames: [0, 1, 2, 3], ms: 5200 },
  raise: { row: "sit", frames: [2, 3], ms: 1400 },
  sad: { row: "sit", frames: [2, 3], ms: 3200 },
  cheer: { row: "sit", frames: [2, 3], ms: 1200 },
  sit: { row: "look", frames: [0, 1, 2, 3], ms: 6400 },
  coffee: { row: "lie", frames: [2, 3], ms: 3000 },
  sleep: { row: "sleep", frames: [0, 1, 2, 3], ms: 3600 },
};

/** how it feels, by what it's doing: at work focused, stuck asking (?), done happy (♥ or ♫), failed in tears, resting sleepy */
function feelOf(state: CritterState, name: string): Feel {
  switch (state) {
    case "block":
      return "ask";
    case "fail":
      return "tears";
    case "done": {
      let h = 0;
      for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
      return h % 2 ? "heart" : "notes";
    }
    case "idle":
    case "off":
      return "sleepy";
    default:
      return "plain";
  }
}

function PixelCat({ name, role, state, pose, size, flip, dir, label, className, colorKey }: CritterLook & { pose: Pose; size: number; flip?: boolean; dir?: WalkDir; label?: string; className?: string; colorKey?: string }) {
  const coat = coatOf(colorKey ?? name, role);
  const m = MOTION[pose];
  const row: Row = pose === "walk" ? (dir ?? "side") : m.row;
  const feel = feelOf(state, name);
  const url = strip(coat, row, m.frames, feel);
  const n = m.frames.length;
  // whole pixels only: each dot of the drawing is s × s screen pixels. `size` is how tall the cat
  // should look; the drawn cat is about 20 of the frame's FH dots (the rest is room for the signs)
  const s = Math.max(1, Math.round(size / 20));
  const style: CSSProperties = {
    width: FW * s,
    height: FH * s,
    backgroundImage: `url(${url})`,
    backgroundSize: `${n * 100}% 100%`,
    animationDuration: `${m.ms}ms`,
  };
  return (
    <span
      className={`critter px-cat cr-${state} cr-pose-${pose} cr-r-${role}${className ? ` ${className}` : ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: FW * s, height: FH * s }}
    >
      <span className={`cr-whole${flip && row !== "front" && row !== "back" ? " px-flip" : ""}`}>
        <span className={`cr-body px-sprite${n > 1 ? ` px-run-${n}` : ""}`} style={style} />
      </span>
    </span>
  );
}

/** `<Critter agent={a} />` — state comes from the agent unless `state` says otherwise; `pose` overrides the state's pose. */
export const Critter = memo(function Critter({ agent, task, look, colorKey, state, pose, size = 28, flip, dir, labelled, className }: Props) {
  const name = look?.name ?? agent?.name ?? "";
  const role = look?.role ?? agent?.role ?? "worker";
  const st = state ?? look?.state ?? (agent ? critterState(agent, task) : "idle");
  return (
    <PixelCat
      name={name}
      role={role}
      state={st}
      pose={pose ?? POSE_OF[st]}
      size={size}
      flip={flip}
      dir={dir}
      label={labelled ? `${name} · ${STATE_WORD[st]}` : undefined}
      className={className}
      colorKey={colorKey}
    />
  );
});
