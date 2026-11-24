// The "drawing" show: when the team's change is loaded into the editor, a critter looks like it
// draws it. Right before the reload we lay a picture of the editor as it was (the "cover") over the
// frame; after the reload we find what changed and peel the cover away along the critter's pen:
// an outline then a fill for new or moved things, left-to-right typing for text, brush strokes for
// a color change. The engine already shows the real result underneath, and the cover is always
// removed at the end, so the screen ends exactly as the engine has it.
//
// EngineStage calls stageDirector.before(frame) just before it loads the team's copy and
// stageDirector.after(frame) once loaded. Only that path (team changes) gets a show: the person's
// own edits never go through it. Nothing happens unless an editor overlay attached a cast
// (EditorCritters), which says whether critters are on and motion is allowed.
import { critters } from "../components/critters";
import { diff, readModel, restoreView, type Change, type Model } from "./changes";
import { deckApi, engineView, figApi, type Box, type Spot } from "./locate";

export interface ShowCast {
  engine: string;
  layer: string;
  /** the overlay box over the frame; the cover and ink canvases live in it */
  box: HTMLElement;
  cover: HTMLCanvasElement;
  ink: HTMLCanvasElement;
  caret: HTMLElement;
  /** critters on, no reduced motion, overlay visible */
  enabled(): boolean;
  /** who draws the i-th change (critter id and its pen color) */
  drawer(i: number): { id: string; color: string } | null;
  /** where a critter stands now */
  where(id: string): Spot | undefined;
  /** a critter is busy drawing (the wandering leaves it alone) */
  busy(id: string, on: boolean): void;
}

/** the whole show never runs longer than this */
const BUDGET_MS = 5000;
const MAX_SHOWN = 8;
const HARD_STOP_MS = 9000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

let cast: ShowCast | null = null;
let pending: { model: Model; frame: Window } | null = null;
/** the show playing now; `stop()` ends it at once (screen = engine) */
let current: { stopped: boolean; stop(): void } | null = null;

function sizeCanvas(c: HTMLCanvasElement, box: HTMLElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = box.clientWidth;
  const h = box.clientHeight;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

function hide(c: ShowCast) {
  for (const el of [c.cover, c.ink]) {
    el.style.transition = "";
    el.style.opacity = "0";
    el.getContext("2d")?.clearRect(0, 0, el.width, el.height);
  }
  c.caret.style.opacity = "0";
}

/** a picture of the editor as it is now, onto the cover (false: the engine gave none) */
async function snapshot(c: ShowCast, frame: Window): Promise<boolean> {
  const g = sizeCanvas(c.cover, c.box);
  const canvas = frame.document.querySelector("canvas");
  if (canvas) {
    const r = canvas.getBoundingClientRect();
    try {
      g.drawImage(canvas, r.x, r.y, r.width, r.height);
      const d = g.getImageData(0, 0, c.cover.width, c.cover.height).data;
      // a canvas that kept nothing reads back empty: then ask the engine for a picture
      let seen = 0;
      for (let i = 3; i < d.length; i += 4 * 997) seen += d[i];
      if (seen > 0) return true;
    } catch {
      // fall through to the engine's own screenshot
    }
  }
  const api = figApi(frame) ?? deckApi(frame);
  const shot = (await (api as { screenshot?: (p?: object) => Promise<unknown> } | undefined)?.screenshot?.({ window: true }).catch(() => null)) as { data?: string } | null;
  if (!shot?.data) return false;
  const img = new Image();
  img.src = `data:image/png;base64,${shot.data}`;
  await img.decode().catch(() => undefined);
  if (!img.width) return false;
  g.clearRect(0, 0, c.box.clientWidth, c.box.clientHeight);
  g.drawImage(img, 0, 0, c.box.clientWidth, c.box.clientHeight);
  return true;
}

/** keep the cover only over the changed areas: everything else shows the engine at once */
function keepOnly(c: ShowCast, rects: Box[]) {
  const g = c.cover.getContext("2d")!;
  g.save();
  g.globalCompositeOperation = "destination-in";
  g.beginPath();
  for (const r of rects) g.rect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
  g.fillStyle = "#000";
  g.fill();
  g.restore();
}

/** a polyline walked by length */
function along(points: Spot[]) {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    seg.push(l);
    total += l;
  }
  return {
    total,
    at(len: number): Spot {
      let l = clamp(len, 0, total);
      for (let i = 0; i < seg.length; i++) {
        if (l <= seg[i] || i === seg.length - 1) {
          const t = seg[i] ? l / seg[i] : 0;
          return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
        }
        l -= seg[i];
      }
      return points[points.length - 1];
    },
  };
}

