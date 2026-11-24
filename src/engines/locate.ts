// Where on the editing screen a member's engine call lands, and one plain line saying what it does.
// Positions are CSS pixels inside the editor's frame (its top-left is 0,0).
//
// figcraft (docs/control-protocol.md): `node.get {id}` → absoluteBounds in page units;
//   `view.get` (a command) → {cx, cy, zoom}; `ui.inspect` → canvas.rect [minX, minY, maxX, maxY].
//   screen = canvas.min + (page − (c − size/2/zoom)) · zoom
// deckcraft: `ui.inspect` → slideRect [left, top, w, h] + canvasScale (slide points → screen);
//   `slide.inspect {index}` → shapes [{id, box: [x, y, w, h], name, placeholder}]; `docInspect`
//   → selection.slide (the slide shown) and the slide count.
import type { EngineCall } from "../lib/api";

export interface Spot {
  x: number;
  y: number;
}

/** where a call lands (null: nothing on screen to point at) and what it touches */
export interface Found {
  spot: Spot | null;
  /** "제목", "본문", a node's name… */
  label?: string;
  /** deckcraft: the slide (0-based) the target is on */
  slide?: number;
}

const short = (t: string, n = 14) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const PLACEHOLDER: Record<string, string> = { title: "제목", ctrTitle: "제목", subTitle: "부제목", body: "본문", obj: "본문", pic: "그림", tbl: "표", chart: "차트" };

type Rec = Record<string, unknown>;
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
/** engine points → CSS pixels: the UI scale it draws at (a number, or {drawn} — 2 on a Retina screen) */
const scaleOf = (v: unknown) => num(v) ?? num(obj(v).drawn) ?? 1;

/** the call's arguments, with run_command/batch unwrapped to the (first) inner command */
function unwrap(call: EngineCall): { name: string; args: Rec } {
  const input = obj(call.input);
  if (call.tool === "run_command") return { name: String(input.command ?? ""), args: obj(input.params) };
  if (call.tool === "batch") {
    const first = arr(input.commands).map(obj).find((c) => c.command);
    if (first) return { name: String(first.command), args: obj(first.params) };
  }
  return { name: call.tool, args: input };
}

/** node or shape ids the call points at */
function idsOf(args: Rec): number[] {
  const out: number[] = [];
  for (const k of ["ids", "id", "parent", "node", "nodeId", "shape", "shapeId"]) {
    const v = args[k];
    for (const x of Array.isArray(v) ? v : [v]) {
      const n = num(x) ?? (typeof x === "string" && /^\d+$/.test(x) ? Number(x) : undefined);
      if (n != null) out.push(n);
    }
  }
  return out;
}

const slideOf = (args: Rec): number | undefined => num(args.index) ?? num(args.slide) ?? num(args.slideIndex);

// ── figcraft ──────────────────────────────────────────────────────────

interface FigApi {
  request(method: string, params?: object): Promise<unknown>;
  execute(command: string, params?: object): Promise<unknown>;
}

async function figView(fc: FigApi) {
  const [view, ui] = await Promise.all([fc.execute("view.get", {}).then(obj), fc.request("ui.inspect", {}).then(obj)]);
  const rect = arr(obj(ui.canvas).rect).map(Number);
  const zoom = num(view.zoom);
  const cx = num(view.cx);
  const cy = num(view.cy);
  if (rect.length !== 4 || !zoom || cx == null || cy == null) return null;
  const s = scaleOf(ui.uiScale);
  const [x0, y0, x1, y1] = rect;
  const vw = x1 - x0;
  const vh = y1 - y0;
  const ox = cx - vw / 2 / zoom;
  const oy = cy - vh / 2 / zoom;
  return {
    toScreen: (px: number, py: number): Spot => ({ x: (x0 + (px - ox) * zoom) * s, y: (y0 + (py - oy) * zoom) * s }),
    clamp: (p: Spot): Spot => ({ x: Math.min(x1 * s - 20, Math.max(x0 * s + 20, p.x)), y: Math.min(y1 * s - 8, Math.max(y0 * s + 44, p.y)) }),
  };
}

