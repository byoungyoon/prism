// The pixel cat, dot by dot. Every frame is drawn straight at the fine resolution (FW·K × FH·K
// letters): soft shapes and hand-drawn parts (head), each stamped with a one-dot outline. The
// letters say what a dot is, not its colour — a coat (coats.ts) colours them, so every coat shares
// the same drawings:
//   o outline        k fur (head top, back)     w fur (cheeks, sides)    c chest / muzzle
//   p inside of ear  l paw                      t tail                   y shut eye   n nose
//   f fur of a far leg (a shade darker)         g paw of a far leg
//   . nothing
// The side walk lives in walk.ts; the other motions are here, after the same picture. A cat stands
// on the bottom rows; the space above its head is for the little signs (♪, ♥, 💢 …) in faces.ts,
// which places faces and signs in "drawing dots" (K × K fine dots each).

import { FLOOR, H, W, oval, set, sideHead, stamp, stroke, walkFrame, type Cells } from "./walk";

export const FW = 24;
export const FH = 28;
/** fine dots per drawing dot, each way */
export const K = 2;

type Grid = string[][];
const blank = (): Grid => Array.from({ length: H }, () => Array<string>(W).fill("."));

/** stamp one layer, drawn by `draw`, onto the grid */
function layer(g: Grid, draw: (c: Cells) => void) {
  const c: Cells = new Map();
  draw(c);
  stamp(g, c);
}
/** hand-drawn rows with their top left at (x, y) */
const rowsAt = (c: Cells, rows: string[], x: number, y: number) =>
  rows.forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      if (ch !== ".") set(c, x + dx, y + dy, ch);
    }),
  );
/** a rounded block, x0‥x1 × y0‥y1 (its four corner dots cut) */
function block(c: Cells, x0: number, y0: number, x1: number, y1: number, ch: (x: number, y: number) => string) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if (!((x === x0 || x === x1) && (y === y0 || y === y1))) set(c, x, y, ch(x, y));
}
/** an oval that stops at the floor (a body resting its weight on the ground) */
function resting(c: Cells, cx: number, cy: number, rx: number, ry: number, ch: (x: number, y: number) => string) {
  oval(c, cx, cy, rx, ry, ch);
  for (const key of [...c.keys()]) if (Number(key.split(",")[1]) > FLOOR) c.delete(key);
}
/** an outline-coloured line inside the fur (a leg, a thigh, a cheek tuft) */
const crease = (g: Grid, dots: [number, number][]) => {
  for (const [x, y] of dots) if (g[y]?.[x] && "kwctlp".includes(g[y][x])) g[y][x] = "o";
};

// ── heads ─────────────────────────────────────────────
/** left half → the whole, mirrored */
const mirror = (rows: string[]) => rows.map((r) => r + [...r].reverse().join(""));

/** front: fluffy cheeks, ears with pink insides (36 wide; the outline is added around it) */
const HEAD_FRONT = mirror([
  "......kk..........",
  ".....kkkk.........",
  ".....kppkk........",
  ".....kpppkk.......",
  "....kkppppkk......",
  "....kkpppppkk.....",
  "....kkppppkkkkkkkk",
  "...kkkpppkkkkkkkkk",
  "..kkkkkkkkkkkkkkkk",
  "..kkkkkkkkkkkkkkkk",
  ".kkkkkkkkkkkkkkkkk",
  "kkkkkkkkkkkkkkkkkk",
  ".kkkkkkkkkkkkkkkkk",
  ".wwwwwwwwwwwwwwwww",
  "..wwwwwwwwwwwwwwww",
  "wwwwwwwwwwwwwwwwww",
  ".wwwwwwwwwwwwwwwww",
  "..wwwwwwwwwwwwwccc",
  "..wwwwwwwwwwwccccc",
  "...wwwwwwwwwcccccc",
  ".....wwwwwwwcccccc",
  "........wwwwcccccc",
]);
/** back: the same outline, all fur, no pink */
const HEAD_BACK = HEAD_FRONT.map((r) => r.replace(/[wcp]/g, "k"));