/** zigzag rows over a box (brush strokes) */
function zigzag(r: Box, rows: number): Spot[] {
  const out: Spot[] = [];
  const h = r.h / rows;
  for (let i = 0; i < rows; i++) {
    const y = r.y + h * (i + 0.5);
    const ltr = i % 2 === 0;
    out.push({ x: ltr ? r.x : r.x + r.w, y }, { x: ltr ? r.x + r.w : r.x, y: y + h * 0.15 });
  }
  return out;
}

/** how long a change takes to draw, before fitting the whole show in the budget */
function pace(ch: Change) {
  const r = ch.rect;
  if (r.w < 14 || r.h < 14) return 260;
  if (ch.kind === "draw") return clamp(500 + (r.w + r.h) * 0.9, 700, 1700);
  if (ch.kind === "type") return clamp(250 + ch.chars * 30 + ch.lines * 120, 450, 1600);
  return clamp(450 + (r.w * r.h) / 600, 550, 1200);
}

/** feet a little below and left of the pen tip, so the critter seems to hold the pen */
const feet = (p: Spot): Spot => ({ x: p.x - 7, y: p.y + 13 });

function frameLoop(ms: number, show: { stopped: boolean }, step: (t: number) => void) {
  return new Promise<void>((done) => {
    const t0 = performance.now();
    const tick = (now: number) => {
      if (show.stopped) return done();
      const t = Math.min(1, (now - t0) / ms);
      step(t);
      if (t < 1) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
}

async function play(c: ShowCast, changes: Change[], show: { stopped: boolean }, used: Set<string>) {
  const cover = c.cover.getContext("2d")!;
  const ink = sizeCanvas(c.ink, c.box);
  c.ink.style.opacity = "1";
  const shown = changes.slice(0, MAX_SHOWN);
  // past the limit: just appear
  for (const ch of changes.slice(MAX_SHOWN)) cover.clearRect(ch.rect.x - 3, ch.rect.y - 3, ch.rect.w + 6, ch.rect.h + 6);
  const want = shown.map(pace);
  const sum = want.reduce((a, b) => a + b, 0) + shown.length * 300;
  const fit = sum > BUDGET_MS ? BUDGET_MS / sum : 1;

  for (let i = 0; i < shown.length && !show.stopped; i++) {
    const ch = shown[i];
    const r = ch.rect;
    const who = c.drawer(i);
    const ms = Math.max(320, want[i] * fit);
    const trace = (p: Spot) => who && critters.trace(who.id, feet(p).x, feet(p).y, c.layer);
    const color = who?.color ?? "#e8a15a";
    if (who && !used.has(who.id)) {
      used.add(who.id);
      c.busy(who.id, true);
      critters.say(who.id, "", c.layer);
    }

    // walk over to where the pen starts
    const start: Spot = ch.kind === "type" ? { x: r.x, y: r.y + r.h / Math.max(1, ch.lines) } : ch.round && ch.kind === "draw" ? { x: r.x + r.w / 2, y: r.y } : { x: r.x, y: r.y };
    const from = (who && c.where(who.id)) || feet(start);
    if (who) {
      critters.setState(who.id, "walk", c.layer);
      const d = Math.hypot(from.x - feet(start).x, from.y - feet(start).y);
      const go = clamp(d / 1.1, 120, 300 * fit + 60);
      await frameLoop(go, show, (t) => {
        const e = ease(t);
        const f = feet(start);
        critters.trace(who.id, from.x + (f.x - from.x) * e, from.y + (f.y - from.y) * e, c.layer);
      });
      critters.setState(who.id, "work", c.layer);
    }
    if (show.stopped) break;

    // reveal only this change: where a later change overlaps it, that one stays covered for its turn
    cover.save();
    cover.beginPath();
    cover.rect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
    for (const later of shown.slice(i + 1)) {
      const q = later.rect;
      if (q.x - 3 < r.x + r.w + 3 && q.x + q.w + 3 > r.x - 3 && q.y - 3 < r.y + r.h + 3 && q.y + q.h + 3 > r.y - 3) cover.rect(q.x - 3, q.y - 3, q.w + 6, q.h + 6);
    }
    cover.clip("evenodd");
    cover.globalCompositeOperation = "destination-out";
    cover.lineCap = "round";
    cover.lineJoin = "round";

    if (r.w < 14 || r.h < 14) {
      // too small to trace: a quick dab
      await frameLoop(ms, show, (t) => {
        cover.clearRect(r.x - 3, r.y - 3, (r.w + 6) * ease(t), r.h + 6);
        trace({ x: r.x + r.w * t, y: r.y + r.h / 2 });
      });
    } else if (ch.kind === "draw") {
      // 1) the outline, with a pen line; 2) filled in with brush strokes
      const edge = along(
        ch.round
          ? // an ellipse: round the outline, starting at the top
            Array.from({ length: 49 }, (_, k) => {
              const a = -Math.PI / 2 + (k / 48) * Math.PI * 2;
              return { x: r.x + r.w / 2 + (Math.cos(a) * r.w) / 2, y: r.y + r.h / 2 + (Math.sin(a) * r.h) / 2 };
            })
          : [
              { x: r.x, y: r.y },
              { x: r.x + r.w, y: r.y },
              { x: r.x + r.w, y: r.y + r.h },
              { x: r.x, y: r.y + r.h },
              { x: r.x, y: r.y },
            ],
      );
      const band = clamp(Math.min(r.w, r.h) * 0.18, 5, 16);
      let prev = 0;
      ink.strokeStyle = color;
      ink.lineWidth = 2.4;
      ink.lineCap = "round";
      ink.lineJoin = "round";
      await frameLoop(ms * 0.5, show, (t) => {
        const len = edge.total * ease(t);
        const a = edge.at(prev);
        const b = edge.at(len);
        cover.lineWidth = band;
        cover.beginPath();
        cover.moveTo(a.x, a.y);
        for (let l = prev + 4; l < len; l += 4) cover.lineTo(edge.at(l).x, edge.at(l).y);
        cover.lineTo(b.x, b.y);
        cover.stroke();
        // the pen line keeps its corners: draw through the points passed
        ink.beginPath();
        ink.moveTo(a.x, a.y);
        for (let l = prev + 6; l < len; l += 6) ink.lineTo(edge.at(l).x, edge.at(l).y);
        ink.lineTo(b.x, b.y);
        ink.stroke();
        prev = len;
        trace(b);
      });
      const rows = Math.max(1, Math.ceil(r.h / 42));
      const fill = along(zigzag(r, rows));
      prev = 0;
      await frameLoop(ms * 0.5, show, (t) => {
        const len = fill.total * t;
        cover.lineWidth = r.h / rows + 6;
        cover.beginPath();
        cover.moveTo(fill.at(prev).x, fill.at(prev).y);
        for (let l = prev + 8; l < len; l += 8) cover.lineTo(fill.at(l).x, fill.at(l).y);
        cover.lineTo(fill.at(len).x, fill.at(len).y);
        cover.stroke();
        prev = len;
        trace(fill.at(len));
      });
    } else if (ch.kind === "type") {
      // typed in, a line at a time, left to right in letter-sized steps
      const n = Math.max(1, ch.lines);
      const lh = r.h / n;
      // the old words (or a placeholder prompt) go first, as if selected and deleted: the box takes
      // its background color, then the new text is typed in
      {
        const dpr = c.cover.width / Math.max(1, c.box.clientWidth);
        const px = cover.getImageData(Math.round((r.x + 1) * dpr), Math.round((r.y + 1) * dpr), 1, 1).data;
        if (px[3] > 0) {
          cover.save();
          cover.globalCompositeOperation = "source-over";
          cover.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`;
          cover.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
          cover.restore();
          if (ch.retype) await frameLoop(140, show, () => undefined);
        }
      }
      const step = clamp(lh * 0.55, 5, 14);
      // a text cursor about one line of type tall (a slide's text box can be much taller than its text)
      const caretH = clamp(lh * 0.9, 10, 30);
      c.caret.style.height = `${caretH}px`;
      c.caret.style.background = color;
      c.caret.style.opacity = "1";
      for (let k = 0; k < n && !show.stopped; k++) {
        const top = r.y + lh * k;
        let shownW = 0;
        await frameLoop(ms / n, show, (t) => {
          const w = Math.min(r.w, Math.ceil((r.w * t) / step) * step);
          if (w > shownW) {
            cover.clearRect(r.x - 3, top - (k === 0 ? 3 : 0), w + 3, lh + (k === n - 1 ? 6 : 0));
            shownW = w;
          }
          c.caret.style.transform = `translate(${r.x + w}px, ${top + (lh - caretH) / 2}px)`;
          trace({ x: r.x + w, y: top + lh });
        });
        cover.clearRect(r.x - 3, top - 3, r.w + 6, lh + 6);
      }
      c.caret.style.opacity = "0";
    } else {
      // paint / erase: broad brush strokes back and forth
      const brush = clamp(r.h / 3, 12, 56);
      const rows = Math.max(1, Math.round(r.h / brush));
      const path = along(zigzag(r, rows));
      let prev = 0;
      await frameLoop(ms, show, (t) => {
        const len = path.total * t;
        cover.lineWidth = (r.h / rows) * 1.35;
        cover.beginPath();
        cover.moveTo(path.at(prev).x, path.at(prev).y);
        for (let l = prev + 8; l < len; l += 8) cover.lineTo(path.at(l).x, path.at(l).y);
        cover.lineTo(path.at(len).x, path.at(len).y);
        cover.stroke();
        prev = len;
        trace(path.at(len));
      });
    }
    // whatever the brush missed
    cover.clearRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
    cover.restore();
  }

  // a little hop from everyone who drew, then back to wandering
  for (const id of used) {
    critters.setState(id, "done", c.layer);
  }
  if (!show.stopped) await sleep(500);
}

/** end the show: screen = engine; critters go back to what they were doing */
function finish(c: ShowCast, used: Set<string>) {
  c.caret.style.opacity = "0";
  for (const el of [c.cover, c.ink]) {
    el.style.transition = "opacity 220ms ease-out";
    el.style.opacity = "0";
  }
  setTimeout(() => {
    for (const el of [c.cover, c.ink]) {
      el.getContext("2d")?.clearRect(0, 0, el.width, el.height);
      el.style.transition = "";
    }
  }, 240);
  for (const id of used) {
    critters.setState(id, null, c.layer);
    critters.say(id, null, c.layer);
    c.busy(id, false);
  }
}

export const stageDirector = {
  attach(c: ShowCast) {
    cast = c;
  },
  detach(c: ShowCast) {
    if (cast !== c) return;
    current?.stop();
    hide(c);
    cast = null;
    pending = null;
  },
  /** just before the team's copy is loaded: remember the document and cover the editor */
  async before(frame: Window) {
    current?.stop();
    pending = null;
    const c = cast;
    if (!c || !c.enabled()) return;
    try {
      const model = await readModel(c.engine, frame);
      if (!model || !(await snapshot(c, frame))) return hide(c);
      c.cover.style.transition = "";
      c.cover.style.opacity = "1";
      pending = { model, frame };
    } catch {
      hide(c);
    }
  },
  /** once loaded: find what changed and draw it */
  async after(frame: Window) {
    const c = cast;
    const was = pending;
    pending = null;
    if (!c || !was || was.frame !== frame) return c && hide(c);
    const used = new Set<string>();
    const show = {
      stopped: false,
      stop() {
        if (this.stopped) return;
        this.stopped = true;
        finish(c, used);
      },
    };
    current = show;
    const hardStop = setTimeout(() => show.stop(), HARD_STOP_MS);
    // the person reaches for the editor: get out of the way at once
    const interrupt = () => show.stop();
    frame.addEventListener("pointerdown", interrupt, true);
    frame.addEventListener("keydown", interrupt, true);
    try {
      // let the engine draw the new copy, then look where the person was looking
      await sleep(60);
      await restoreView(was.model, frame);
      await sleep(160);
      const [now, view] = await Promise.all([readModel(c.engine, frame), engineView(c.engine, frame)]);
      const changes = now && view ? diff(was.model, now, view) : [];
      if (!changes.length || show.stopped) return;
      // deckcraft's slide thumbnails would show the result early: they stay covered until the end
      const side = c.engine === "deckcraft" && view ? [{ x: 0, y: view.area.y, w: view.area.x, h: view.area.h }] : [];
      keepOnly(c, [...changes.map((x) => x.rect), ...side]);
      await play(c, changes, show, used);
    } catch {
      // any trouble: just show the engine
    } finally {
      clearTimeout(hardStop);
      frame.removeEventListener("pointerdown", interrupt, true);
      frame.removeEventListener("keydown", interrupt, true);
      show.stop();
      if (current === show) current = null;
    }
  },
};
