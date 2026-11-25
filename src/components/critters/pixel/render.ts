// Draws pixel-cat frames into small PNG strips (one frame after another, left to right), once per
// coat × motion × feeling, and keeps them. The screen shows a strip as a background and steps
// through its frames with CSS (no work in JavaScript while it plays).
// The strip is drawn at K × K dots per drawing dot (art.ts), so the cat keeps its size on screen
// but its dots are finer: fur, eyes, ears and outline all get more detail.
import { FH, FW, K, frameOf, hires, letters, type Row } from "./art";
import { dotColor, type Coat } from "./coats";
import { faceDots, INK, type Feel } from "./faces";

/** shadow dots, down and to the right of the cat (the drop shadow of the drawings) */
const SHADOW = "rgba(52, 38, 28, 0.28)";
/** the little shine in each eye */
const SHINE = "#ffffff";

const cache = new Map<string, string>();

/** a colour a little darker (#rrggbb) */
const shade = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const d = (v: number) => Math.round(v * 0.86);
  return `rgb(${d(n >> 16)}, ${d((n >> 8) & 255)}, ${d(n & 255)})`;
};

/** paint one frame at (ox, 0) of a canvas at K × K dots per drawing dot */
function paint(g: CanvasRenderingContext2D, coat: Coat, row: Row, i: number, feel: Feel, ox: number) {
  const f = frameOf(row, i);
  const low = letters(f); // the drawing itself: for the sign's place and the head's edge
  const grid = hires(f); // the same drawing, K× the dots, smoothed
  const W = FW * K;
  const H = FH * K;
  const faceX = f.front ? (f.front.eyes[0] + f.front.eyes[1]) / 2 : f.side ? f.side.eye[0] - 3 : FW / 2;
  const filled = (x: number, y: number) => y >= 0 && y < H && x >= 0 && x < W && grid[y][x] !== ".";
  // the drop shadow first (two dots down and to the right)
  g.fillStyle = SHADOW;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!filled(x, y) && filled(x - 2, y - 2)) g.fillRect(ox + x, y, 1, 1);
  // fur along the right and bottom edges is a shade darker, as if lit from the top left
  const edge = (x: number, y: number) => !filled(x, y) || grid[y][x] === "o";
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ch = grid[y][x];
      let c = dotColor(coat, ch, x, y, f.top * K, faceX * K);
      if (!c) continue;
      if ("kwctlp".includes(ch) && (edge(x + 1, y) || edge(x, y + 1))) c = shade(c);
      // gloom: a pale blue shadow over the forehead
      if (feel === "gloom" && f.front && "kwp".includes(ch) && y < f.front.eyeY * K) c = "#b9d3e0";
      g.fillStyle = c;
      g.fillRect(ox + x, y, 1, 1);
    }
  // right edge of the head (in drawing dots), for the sign over it
  let right = 0;
  for (let y = f.top; y < f.top + 6 && y < FH; y++) for (let x = 0; x < FW; x++) if (low[y][x] !== ".") right = Math.max(right, x);
  // the face: each drawing dot of it is K × K dots; an eye's top dot carries a shine
  const dots = faceDots(feel, f.front, f.side, !!f.asleep, f.top, right - 3);
  const eyeAt = new Set(dots.filter(([, , ink]) => ink === "eye").map(([x, y]) => `${x},${y}`));
  for (const [x, y, ink] of dots) {
    if (x < 0 || x >= FW || y < 0 || y >= FH) continue;
    const c = ink === "line" ? coat.line : ink === "eye" ? coat.eye : INK[ink];
    g.fillStyle = c;
    g.fillRect(ox + x * K, y * K, K, K);
    if (ink === "eye" && !eyeAt.has(`${x},${y - 1}`)) {
      g.fillStyle = SHINE;
      g.fillRect(ox + x * K, y * K, 1, 1);
    }
  }
}

/** a strip of `frames` of `row` (as a data: URL), FW·K·n × FH·K dots */
export function strip(coat: Coat, row: Row, frames: number[], feel: Feel): string {
  const key = `${coat.id}|${row}|${frames.join("")}|${feel}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = FW * K * frames.length;
  c.height = FH * K;
  const g = c.getContext("2d");
  if (!g) return "";
  frames.forEach((i, n) => paint(g, coat, row, i, feel, n * FW * K));
  const url = c.toDataURL("image/png");
  cache.set(key, url);
  return url;
}