async function locateFig(w: Window, call: EngineCall): Promise<Found> {
  const fc = (w as Window & { figcraft?: FigApi }).figcraft;
  if (!fc) return { spot: null };
  const { args } = unwrap(call);
  const v = await figView(fc);
  if (!v) return { spot: null };
  for (const id of idsOf(args)) {
    const node = obj(await fc.request("node.get", { id, depth: 0 }).catch(() => null));
    const b = obj(node.absoluteBounds);
    const x = num(b.x);
    const y = num(b.y);
    if (x == null || y == null) continue;
    const width = num(b.width) ?? 0;
    const height = num(b.height) ?? 0;
    // stand on the node's middle (its top area for tall frames), kept inside the canvas
    const label = typeof node.name === "string" && node.name ? `'${short(node.name)}'` : undefined;
    return { spot: v.clamp(v.toScreen(x + width / 2, y + Math.min(height / 2, 60 / 1))), label };
  }
  // a new node or a pointer gesture: page coordinates in the call
  const x = num(args.x);
  const y = num(args.y);
  if (x != null && y != null) return { spot: v.clamp(v.toScreen(x + (num(args.width) ?? 0) / 2, y + (num(args.height) ?? 0) / 2)) };
  return { spot: null };
}

// ── deckcraft ─────────────────────────────────────────────────────────

interface DeckApi {
  request(method: string, params?: object): Promise<unknown>;
  execute(command: string, params?: object): Promise<unknown>;
  docInspect(params?: object): Promise<unknown>;
  uiInspect(params?: object): Promise<unknown>;
}

async function locateDeck(w: Window, call: EngineCall, slide?: number): Promise<Found> {
  const dc = (w as Window & { deckcraft?: DeckApi }).deckcraft;
  if (!dc) return { spot: null, slide };
  const [doc, ui] = await Promise.all([dc.docInspect({}).then(obj), dc.uiInspect({}).then(obj)]);
  const shown = num(obj(doc.selection).slide) ?? 0;
  const count = arr(doc.slides).length;
  const r = arr(ui.slideRect).map(Number);
  const k = num(ui.canvasScale);
  if (r.length !== 4 || !k) return { spot: null, slide };
  // `window` is the frame's size in engine points (half the CSS size on a Retina screen)
  const pw = num(arr(ui.window)[0]);
  const s = pw ? w.innerWidth / pw : scaleOf(obj(ui.ui).uiScale ?? ui.uiScale);
  const at = (x: number, y: number): Spot => ({ x: (r[0] + x * k) * s, y: (r[1] + y * k) * s });
  const { args } = unwrap(call);

  const ids = idsOf(args);
  if (ids.length) {
    // the shown slide first, then the rest: shape ids are unique in the deck
    const order = [shown, ...Array.from({ length: count }, (_, i) => i).filter((i) => i !== shown)];
    for (const index of order) {
      const sl = obj(await dc.execute("slide.inspect", { index }).catch(() => null));
      const hit = arr(sl.shapes).map(obj).find((sh) => ids.includes(num(sh.id) ?? -1));
      if (!hit) continue;
      const label = PLACEHOLDER[String(hit.placeholder ?? "")] ?? (typeof hit.name === "string" ? `'${short(hit.name)}'` : undefined);
      // on a slide the person isn't looking at: work at the edge
      if (index !== shown) return { spot: null, label, slide: index };
      const [x, y, bw, bh] = arr(hit.box).map(Number);
      return { spot: at(x + (bw || 0) / 2, y + Math.min((bh || 0) / 2, 60)), label, slide: index };
    }
    return { spot: null, slide };
  }
  // a slide-wide action (go to, inspect, render) on the slide shown: stand on its top middle
  const target = slideOf(args) ?? slide;
  if (target != null && target !== shown) return { spot: null, slide: target };
  const x = num(args.x);
  const y = num(args.y);
  if (x != null && y != null) return { spot: at(x + (num(args.w) ?? 0) / 2, y + (num(args.h) ?? 0) / 2), slide: shown };
  if (target === shown) return { spot: at(480, 70), slide: shown };
  return { spot: null, slide: target };
}