/** the head's top left corner is at drawing dot (hx, hy); the middle of the face is `mid` fine dots */
const midOf = (hx: number) => hx * K + 19;
/** where its eyes and nose are, in drawing dots */
const faceAt = (hx: number, hy: number) => ({
  eyes: [hx + 6, hx + 12] as [number, number],
  eyeY: hy + 7,
  nose: [hx + 9, hy + 9] as [number, number],
});

/** the front head, with its mouth (a small ω under the nose) and whiskers */
function frontHead(g: Grid, hx: number, hy: number) {
  const mid = midOf(hx);
  const y = hy * K;
  layer(g, (c) => rowsAt(c, HEAD_FRONT, mid - 18, y + 1));
  for (const [dx, dy] of [[-3, 20], [-2, 21], [-1, 20], [0, 20], [1, 21], [2, 20]]) g[y + dy][mid + dx] = "o";
  // whiskers poking out of both cheeks (the right side mirrors the left)
  for (const [dx, dy] of [[-19, 18], [-20, 18], [-18, 21], [-19, 22]])
    for (const x of [mid + dx, mid - 1 - dx]) if (x >= 0 && x < W) g[y + dy][x] = "o";
}

/** curled up asleep: the head tucked in at the curl's right, eyes shut, chin on its tail */
const HEAD_CURL = [
  "..kk..............kk..",
  "..kpkk..........kkpk..",
  "..kppkk........kkppk..",
  ".kkpppkkkkkkkkkkpppkk.",
  ".kkkkkkkkkkkkkkkkkkkk.",
  "kkkkkkkkkkkkkkkkkkkkkk",
  "kkkkkkkkkkkkkkkkkkkkkk",
  "wwwwwwwwwwwwwwwwwwwwww",
  "wwywwwywwwwwwwwywwwyww",
  "wwwyyywwwwwwwwwwyyywww",
  ".wwwwwwwwcnncwwwwwwww.",
  ".wwwwwwccycyccwwwwwww.",
  "..wwwwcccyycccccwwww..",
  "....wwwwccccccwwww....",
  ".......wwwwwwww.......",
];

// ── bodies ────────────────────────────────────────────
/** fur seen from the front: a white bib down the middle, narrowing toward the legs */
const bib = (mid: number, y0: number, half: number) => (x: number, y: number) =>
  Math.abs(x + 0.5 - mid) <= half - Math.max(0, y - y0 - 3) ? "c" : "w";

/** two toes marked on a paw whose left edge is x and bottom row y */
const toes = (g: Grid, x: number, y: number) => crease(g, [[x + 2, y], [x + 2, y - 1], [x + 4, y], [x + 4, y - 1]]);

/** how far the chest reaches each side of the middle, row by row from the neck down */
const CHEST = [8, 9, 9, 9, 10, 10, 10, 10, 9];

/**
 * Standing or hanging, seen from the front or the back: the chest from `top` and two legs (their
 * paws' bottom rows at `bottoms`), one silhouette.
 */
function standBody(g: Grid, mid: number, top: number, bottoms: [number, number], fur: (x: number, y: number) => string, long = 0) {
  const legs = [mid - 10, mid + 4];
  const belly = top + CHEST.length - 1 + long;
  layer(g, (c) => {
    for (let y = top; y <= belly; y++) {
      const half = CHEST[Math.min(y - top, y > belly - 1 ? CHEST.length - 1 : CHEST.length - 2)];
      for (let x = mid - half; x < mid + half; x++) set(c, x, y, fur(x, y));
    }
    legs.forEach((x0, n) => block(c, x0, belly - 3, x0 + 5, bottoms[n], (x, y) => (y > bottoms[n] - 4 ? "l" : fur(x, y) === "k" ? "k" : "w")));
  });
  // the inner side of each leg runs a little way up into the chest
  legs.forEach((x0, n) => {
    const x = n ? x0 : x0 + 5;
    crease(g, [0, 1, 2, 3, 4].map((i) => [x, belly - 4 + i] as [number, number]));
    toes(g, x0, bottoms[n]);
  });
}

