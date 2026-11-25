// Draws pixel-cat frames into small PNG strips (one frame after another, left to right), once per
// coat × motion × feeling, and keeps them. The screen shows a strip as a background and steps
// through its frames with CSS (no work in JavaScript while it plays).
import { FH, FW, frameOf, letters, type Row } from "./art";
import { dotColor, type Coat } from "./coats";
import { faceDots, INK, type Feel } from "./faces";

/** shadow dots, down and to the right of the cat (the drop shadow of the drawings) */
const SHADOW = "rgba(52, 38, 28, 0.28)";

const cache = new Map<string, string>();

/** a colour a little darker (#rrggbb) */
const shade = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const d = (v: number) => Math.round(v * 0.86);
  return `rgb(${d(n >> 16)}, ${d((n >> 8) & 255)}, ${d(n & 255)})`;
};

/** paint one frame at (ox, 0) of a 1-dot-per-pixel canvas */
function paint(g: CanvasRenderingContext2D, coat: Coat, row: Row, i: number, feel: Feel, ox: number) {
  const f = frameOf(row, i);
  const grid = letters(f);
  const faceX = f.front ? (f.front.eyes[0] + f.front.eyes[1]) / 2 : f.side ? f.side.eye[0] - 3 : FW / 2;
  const filled = (x: number, y: number) => y >= 0 && y < FH && x >= 0 && x < FW && grid[y][x] !== ".";
  // the drop shadow first
  g.fillStyle = SHADOW;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (!filled(x, y) && filled(x - 1, y - 1)) g.fillRect(ox + x, y, 1, 1);
  // fur along the right and bottom edges is a shade darker, as if lit from the top left
  const edge = (x: number, y: number) => !filled(x, y) || grid[y][x] === "o";
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      const ch = grid[y][x];
      let c = dotColor(coat, ch, x, y, f.top, faceX);
      if (!c) continue;
      if ("kwctl".includes(ch) && (edge(x + 1, y) || edge(x, y + 1))) c = shade(c);
      // gloom: a pale blue shadow over the forehead
      if (feel === "gloom" && f.front && "kwp".includes(ch) && y < f.front.eyeY) c = "#b9d3e0";
      g.fillStyle = c;
      g.fillRect(ox + x, y, 1, 1);
    }
  // right edge of the head, for the sign over it
  let right = 0;
  for (let y = f.top; y < f.top + 6 && y < FH; y++) for (let x = 0; x < FW; x++) if (filled(x, y)) right = Math.max(right, x);
  for (const [x, y, ink] of faceDots(feel, f.front, f.side, !!f.asleep, f.top, right - 3)) {
    if (x < 0 || x >= FW || y < 0 || y >= FH) continue;
    g.fillStyle = ink === "line" ? coat.line : ink === "eye" ? coat.eye : INK[ink];
    g.fillRect(ox + x, y, 1, 1);
  }
}

/** a strip of `frames` of `row` (as a data: URL), FW·n × FH dots */
export function strip(coat: Coat, row: Row, frames: number[], feel: Feel): string {
  const key = `${coat.id}|${row}|${frames.join("")}|${feel}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = FW * frames.length;
  c.height = FH;
  const g = c.getContext("2d");
  if (!g) return "";
  frames.forEach((i, n) => paint(g, coat, row, i, feel, n * FW));
  const url = c.toDataURL("image/png");
  cache.set(key, url);
  return url;
}