/** Where the call lands in the frame (spot null when there is nothing on screen to point at). */
export function locate(engine: string, frame: Window, call: EngineCall, slide?: number): Promise<Found> {
  if (engine === "figcraft") return locateFig(frame, call);
  if (engine === "deckcraft") return locateDeck(frame, call, slide);
  return Promise.resolve({ spot: null });
}

/** deckcraft: the slide (0-based) an agent is on after these calls, from go_to/inspect/add calls */
export function deckSlide(calls: EngineCall[]): number | undefined {
  let cur: number | undefined;
  for (const c of calls) {
    const { name, args } = unwrap(c);
    const i = slideOf(args);
    if (name === "go_to_slide" || name === "slide.goto") cur = i ?? cur;
    else if (name === "add_slide") cur = cur != null ? cur + 1 : cur;
    else if (i != null && /slide/.test(name)) cur = i;
  }
  return cur;
}

// ── one plain line ────────────────────────────────────────────────────

const PROP: Record<string, string> = {
  fills: "색",
  fill: "색",
  color: "색",
  strokes: "테두리",
  line: "테두리",
  characters: "글자",
  text: "글자",
  fontSize: "글자 크기",
  fontName: "글꼴",
  size: "크기",
  width: "크기",
  height: "크기",
  x: "위치",
  y: "위치",
  name: "이름",
  opacity: "투명도",
  cornerRadius: "모서리",
  effects: "효과",
  visible: "보이기",
  layoutMode: "자동 정렬",
};

const NODE: Record<string, string> = { FRAME: "프레임", TEXT: "글자", RECTANGLE: "네모", ELLIPSE: "동그라미", LINE: "선", COMPONENT: "컴포넌트", GROUP: "묶음" };

const what = (props: Rec) => {
  const keys = (Array.isArray(props.keys) ? props.keys : Object.keys(props)).map(String).filter((k) => k !== "keys");
  const words = [...new Set(keys.map((k) => PROP[k]).filter(Boolean))].slice(0, 2);
  return words.length ? `${words.join("·")} ` : "";
};

/** "3번 슬라이드 제목 고치는 중" — what the call does, in a few plain words */
export function describeCall(call: EngineCall, found?: Omit<Found, "spot">): string {
  const { name, args } = unwrap(call);
  const n = found?.slide ?? slideOf(args);
  const label = found?.label;
  const onSlide = n != null ? `${n + 1}번 슬라이드 ` : "";
  if (call.engine === "deckcraft") {
    switch (name) {
      case "set_text":
        return `${onSlide}${label ?? "글자"} 고치는 중`;
      case "go_to_slide":
        return `${onSlide}로 가는 중`.replace("슬라이드 로", "슬라이드로");
      case "inspect_slide":
      case "render_slide":
      case "slide.inspect":
        return `${onSlide}살펴보는 중`;
      case "add_slide":
        return "슬라이드 추가하는 중";
      case "add_shape":
        return `${onSlide}도형 넣는 중`;
      case "add_text_box":
        return `${onSlide}글상자 넣는 중`;
      case "insert_picture":
        return `${onSlide}그림 넣는 중`;
      case "insert_table":
        return `${onSlide}표 넣는 중`;
      case "insert_chart":
        return `${onSlide}차트 넣는 중`;
      case "save_presentation":
        return "저장하는 중";
      case "select":
        return `${onSlide}고를 것 찾는 중`;
      case "inspect_document":
      case "screenshot":
        return "발표 자료 살펴보는 중";
      default:
        return `${onSlide}고치는 중`;
    }
  }
  switch (name) {
    case "set_properties":
    case "node.set":
      return `${label ? `${label} ` : ""}${what(obj(args.props))}바꾸는 중`;
    case "create_node":
      return `${NODE[String(args.type ?? "").toUpperCase()] ?? "요소"} 만드는 중`;
    case "type_text":
      return `${label ? `${label}에 ` : ""}글자 쓰는 중`;
    case "select":
      return "고를 것 찾는 중";
    case "get_node":
    case "inspect_document":
    case "inspect_ui":
    case "screenshot":
      return "살펴보는 중";
    case "export":
      return "내보내는 중";
    case "open_file":
      return "파일 여는 중";
    case "save_file":
      return "저장하는 중";
    case "undo":
      return "되돌리는 중";
    case "pointer":
      return "그리는 중";
    default:
      if (name.startsWith("align.")) return "줄 맞추는 중";
      if (name === "edit.duplicate") return "복제하는 중";
      if (name === "edit.delete") return "지우는 중";
      return "디자인 고치는 중";
  }
}