// ── frames ────────────────────────────────────────────
export type Row = "front" | "side" | "back" | "sit" | "look" | "lie" | "sleep" | "lift";
export const ROWS: Row[] = ["front", "side", "back", "sit", "look", "lie", "sleep", "lift"];

/** each frame of each row: the drawing, and where the face goes (for faces.ts) */
export interface Frame {
  /** FW·K × FH·K letters */
  fine: string[][];
  /** seen from the side or lying: the middle of its body, in fine dots (coats.ts places its markings by it) */
  bodyY?: number;
  /** the middle of the head in fine dots, for the markings, where the eyes don't tell it */
  faceX?: number;
  /** seen from behind: no face markings */
  back?: boolean;
  /** front face: eyes at these x on row eyeY, nose at `nose` (all in drawing dots) */
  front?: { eyes: [number, number]; eyeY: number; nose: [number, number]; look?: -1 | 0 | 1 };
  /** eyes shut (asleep): faces.ts keeps them shut */
  asleep?: boolean;
  /** top of the head in drawing dots, for the signs over it */
  top: number;
}

/** the tail up behind a cat walking toward you (sways): how far the tip and the middle lean */
const SWAY: [number, number][] = [[1, 1], [0, 0.5], [-1, -0.5], [0, 0.5]];
function tailUp(g: Grid, mid: number, y: number, i: number) {
  const [tip, bend] = SWAY[i];
  layer(g, (c) =>
    stroke(c, [
      [mid, y + 24],
      [mid, y + 10],
      [mid + 1 + bend * 2, y + 1],
      [mid + 2 + tip * 3, y - 5],
    ]),
  );
}

/**
 * Walking toward you or away: the paws on the floor, a step each side (1 left up, 3 right up).
 * Returns how far each paw is off the floor.
 */
const stepLift = (i: number): [number, number] => [i === 1 ? 3 : 0, i === 3 ? 3 : 0];

const frontFrame = (i: number): Frame => {
  const bob = i % 2; // a little dip on each step
  const hx = 2;
  const hy = 8 + bob;
  const mid = midOf(hx);
  const g = blank();
  const top = hy * K + 21;
  tailUp(g, mid, hy * K, i);
  const fur = bib(mid, top, 6);
  const [left, right] = stepLift(i);
  standBody(g, mid, top, [FLOOR - left, FLOOR - right], fur);
  frontHead(g, hx, hy);
  return { fine: g, faceX: mid - 0.5, front: faceAt(hx, hy), top: hy };
};

const backFrame = (i: number): Frame => {
  const bob = i % 2;
  const hx = 2;
  const hy = 8 + bob;
  const mid = midOf(hx);
  const g = blank();
  const top = hy * K + 21;
  const [left, right] = stepLift(i);
  standBody(g, mid, top, [FLOOR - left, FLOOR - right], () => "k");
  layer(g, (c) => rowsAt(c, HEAD_BACK, mid - 18, hy * K + 1));
  // the tail up and centre, nearest to you: from the rump, its tip swaying
  const s = ([0, 1, 0, -1] as const)[i];
  const base = Math.min(FLOOR - 6, top + 8);
  layer(g, (c) =>
    stroke(c, [
      [mid, base],
      [mid + 1, base - 9],
      [mid + s, base - 15],
      [mid + s * 4 - 2, base - 18],
    ]),
  );
  return { fine: g, faceX: mid - 0.5, back: true, top: hy };
};

/** walking sideways (walk.ts), eight frames; both eyes show */
const sideFrame = (i: number): Frame => {
  const w = walkFrame(i);
  return { fine: w.grid, bodyY: w.bodyY, front: { eyes: w.eyes, eyeY: w.eyeY, nose: w.nose }, top: w.top };
};

