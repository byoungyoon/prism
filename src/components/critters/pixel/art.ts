// The pixel cat, dot by dot. Every frame is put together from parts (head, body, legs, tail) drawn
// as text: one character per dot. The letters say what a dot is, not its colour — a coat (coats.ts)
// colours them, so every coat shares the same drawings:
//   o outline        k fur (head top, back)     w fur (cheeks, sides)    c chest / muzzle
//   p inside of ear  l paw                      t tail                   y eye      n nose
// (the side walk is drawn finer, straight at K× — walk.ts)
//   . nothing
// A frame is FW × FH dots; the cat stands on the bottom rows, the space above its head is for the
// little signs (♪, ♥, 💢 …) in faces.ts.

import { walkFrame } from "./walk";

export const FW = 24;
export const FH = 28;
/** the drawn cat has K × K times the dots of the drawing above (finer fur, eyes, ears, outline) */
export const K = 2;

/** a drawing: rows of letters */
export type Art = string[];
/** a part placed in a frame */
/** `slope`: every `slope` columns to the right, the part sits a dot lower (a body leaning down) */
type Placed = { art: Art; x: number; y: number; flip?: boolean; slope?: number };

/** left half (with the middle column last) → the whole, mirrored */
const mirror = (rows: Art): Art => rows.map((r) => r + [...r.slice(0, -1)].reverse().join(""));

// ── heads ─────────────────────────────────────────────
/** front: fluffy cheeks, ears with pink insides (19 wide) */
export const HEAD_FRONT: Art = mirror([
  "...oo.....",
  "..okko....",
  "..okpko...",
  "..okppkooo",
  ".okkppkkkk",
  ".okkkkkkkk",
  "okkkkkkkkk",
  ".owwwwwwww",
  "oowwwwwwww",
  ".owwwwwwww",
  "..owwwwccc",
  "...oowcccc",
]);
/** where the eyes and nose of HEAD_FRONT are (faces.ts draws over them) */
export const FACE_FRONT = { eyes: [6, 12], eyeY: 7, nose: [9, 9] as [number, number] };

/** back: the same outline, all fur (19 wide) */
export const HEAD_BACK: Art = mirror([
  "...oo.....",
  "..okko....",
  "..okkko...",
  "..okkkkooo",
  ".okkkkkkkk",
  ".okkkkkkkk",
  "okkkkkkkkk",
  ".okkkkkkkk",
  "ookkkkkkkk",
  ".okkkkkkkk",
  "..okkkkkkk",
  "...ookkkkk",
]);

/** side, looking right (14 wide) */
export const HEAD_SIDE: Art = [
  "..oo.....oo...",
  ".okko...okpo..",
  ".okpkoookppko.",
  "okkkkkkkkkkkko",
  "okkkkkkkkkkwwo",
  "okkkkkkkwwwwwo",
  "okkkkkkwwwwwcn",
  ".okkkkwwwwwcco",
  "..oowwwwwwooo.",
  "....oooooo....",
];
/** the eye of HEAD_SIDE */
export const FACE_SIDE = { eye: [10, 4] as [number, number] };