// ── the editor's view, for anything drawn over it ─────────────────────

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How the engine shows its document right now, in CSS pixels of the frame. */
export interface EngineView {
  /** document point (figcraft page units, deckcraft slide points) → frame pixels */
  toScreen(x: number, y: number): Spot;
  /** frame pixels per document unit */
  unit: number;
  /** where the canvas is (the area critters may wander) */
  area: Box;
  /** deckcraft: the slide shown (0-based) */
  shown?: number;
}

export const figApi = (w: Window) => (w as Window & { figcraft?: FigApi }).figcraft;
export const deckApi = (w: Window) => (w as Window & { deckcraft?: DeckApi }).deckcraft;

export async function engineView(engine: string, w: Window): Promise<EngineView | null> {
  if (engine === "figcraft") {
    const fc = figApi(w);
    if (!fc) return null;
    const [view, ui] = await Promise.all([fc.execute("view.get", {}).then(obj), fc.request("ui.inspect", {}).then(obj)]);
    const rect = arr(obj(ui.canvas).rect).map(Number);
    const zoom = num(view.zoom);
    const cx = num(view.cx);
    const cy = num(view.cy);
    if (rect.length !== 4 || !zoom || cx == null || cy == null) return null;
    const s = scaleOf(ui.uiScale);
    const [x0, y0, x1, y1] = rect;
    const ox = cx - (x1 - x0) / 2 / zoom;
    const oy = cy - (y1 - y0) / 2 / zoom;
    return {
      toScreen: (px, py) => ({ x: (x0 + (px - ox) * zoom) * s, y: (y0 + (py - oy) * zoom) * s }),
      unit: zoom * s,
      area: { x: x0 * s, y: y0 * s, w: (x1 - x0) * s, h: (y1 - y0) * s },
    };
  }
  if (engine === "deckcraft") {
    const dc = deckApi(w);
    if (!dc) return null;
    const [doc, ui] = await Promise.all([dc.docInspect({}).then(obj), dc.uiInspect({}).then(obj)]);
    const r = arr(ui.slideRect).map(Number);
    const c = arr(ui.canvasRect).map(Number);
    const k = num(ui.canvasScale);
    if (r.length !== 4 || c.length !== 4 || !k) return null;
    const pw = num(arr(ui.window)[0]);
    const s = pw ? w.innerWidth / pw : scaleOf(obj(ui.ui).uiScale ?? ui.uiScale);
    return {
      toScreen: (x, y) => ({ x: (r[0] + x * k) * s, y: (r[1] + y * k) * s }),
      unit: k * s,
      area: { x: c[0] * s, y: c[1] * s, w: c[2] * s, h: c[3] * s },
      shown: num(obj(doc.selection).slide) ?? 0,
    };
  }
  return null;
}