/** the sitting body: haunches out at the sides, two straight front legs, the tail curled round to the right */
function sitBody(g: Grid, mid: number) {
  layer(g, (c) =>
    stroke(c, [
      [mid + 9, 50],
      [mid + 15, 50],
      [mid + 18, 48],
      [mid + 18, 45],
      [mid + 16, 43],
    ]),
  );
  const fur = bib(mid, 40, 8);
  // from the neck down, how far it reaches each side: narrow shoulders, round haunches
  const SIT = [9, 9, 9, 10, 10, 10, 10, 11, 11, 12, 13, 13, 13, 13, 12, 11];
  layer(g, (c) =>
    SIT.forEach((half, n) => {
      const y = FLOOR - SIT.length + 1 + n;
      for (let x = mid - half; x < mid + half; x++) set(c, x, y, fur(x, y));
    }),
  );
  /** a dot `dx` from the middle on the left, or its mirror on the right */
  const at = (side: number, dx: number) => (side < 0 ? mid + dx : mid - 1 - dx);
  for (const side of [-1, 1]) {
    // the thigh, folded beside the front leg
    crease(g, [[-9, 46], [-10, 47], [-10, 48], [-10, 49], [-10, 50], [-9, 51], [-8, 52]].map(([dx, y]) => [at(side, dx), y] as [number, number]));
    for (const y of [49, 50, 51, 52]) for (let dx = -6; dx <= -2; dx++) g[y][at(side, dx)] = "l";
    crease(g, [[-5, 52], [-5, 51], [-3, 52], [-3, 51]].map(([dx, y]) => [at(side, dx), y] as [number, number]));
  }
  // the line between the two front legs
  for (const x of [mid - 1, mid]) crease(g, [46, 47, 48, 49, 50, 51, 52].map((y) => [x, y] as [number, number]));
}

/** sitting down: from standing to sitting, then sitting (a breath) */
const sitFrame = (i: number): Frame => {
  if (i === 0) return frontFrame(0);
  const hx = 2;
  const hy = 8 + (i === 1 ? -1 : i === 3 ? 1 : 0);
  const mid = midOf(hx);
  const g = blank();
  sitBody(g, mid);
  frontHead(g, hx, hy);
  return { fine: g, faceX: mid - 0.5, front: faceAt(hx, hy), top: hy };
};

/** sitting and looking about: left, ahead, right, ahead (head shifts a dot, eyes follow) */
const lookFrame = (i: number): Frame => {
  const look = ([-1, 0, 1, 0] as const)[i];
  const hx = 2 + look;
  const hy = 8;
  const g = blank();
  sitBody(g, midOf(2));
  frontHead(g, hx, hy);
  return { fine: g, faceX: midOf(hx) - 0.5, front: { ...faceAt(hx, hy), look }, top: hy };
};