// ── bodies ────────────────────────────────────────────
/** sitting, front (19 wide): front legs as two lines, paws at the bottom */
const BODY_SIT: Art = [
  "...owwcccccccwwo...",
  "..owwwcccccccwwwo..",
  "..owwwwcccccwwwwo..",
  "..owwwwowcwowwwwo..",
  "..owwwwowcwowwwwo..",
  "..owwwwolllowwwwo..",
  "...oooooooooooooo..",
];
/** sitting tail, curled round to the right */
const TAIL_SIT: Art = [
  "....oo",
  "...oto",
  "...oto",
  "..otto",
  "oottoo",
  "tto...",
];
/** standing, front (13 wide): body behind the chest, legs in `LEGS_FRONT` */
const BODY_FRONT: Art = [
  "..owcccccwo..",
  ".owwcccccwwo.",
  ".owwwcccwwwo.",
  ".owwwwwwwwwo.",
];
/** front legs, a step each side: 0 still, 1 left up, 2 still, 3 right up */
const LEGS_FRONT: Art[] = [
  [".owlo...olwo.", ".olllo.olllo.", "..ooo...ooo.."],
  [".owlo...olwo.", ".olllo.olwo..", "..ooo..olllo.", ".......ooo..."],
  [".owlo...olwo.", ".olllo.olllo.", "..ooo...ooo.."],
  [".owlo...olwo.", "..owlo.olllo.", ".olllo..ooo..", "..ooo........"],
];
/** the tail up behind a cat walking toward you (sways) */
const TAIL_UP: Art[] = [
  ["..oo", ".oto", ".oto", "oto.", "oto.", "oto.", "oto."],
  [".oo.", ".oto", ".oto", ".oto", "oto.", "oto.", "oto."],
  ["oo..", "oto.", ".oto", ".oto", ".oto", "oto.", "oto."],
  [".oo.", ".oto", ".oto", ".oto", "oto.", "oto.", "oto."],
];
/** standing, back (13 wide) */
const BODY_BACK: Art = [
  "..okkkkkkko..",
  ".okkkkkkkkko.",
  ".okkkkkkkkko.",
  ".okkkkkkkkko.",
];
/** back legs seen from behind */
const LEGS_BACK: Art[] = [
  [".okko...okko.", ".olllo.olllo.", "..ooo...ooo.."],
  [".okko...okko.", ".olllo.okko..", "..ooo..olllo.", ".......ooo..."],
  [".okko...okko.", ".olllo.olllo.", "..ooo...ooo.."],
  [".okko...okko.", "..okko.olllo.", ".olllo..ooo..", "..ooo........"],
];
/** the tail up and centre, seen from behind */
const TAIL_BACK: Art[] = [
  [".oo.", "otto", ".oto", ".oto", ".oto", ".oto"],
  ["..oo", ".oto", ".oto", ".oto", ".oto", ".oto"],
  [".oo.", "otto", ".oto", ".oto", ".oto", ".oto"],
  ["oo..", "oto.", ".oto", ".oto", ".oto", ".oto"],
];

/** four legs (a dot column each, outlined) at these x, three dots long */
const legsAt = (xs: number[], w = 18, long = 4): Art =>
  Array.from({ length: long }, (_, y) => {
    const r = Array<string>(w).fill(".");
    for (const x of xs) {
      if (x < 0 || x + 1 >= w) continue;
      r[x] = "o";
      r[x + 1] = y === long - 1 ? "o" : "l";
    }
    return r.join("");
  });
/** standing, side, facing right (18 wide): the stretch */
const BODY_SIDE: Art = [
  "..ooooooooooo...",
  ".okkkkkkkkkkko..",
  "okkkkkkkkkkkkko.",
  "owwkkkkkkkkkwwo.",
  ".owwwwwwwwwwwo..",
];
/** side tail, up and curving back (the stretch, lying down) */
const TAIL_SIDE: Art[] = [
  [".oo.", ".oto", "..ot", "..ot", "..ot"],
  ["oo..", "oto.", ".oto", "..ot", "..ot"],
];

/** lying on its front, side view (20 wide): the stretch and the lie-down */
const BODY_LIE: Art = [
  "...ooooooooooooo....",
  "..okkkkkkkkkkkkko...",
  ".okkkkkkkkkkkkkkko..",
  "owwwwwwwwwwwwwwwwwo.",
  ".oollooooooooolloo..",
];
/** a curled-up sleeping ball (19 wide), head tucked at the right */
const BODY_CURL: Art = [
  "....ooooooooo......",
  "..ookkkkkkkkkoo....",
  ".okkkkkkkkkkkkkoo..",
  "okkkkkkkkkkkkkkkko.",
  "okkkkkkkkkkkkkkkko.",
  "otttttkkkkkkkkwwwo.",
  ".ooooottttwwwwwwo..",
  "......oooooooooo...",
];
/** the head tucked in, eyes shut (12 wide), at the curl's right */
const HEAD_CURL: Art = [
  ".oo....oo...",
  "okpo..opko..",
  "okkkookkkko.",
  "okkkkkkkkkko",
  "owwwwwwwwwwo",
  ".owyywwyywo.",
  "..oowwwwoo..",
  "....oooo....",
];

// ── frames ────────────────────────────────────────────
export type Row = "front" | "side" | "back" | "sit" | "look" | "lie" | "sleep" | "lift";
export const ROWS: Row[] = ["front", "side", "back", "sit", "look", "lie", "sleep", "lift"];

/** each frame of each row: the parts, and where the face goes (for faces.ts) */
export interface Frame {
  parts: Placed[];
  /** a frame drawn straight at the fine resolution (FW·K × FH·K letters), used instead of `parts` */
  fine?: string[][];
  /** the side walk: the middle of its body, in fine dots (coats.ts places its markings by it) */
  bodyY?: number;
  /** front face: eyes at these x on row eyeY, nose at `nose` (all in frame dots) */
  front?: { eyes: [number, number]; eyeY: number; nose: [number, number]; look?: -1 | 0 | 1 };
  /** side face: the eye */
  side?: { eye: [number, number] };
  /** eyes shut (asleep): faces.ts keeps them shut */
  asleep?: boolean;
  /** top of the head, for the signs over it */
  top: number;
}

