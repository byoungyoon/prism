// What a critter is doing, and what it looks like — derived from an agent's status and activity.
import type { Agent, Role, Task } from "../../lib/api";

export type CritterState = "idle" | "walk" | "work" | "think" | "block" | "done" | "fail" | "off";

/** the body pose drawn for each state (poses.tsx); a `pose` prop on <Critter> overrides it */
export type Pose = "sit" | "type" | "think" | "coffee" | "sleep" | "walk" | "cheer" | "raise" | "sad" | "lift";

export const POSE_OF: Record<CritterState, Pose> = {
  idle: "coffee", // 쉬는 중: coffee break
  walk: "walk",
  work: "type", // 일함: typing
  think: "think",
  block: "raise", // 허락 대기: paw up
  done: "cheer", // 완료
  fail: "sad",
  off: "sleep", // 퇴근
};

export const STATE_WORD: Record<CritterState, string> = {
  idle: "쉬는 중",
  walk: "이동 중",
  work: "작업 중",
  think: "생각 중",
  block: "도움이 필요해요",
  done: "끝냈어요",
  fail: "실패했어요",
  off: "퇴근",
};

/** Within this long of its last tool step an agent looks busy typing; after that it looks lost in thought. */
const TYPING_MS = 12_000;

/** The state an agent's critter shows. `task` (the card it holds) tells a failed one apart. */
export function critterState(a: Agent, task?: Task, now = Date.now()): CritterState {
  if (a.status === "off") return "off";
  if (a.status === "block") return "block";
  if (task?.stage === "failed") return "fail";
  if (a.status === "done") return "done";
  if (a.status === "work") {
    const last = a.activity.length ? a.activity[a.activity.length - 1].at : 0;
    return now - last < TYPING_MS ? "work" : "think";
  }
  return "idle";
}

/** One short line for the bubble over its head: what it's on right now. */
export function critterLine(a: Agent, task?: Task): string {
  if (a.status === "block") return "확인이 필요해요";
  // the card's title reads better than raw tool steps ("$ sed -n …")
  if (task) return task.title;
  if (a.status === "work" && a.thought) return a.thought;
  const last = a.activity[a.activity.length - 1]?.text;
  if (a.status === "work" && last) return last;
  return a.lastNote ?? "";
}

/** Body colors: [fill, shade]. Soft, warm-leaning pastels that sit on both the light and dark themes. */
export const PALETTE: [string, string][] = [
  ["#f6b88f", "#d48a5f"], // peach
  ["#a6dcc0", "#68ac8b"], // mint
  ["#aecdf0", "#759fcc"], // sky
  ["#c9b8ee", "#9683c9"], // lilac
  ["#f5dc85", "#c9a646"], // butter
  ["#f3aab3", "#cf7684"], // rose
  ["#c4d99a", "#8ea95f"], // sage
  ["#9fdbe0", "#5eaab1"], // aqua
  ["#f19c86", "#c86a56"], // coral
  ["#fcd6e3", "#e58fab"], // cherry blossom: pale pink body, deeper pink outline
];

/** W1, W2… get the next color in turn; other names a stable pick. The 총괄 starts on sky. */
export function colorOf(name: string, role: Role): [string, string] {
  const n = /(\d+)\s*$/.exec(name);
  const base = role === "lead" ? 2 : role === "mgr" ? 3 : 0;
  if (n) return PALETTE[(base + Number(n[1]) - 1 + PALETTE.length * 4) % PALETTE.length];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTE[(base + Math.abs(h)) % PALETTE.length];
}