/** a stretch, then lying down on its front, wearing the walk's head */
const lieFrame = (i: number): Frame => {
  if (i === 0) return sideFrame(0);
  const g = blank();
  const stretch = i === 1;
  const cy = stretch ? 45 : 47;
  const fur = (x: number, y: number) => (y < (stretch ? cy + Math.floor((x - 14) / 4) : cy) ? "k" : x >= 28 && y >= cy + 2 ? "c" : "w");
  layer(g, (c) =>
    stroke(
      c,
      stretch
        ? [[8, 41], [4, 37], [3, 32], [4, 29], [7, 28]]
        : [[9, 48], [4, 46], [3, 42], [3, 38], [5, 36], [8, 36]],
    ),
  );
  layer(g, (c) => {
    if (stretch) {
      // rear up, chest low
      oval(c, 12, 41.5, 7, 6, fur);
      oval(c, 20, 44, 9, 5.5, fur);
      oval(c, 28, 47, 8, 5, fur);
      for (let y = 43; y <= FLOOR; y++) {
        const x = 7 - Math.round((y - 43) / 4);
        for (let n = 0; n < 5; n++) set(c, x + n, y, y > FLOOR - 4 ? "l" : "w");
      }
      set(c, 10, FLOOR, "l");
    } else {
      resting(c, 21, 48.5, 17, 5.5, fur);
      resting(c, 12, 48, 9, 6, fur);
    }
  });
  if (stretch) crease(g, [[12, 43], [13, 44], [13, 45], [13, 46], [12, 47], [11, 48]]);
  else {
    // the thigh folded under, and the hind foot peeking out
    crease(g, [[12, 45], [14, 45], [13, 45], [15, 46], [16, 47], [17, 48], [17, 49], [16, 50]]);
    layer(g, (c) => block(c, 11, 50, 18, FLOOR, () => "l"));
    crease(g, [[16, FLOOR], [16, FLOOR - 1]]);
  }
  const face = sideHead(g, 18, stretch ? 30 : i === 3 ? 30 : 28);
  // the front paws reaching out under the chin
  for (const x of stretch ? [31, 39] : [29, 37]) {
    layer(g, (c) => block(c, x, 50, x + 6, FLOOR, () => "l"));
    toes(g, x, FLOOR);
  }
  const { top, ...front } = face;
  return { fine: g, bodyY: cy, front, top };
};

/** held up by the scruff (a person lifts it): head higher, body and legs hanging, paws dangling; sways a little */
const liftFrame = (i: number): Frame => {
  const hx = 2 + ([0, 1, 0, -1] as const)[i];
  const hy = 4;
  const mid = midOf(hx);
  const g = blank();
  const top = hy * K + 21;
  tailUp(g, mid, hy * K + 4, i);
  standBody(g, mid, top, [top + 17, top + 17], bib(mid, top, 6), 3);
  frontHead(g, hx, hy);
  return { fine: g, faceX: mid - 0.5, front: faceAt(hx, hy), top: hy };
};

/** curled up asleep, breathing (the back rises, the floor side stays put) */
const sleepFrame = (i: number): Frame => {
  const rise = i === 1 || i === 2 ? 1 : 0;
  const g = blank();
  const cy = 47;
  layer(g, (c) => {
    resting(c, 19.5, 48 - rise, 16, 8 + rise, (_, y) => (y < cy ? "k" : "w"));
    resting(c, 29, 48, 11, 5.5, () => "w");
  });
  // the thigh's curve on the ball
  crease(g, [[9, 47], [10, 46], [11, 45], [12, 45], [13, 44], [14, 44], [15, 45], [16, 45], [17, 46], [18, 47], [18, 48]]);
  // the tail wrapped round the front
  layer(g, (c) =>
    stroke(c, [
      [5, 47],
      [8, 50],
      [14, 51],
      [26, 51],
    ]),
  );
  layer(g, (c) => rowsAt(c, HEAD_CURL, 23, 33));
  return { fine: g, bodyY: cy, faceX: 34, asleep: true, top: 16 };
};

const MAKERS: Record<Row, (i: number) => Frame> = { front: frontFrame, side: sideFrame, back: backFrame, sit: sitFrame, look: lookFrame, lie: lieFrame, sleep: sleepFrame, lift: liftFrame };

/** frame `i` of a row (0–3; the side walk has 0–7) */
export const frameOf = (row: Row, i: number): Frame => MAKERS[row](i);

/** the frame at one letter per drawing dot, FW × FH: any filled dot of each K × K block */
export function letters(f: Frame): string[][] {
  const at = f.fine;
  return Array.from({ length: FH }, (_, y) =>
    Array.from({ length: FW }, (_, x) => [at[y * K][x * K], at[y * K][x * K + 1], at[y * K + 1][x * K], at[y * K + 1][x * K + 1]].find((c) => c !== ".") ?? "."),
  );
}
