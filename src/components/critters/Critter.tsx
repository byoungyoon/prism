// A little teammate: a pixel cat (pixel/). The pose picks the motion — a row of its sprite sheet,
// played with CSS steps — the state its feeling (face and the sign over its head), the name (or
// colorKey) its coat. No role props: a role shows as its name tag.
import { memo, useEffect, useState, type CSSProperties } from "react";
import type { Agent, Role, Task } from "../../lib/api";
import { FH, FW, K, type Row } from "./pixel/art";
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

/** sprite strips already decoded, ready to paint at once */
const decoded = new Set<string>();

/**
 * The strip to show: `url` once the browser has decoded it, the last decoded one until then.
 * (A cat's picture changes with its state — at work, asking, done. Swapped in before it was decoded,
 * the app's web view (WebKit) sometimes painted the cat's layer empty and never repainted it: a cat
 * at its desk vanished until something redrew the whole screen, like going to another tab.)
 */
function useDecoded(url: string, n: number, ms: number): { url: string; n: number; ms: number } {
  const want = { url, n, ms };
  const [shown, setShown] = useState(want);
  const ready = !url || decoded.has(url);
  useEffect(() => {
    if (ready) {
      if (shown.url !== url || shown.n !== n || shown.ms !== ms) setShown({ url, n, ms });
      return;
    }
    let live = true;
    const img = new Image();
    img.src = url;
    const done = () => {
      decoded.add(url);
      if (live) setShown({ url, n, ms });
    };
    img.decode().then(done, done);
    return () => {
      live = false;
    };
  }, [url, n, ms, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return ready ? want : shown;
}

function PixelCat({ name, role, state, pose, size, flip, dir, label, className, colorKey }: CritterLook & { pose: Pose; size: number; flip?: boolean; dir?: WalkDir; label?: string; className?: string; colorKey?: string }) {
  const coat = coatOf(colorKey ?? name, role);
  const m = MOTION[pose];
  const row: Row = pose === "walk" ? (dir ?? "side") : m.row;
  const feel = feelOf(state, name);
  const { url, n, ms } = useDecoded(strip(coat, row, m.frames, feel), m.frames.length, m.ms);
  // whole pixels only: each dot of the drawing is s × s screen pixels. `size` is how tall the cat
  // should look; the drawn cat is about 20 of the frame's FH dots (the rest is room for the signs)
  const s = Math.max(1, Math.round(size / 20));
  const style: CSSProperties = {
    width: FW * s,
    height: FH * s,
    backgroundImage: `url(${url})`,
    backgroundSize: `${n * 100}% 100%`,
    animationDuration: `${ms}ms`,
    // the strip has K dots per drawing dot, so it shows at s / K screen pixels per dot. Only a whole
    // multiple (s = K: 1:1) can stay hard-edged; any other size (s = 1 is half, s = 3 is 1.5) averages
    // instead, or the dots of the fine drawing drop out unevenly
    imageRendering: s % K === 0 ? "pixelated" : "auto",
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