const GROUND = FH - 2; // the last row of the cat's feet

const frontFrame = (i: number): Frame => {
  const bob = i % 2; // a little dip on each step
  const hx = 2;
  const hy = GROUND - 20 + bob;
  const legs = LEGS_FRONT[i];
  return {
    parts: [
      { art: TAIL_UP[i], x: hx + 9, y: hy - 4 },
      { art: BODY_FRONT, x: hx + 3, y: hy + 12 },
      { art: legs, x: hx + 3, y: hy + 16 },
      { art: HEAD_FRONT, x: hx, y: hy },
    ],
    front: { eyes: [hx + FACE_FRONT.eyes[0], hx + FACE_FRONT.eyes[1]], eyeY: hy + FACE_FRONT.eyeY, nose: [hx + FACE_FRONT.nose[0], hy + FACE_FRONT.nose[1]] },
    top: hy,
  };
};

const backFrame = (i: number): Frame => {
  const bob = i % 2;
  const hx = 2;
  const hy = GROUND - 20 + bob;
  return {
    parts: [
      { art: BODY_BACK, x: hx + 3, y: hy + 12 },
      { art: LEGS_BACK[i], x: hx + 3, y: hy + 16 },
      { art: HEAD_BACK, x: hx, y: hy },
      { art: TAIL_BACK[i], x: hx + 8, y: hy + 6 },
    ],
    top: hy,
  };
};

/** walking sideways: drawn at the fine resolution (walk.ts), eight frames; both eyes show */
const sideFrame = (i: number): Frame => {
  const w = walkFrame(i);
  return { parts: [], fine: w.grid, bodyY: w.bodyY, front: { eyes: w.eyes, eyeY: w.eyeY, nose: w.nose }, top: w.top };
};

/** sitting down: from standing to sitting, then sitting (a breath) */
const sitFrame = (i: number): Frame => {
  if (i === 0) return frontFrame(0);
  const hx = 2;
  const hy = GROUND - 18 + (i === 1 ? -1 : i === 3 ? 1 : 0);
  return {
    parts: [
      { art: TAIL_SIT, x: 16, y: GROUND - 5 },
      { art: BODY_SIT, x: hx, y: GROUND - 6 },
      { art: HEAD_FRONT, x: hx, y: hy },
    ],
    front: { eyes: [hx + FACE_FRONT.eyes[0], hx + FACE_FRONT.eyes[1]], eyeY: hy + FACE_FRONT.eyeY, nose: [hx + FACE_FRONT.nose[0], hy + FACE_FRONT.nose[1]] },
    top: hy,
  };
};

/** sitting and looking about: left, ahead, right, ahead (head shifts a dot, eyes follow) */
const lookFrame = (i: number): Frame => {
  const look = ([-1, 0, 1, 0] as const)[i];
  const hx = 2 + look;
  const hy = GROUND - 18;
  return {
    parts: [
      { art: TAIL_SIT, x: 16, y: GROUND - 5 },
      { art: BODY_SIT, x: 2, y: GROUND - 6 },
      { art: HEAD_FRONT, x: hx, y: hy },
    ],
    front: { eyes: [hx + FACE_FRONT.eyes[0], hx + FACE_FRONT.eyes[1]], eyeY: hy + FACE_FRONT.eyeY, nose: [hx + FACE_FRONT.nose[0], hy + FACE_FRONT.nose[1]], look },
    top: hy,
  };
};

/** a stretch, then lying down on its front */
const lieFrame = (i: number): Frame => {
  if (i === 0) return sideFrame(0);
  if (i === 1) {
    // the stretch: rear up, chest low, front paws reaching forward
    const by = GROUND - 6;
    return {
      parts: [
        { art: TAIL_SIDE[0], x: 0, y: by - 7 },
        { art: BODY_SIDE, x: 1, y: by - 2, slope: 4 },
        { art: legsAt([2, 5]), x: 1, y: by + 3 },
        { art: ["oooooo", "llllllo", "oooooo"], x: 15, y: by + 3 },
        { art: HEAD_SIDE, x: 9, y: by - 4 },
      ],
      side: { eye: [9 + FACE_SIDE.eye[0], by - 4 + FACE_SIDE.eye[1]] },
      top: by - 4,
    };
  }
  const by = GROUND - 4;
  const hy = by - 8 + (i === 3 ? 1 : 0);
  return {
    parts: [
      { art: TAIL_SIDE[1], x: 0, y: by - 3 },
      { art: BODY_LIE, x: 1, y: by },
      { art: HEAD_SIDE, x: 9, y: hy },
    ],
    side: { eye: [9 + FACE_SIDE.eye[0], hy + FACE_SIDE.eye[1]] },
    top: hy,
  };
};

