// Feelings on the pixel cat: the eyes (and cheeks) on its face, and a small sign over its head.
//   plain   · ·          happy   · · with pink cheeks     sleepy  - -
//   gloom   - - and blue lines over the forehead            tears   · · with blue streams
//   squint  > <  with pink cheeks                           blush   pink hatching on the cheeks
//   angry   \ / and a red 💢 mark                           note    ♪
//   heart   ♥ over the head, pink cheeks                     wow     ◇ ◇ sparkling eyes
//   notes   ♫                                               ask     ? over the head, eyes wide

export type { Ink };
export type Feel = "plain" | "happy" | "sleepy" | "gloom" | "tears" | "squint" | "blush" | "angry" | "note" | "heart" | "wow" | "notes" | "ask";
export const FEELS: Feel[] = ["happy", "gloom", "sleepy", "plain", "tears", "squint", "blush", "angry", "note", "heart", "wow", "notes", "ask"];

/** a dot: x, y relative to an anchor, and a colour key */
type Dot = [number, number, Ink];
type Ink = "line" | "eye" | "blush" | "blue" | "red" | "heart" | "white";
export const INK: Record<Exclude<Ink, "line" | "eye">, string> = { blush: "#f2a3ae", blue: "#8cc4dc", red: "#e0525e", heart: "#ef8aa4", white: "#ffffff" };

/** eyes: dots relative to each eye's top dot */
const EYES: Record<string, Dot[]> = {
  dot: [[0, 0, "eye"], [0, 1, "eye"]],
  shut: [[-1, 1, "line"], [0, 1, "line"], [1, 1, "line"]],
  wide: [[0, 0, "eye"], [0, 1, "eye"], [1, 0, "white"]],
  // ◇: a little diamond
  sparkle: [[0, -1, "line"], [-1, 0, "line"], [1, 0, "line"], [0, 1, "line"]],
};
/** > for the left eye, < for the right */
const SQUINT_L: Dot[] = [[-1, -1, "line"], [0, 0, "line"], [-1, 1, "line"]];
const SQUINT_R: Dot[] = [[1, -1, "line"], [0, 0, "line"], [1, 1, "line"]];
const ANGRY_L: Dot[] = [[-1, 0, "line"], [0, 1, "line"]];
const ANGRY_R: Dot[] = [[1, 0, "line"], [0, 1, "line"]];

/** signs over the head, drawn from their top-left dot */
const SIGN = (rows: string[], ink: Ink): Dot[] => rows.flatMap((r, y) => [...r].flatMap((c, x) => (c === "#" ? [[x, y, ink] as Dot] : [])));
const SIGNS: Partial<Record<Feel, Dot[]>> = {
  note: SIGN(["..##", "..#.", "..#.", "###.", "###."], "line"),
  notes: SIGN([".####", ".#..#", ".#..#", "##.##", "##.##"], "line"),
  heart: SIGN([".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."], "heart"),
  angry: SIGN([".#.#.", "##.##", ".....", "##.##", ".#.#."], "red"),
  gloom: SIGN(["#.#.#", "#.#.#", "#.#.#", "#.#.#", "..#.."], "blue"),
  ask: SIGN([".###.", "#...#", "...#.", "..#..", ".....", "..#.."], "line"),
  wow: SIGN(["#", "#", "#", ".", "#"], "line"),
};

export interface FaceSpot {
  eyes: [number, number];
  eyeY: number;
  nose: [number, number];
  look?: -1 | 0 | 1;
}

/** the dots a feeling puts on a front-facing face, and its sign beside the head (`top`, `right`) */
export function faceDots(feel: Feel, f: FaceSpot | undefined, side: { eye: [number, number] } | undefined, asleep: boolean, top: number, right: number): [number, number, Ink][] {
  const out: [number, number, Ink][] = [];
  const put = (ax: number, ay: number, dots: Dot[]) => dots.forEach(([x, y, c]) => out.push([ax + x, ay + y, c]));
  if (f && !asleep) {
    const [lx, rx] = f.eyes;
    const ey = f.eyeY;
    const dx = f.look ?? 0;
    switch (feel) {
      case "sleepy":
      case "gloom":
        put(lx, ey, EYES.shut);
        put(rx, ey, EYES.shut);
        break;
      case "squint":
        put(lx, ey, SQUINT_L);
        put(rx, ey, SQUINT_R);
        break;
      case "angry":
        put(lx, ey, ANGRY_L);
        put(rx, ey, ANGRY_R);
        break;
      case "wow":
        put(lx, ey + 1, EYES.sparkle);
        put(rx, ey + 1, EYES.sparkle);
        break;
      case "ask":
        put(lx, ey, EYES.wide);
        put(rx, ey, EYES.wide);
        break;
      default:
        put(lx + dx, ey, EYES.dot);
        put(rx + dx, ey, EYES.dot);
    }
    if (feel === "tears")
      for (let y = 2; y < 8; y++) {
        out.push([lx, ey + y, "blue"]);
        out.push([rx, ey + y, "blue"]);
      }
    if (feel === "happy" || feel === "squint" || feel === "heart") {
      out.push([lx - 2, ey + 2, "blush"], [lx - 1, ey + 2, "blush"], [rx + 1, ey + 2, "blush"], [rx + 2, ey + 2, "blush"]);
    }
    if (feel === "blush")
      for (const cx of [lx - 2, rx - 1]) for (let i = 0; i < 4; i++) out.push([cx + i, ey + 3 - (i % 2), "blush"]);
    out.push([f.nose[0], f.nose[1], "blush"]);
  } else if (side && !asleep) {
    const [x, y] = side.eye;
    if (feel === "sleepy" || feel === "gloom") out.push([x - 1, y + 1, "line"], [x, y + 1, "line"]);
    else out.push([x, y, "eye"], [x, y + 1, "eye"]);
  }
  const sign = SIGNS[feel];
  if (sign) {
    // a heart floats in the middle over the head; the other signs by its top right
    const w = Math.max(...sign.map((d) => d[0])) + 1;
    const h = Math.max(...sign.map((d) => d[1])) + 1;
    const x = feel === "heart" && f ? Math.round((f.eyes[0] + f.eyes[1]) / 2 - w / 2 + 0.5) : Math.min(right, 24 - w);
    put(x, Math.max(0, top - h - 1), sign);
  }
  return out;
}
