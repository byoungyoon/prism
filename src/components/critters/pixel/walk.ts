// The side walk (facing right), after the picture the cats are taken from: a big head turned a
// little toward you (both eyes show), a short body, stubby legs and a tail held up with its tip
// curled over. Unlike the other motions it is drawn straight at the fine resolution (FW·K × FH·K,
// no Scale2x), with the same letters as art.ts, plus:
//   f fur of a far leg (a shade darker)    g paw of a far leg

/** frames in one round of the walk */
export const WALK_FRAMES = 8;

const W = 48;
const H = 56;
/** the lowest row of a paw's fill (its outline sits on the row below) */
const FLOOR = 52;

/** cells of one layer: "x,y" → letter */
type Cells = Map<string, string>;
const set = (c: Cells, x: number, y: number, ch: string) => c.set(`${x},${y}`, ch);

/** paint a layer onto the grid, with a one-dot outline around it (over whatever is behind) */
function stamp(g: string[][], cells: Cells) {
  for (const key of cells.keys()) {
    const [x, y] = key.split(",").map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && !cells.has(`${nx},${ny}`)) g[ny][nx] = "o";
    }
  }
  for (const [key, ch] of cells) {
    const [x, y] = key.split(",").map(Number);
    if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = ch;
  }
}

function oval(c: Cells, cx: number, cy: number, rx: number, ry: number, ch: (x: number, y: number) => string) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(c, x, y, ch(x, y));
}

/** the head (26 wide, fill only: the outline is added around it) */
const HEAD: string[] = [
  "...kk...............kk....",
  "...kkk.............kkk....",
  "...kpkk...........kkpkk...",
  "...kppkk.........kkppkk...",
  "..kkpppkkk.....kkkkpppkk..",
  "..kkppkkkkkkkkkkkkkkppkk..",
  "..kkkkkkkkkkkkkkkkkkkkkk..",
  ".kkkkkkkkkkkkkkkkkkkkkkkk.",
  ".kkkkkkkkkkkkkkkkkkkkkkkk.",
  ".kkkkkkkkkkkkkkkkkkkkkkkk.",
  ".kkkkkkkkkkkkkkkkkkkkkkkk.",
  ".wkkkkkkkkkkwwwwwwkkkkkww.",
  ".wwwkkkkkkwwwwwwwwwwwwwwww",
  "wwwwwwwwwwwwccccccccwwwww.",
  ".wwwwwwwwwwcccccccccccwwww",
  "..wwwwwwwwwccccccccccwww..",
  "...wwwwwwwwwccccccccwww...",
  ".....wwwwwwwwccccccww.....",
  "........wwwwwwwwwww.......",
];
/** the mouth, in head dots: a small ω under the nose */
const MOUTH: [number, number][] = [[14, 16], [15, 17], [16, 16], [17, 16], [18, 17], [19, 16]];
/** whiskers poking out of the near cheek */
const WHISKERS: [number, number][] = [[27, 12], [28, 12], [27, 15], [28, 16]];

/** where the face goes, in head dots (even, so faces.ts can draw on whole drawing dots) */
const EYE_L = 12;
const EYE_R = 22;
const EYE_ROW = 10;
const NOSE: [number, number] = [16, 14];

/**
 * One leg through one round: planted for the first five eighths, sliding back as the body goes
 * over it, then lifted and swung forward. `p` is 0‥1.
 */
function step(p: number): { dx: number; lift: number } {
  const stance = 0.625;
  const reach = 4;
  if (p < stance) return { dx: Math.round(reach - (2 * reach * p) / stance), lift: 0 };
  const t = (p - stance) / (1 - stance);
  return { dx: Math.round(-reach * Math.cos(t * Math.PI)), lift: Math.round(1 + Math.sin(t * Math.PI) * 2) };
}

/** a leg from the hip (x, top) down to its paw: four dots thick, the paw a dot longer at the front */
function leg(c: Cells, x: number, top: number, dx: number, lift: number, fur: string, paw: string) {
  const bottom = FLOOR - lift;
  const long = Math.max(1, bottom - top);
  for (let y = top; y <= bottom; y++) {
    const x0 = x + Math.round((dx * (y - top)) / long);
    const isPaw = y > bottom - 3;
    // a lifted paw folds back a little, toes down
    const toe = isPaw && y > bottom - 2 ? (lift ? 0 : 1) : 0;
    for (let i = 0; i < 4 + toe; i++) set(c, x0 + i, y, isPaw ? paw : fur);
  }
}