/** held up by the scruff (a person lifts it): head higher, body and legs hanging, paws dangling; sways a little */
const LEGS_DANGLE: Art = [".owlo...olwo.", ".olllo.olllo.", ".olllo.olllo.", "..ooo...ooo.."];
const liftFrame = (i: number): Frame => {
  const hx = 2 + ([0, 1, 0, -1] as const)[i];
  const hy = GROUND - 22;
  return {
    parts: [
      { art: TAIL_UP[i], x: hx + 9, y: hy - 2 },
      { art: BODY_FRONT, x: hx + 3, y: hy + 12 },
      { art: LEGS_DANGLE, x: hx + 3, y: hy + 16 },
      { art: HEAD_FRONT, x: hx, y: hy },
    ],
    front: { eyes: [hx + FACE_FRONT.eyes[0], hx + FACE_FRONT.eyes[1]], eyeY: hy + FACE_FRONT.eyeY, nose: [hx + FACE_FRONT.nose[0], hy + FACE_FRONT.nose[1]] },
    top: hy,
  };
};

/** curled up asleep, breathing */
const sleepFrame = (i: number): Frame => {
  const rise = i === 1 || i === 2 ? 1 : 0;
  const by = GROUND - 7;
  return {
    parts: [
      { art: BODY_CURL, x: 1, y: by - rise + (rise ? 0 : 0) },
      { art: HEAD_CURL, x: 11, y: by - 3 },
    ],
    asleep: true,
    top: by - 3,
  };
};

const MAKERS: Record<Row, (i: number) => Frame> = { front: frontFrame, side: sideFrame, back: backFrame, sit: sitFrame, look: lookFrame, lie: lieFrame, sleep: sleepFrame, lift: liftFrame };

/** frame `i` of a row (0–3; the side walk has 0–7) */
export const frameOf = (row: Row, i: number): Frame => MAKERS[row](i);

/** the frame as letters, FW × FH (later parts draw over earlier ones) */
export function letters(f: Frame): string[][] {
  const g = Array.from({ length: FH }, () => Array<string>(FW).fill("."));
  // a fine frame seen at one letter per drawing dot: any filled dot of each K × K block
  const fine = f.fine;
  if (fine) return g.map((row, y) => row.map((_, x) => [fine[y * K][x * K], fine[y * K][x * K + 1], fine[y * K + 1][x * K], fine[y * K + 1][x * K + 1]].find((c) => c !== ".") ?? "."));
  for (const p of f.parts) {
    p.art.forEach((row, dy) => {
      const cells = p.flip ? [...row].reverse() : [...row];
      cells.forEach((ch, dx) => {
        const x = p.x + dx;
        const y = p.y + dy + (p.slope ? Math.floor(dx / p.slope) : 0);
        if (ch !== "." && x >= 0 && x < FW && y >= 0 && y < FH) g[y][x] = ch;
      });
    });
  }
  return g;
}

/**
 * Scale2x (EPX): every dot becomes 2 × 2, and where a stair-step of one colour meets another the
 * corner dot is taken from the neighbour, so diagonal outlines and the round head come out smooth
 * instead of blocky. Works on letters, so the outline, fur and ear colours keep their meaning.
 */
export function scale2x(g: string[][]): string[][] {
  const H = g.length;
  const W = g[0].length;
  const at = (x: number, y: number) => (y < 0 || y >= H || x < 0 || x >= W ? "." : g[y][x]);
  const out = Array.from({ length: H * 2 }, () => Array<string>(W * 2).fill("."));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const E = at(x, y);
      const A = at(x, y - 1); // up
      const B = at(x + 1, y); // right
      const C = at(x - 1, y); // left
      const D = at(x, y + 1); // down
      out[y * 2][x * 2] = C === A && C !== D && A !== B ? A : E;
      out[y * 2][x * 2 + 1] = A === B && A !== C && B !== D ? B : E;
      out[y * 2 + 1][x * 2] = D === C && D !== B && C !== A ? C : E;
      out[y * 2 + 1][x * 2 + 1] = B === D && B !== A && D !== C ? D : E;
    }
  return out;
}

/** the frame at K × K dots per drawing dot, smoothed (see scale2x) */
export const hires = (f: Frame): string[][] => f.fine ?? scale2x(letters(f));