/** the tail: up from the rump, the tip curled over toward the head; `s` sways the upper part */
function tail(c: Cells, bob: number, s: number) {
  const pts: [number, number][] = [
    [12, 39 + bob],
    [7, 38 + bob],
    [4, 34 + bob],
    [3 + s * 0.4, 29 + bob],
    [4 + s, 25 + bob],
    [7 + s * 1.5, 23.5 + bob],
    [9.5 + s * 1.5, 25 + bob],
  ];
  for (let n = 1; n < pts.length; n++) {
    const [ax, ay] = pts[n - 1];
    const [bx, by] = pts[n];
    for (let k = 0; k <= 10; k++) {
      const x = ax + ((bx - ax) * k) / 10;
      const y = ay + ((by - ay) * k) / 10;
      oval(c, Math.round(x), Math.round(y), 1.5, 1.5, () => "t");
    }
  }
}

export interface Walk {
  grid: string[][];
  /** all in drawing dots (K = 2 fine dots) */
  eyes: [number, number];
  eyeY: number;
  nose: [number, number];
  top: number;
  /** the middle of the body, in fine dots (the markings ride with it) */
  bodyY: number;
}

/** frame `i` (0‥7) of the walk */
export function walkFrame(i: number): Walk {
  const p = (i % WALK_FRAMES) / WALK_FRAMES;
  // the body rises and falls twice a round; the head follows a beat later (two fine dots = one drawing dot)
  const dip = (n: number) => (((n % 4) + 4) % 4 >= 2 ? 1 : 0);
  const bob = dip(i);
  const headDip = dip(i - 1) * 2;
  const sway = [0, 1, 1.5, 1, 0, -1, -1.5, -1][i % WALK_FRAMES];
  // a cat's walk: near hind, near fore, far hind, far fore, a quarter round apart
  const at = (offset: number) => step((p + offset) % 1);
  const nearHind = at(0);
  const nearFore = at(0.75);
  const farHind = at(0.5);
  const farFore = at(0.25);

  const g = Array.from({ length: H }, () => Array<string>(W).fill("."));

  // the far legs, behind everything
  for (const [x, s] of [[17, farHind], [31, farFore]] as const) {
    const c: Cells = new Map();
    leg(c, x, 42 + bob, s.dx, s.lift + 1, "f", "g");
    stamp(g, c);
  }

  const t: Cells = new Map();
  tail(t, bob, sway);
  stamp(g, t);

  // the body and the near legs, one silhouette
  const body: Cells = new Map();
  const cy = 41 + bob;
  const fur = (x: number, y: number) => (y < cy ? "k" : x >= 27 && y >= cy + 1 ? "c" : "w");
  oval(body, 21.5, cy, 11.5, 5.6, fur);
  oval(body, 15, cy + 0.5, 5.5, 5.6, fur); // haunch
  oval(body, 30, cy + 0.5, 5, 5.8, fur); // chest
  leg(body, 12, cy + 2, nearHind.dx, nearHind.lift, "w", "l");
  leg(body, 27, cy + 2, nearFore.dx, nearFore.lift, "w", "l");
  stamp(g, body);
  // short creases where the near legs join the body, and the curve of the thigh
  const crease = (x: number, y: number) => {
    if (g[y]?.[x] && "kwc".includes(g[y][x])) g[y][x] = "o";
  };
  for (const [x, y] of [[17, 0], [18, 1], [18, 2], [18, 3], [17, 4]]) crease(x, cy + y);
  for (const y of [3, 4, 5]) crease(26, cy + y);

  const hx = 18;
  const hy = 22 + headDip;
  const head: Cells = new Map();
  HEAD.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== ".") set(head, hx + x, hy + y, ch);
    }),
  );
  stamp(g, head);
  for (const [x, y] of MOUTH) g[hy + y][hx + x] = "o";
  for (const [x, y] of WHISKERS) if (hx + x < W) g[hy + y][hx + x] = "o";

  const half = (v: number) => v / 2;
  return {
    grid: g,
    eyes: [half(hx + EYE_L), half(hx + EYE_R)],
    eyeY: half(hy + EYE_ROW),
    nose: [half(hx + NOSE[0]), half(hy + NOSE[1])],
    top: half(hy),
    bodyY: cy,
  };
}
