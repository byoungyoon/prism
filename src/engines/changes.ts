// What the team changed in the open file, found by comparing the engine's document before and
// after the team's copy is loaded. Each change gets a way to be "drawn" by a critter:
//   draw  — a new or moved/resized thing: trace its outline, then fill it in
//   type  — new or changed text: revealed left to right, line by line
//   paint — a color (or other look) change: brushed over
//   erase — something removed: brushed away
import { arr, deckApi, engineView, figApi, num, obj, type Box, type EngineView } from "./locate";

export type DrawKind = "draw" | "type" | "paint" | "erase";

interface Item {
  id: string;
  parent?: string;
  type: string;
  /** in document units */
  box: Box;
  geom: string;
  text: string;
  look: string;
  /** text line height in document units, when known */
  line?: number;
  round?: boolean;
}

/** what the engine shows, and where it was looking (to look there again after a reload) */
export interface Model {
  engine: string;
  items: Map<string, Item>;
  view: Record<string, unknown>;
}

export interface Change {
  id: string;
  kind: DrawKind;
  /** in frame pixels */
  rect: Box;
  /** text lines, for "type" */
  lines: number;
  /** length of the text, for "type" pacing */
  chars: number;
  /** an ellipse: its outline is drawn round */
  round: boolean;
  /** text that replaces other text (the old words are wiped first) */
  retype: boolean;
}

const round = (b: Box) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`;
const OWN = new Set(["children", "childCount", "absoluteBounds", "x", "y", "width", "height", "fills", "strokes", "characters", "id", "boundVariables"]);

function figItems(doc: Record<string, unknown>): Map<string, Item> {
  const out = new Map<string, Item>();
  const pages = arr(doc.pages).map(obj);
  const page = pages.find((p) => p.id === doc.currentPage) ?? pages[0];
  const walk = (n: Record<string, unknown>, parent?: string) => {
    const id = String(n.id);
    const b = obj(n.absoluteBounds);
    const box = { x: num(b.x) ?? 0, y: num(b.y) ?? 0, w: num(b.width) ?? 0, h: num(b.height) ?? 0 };
    const rest = Object.fromEntries(Object.entries(n).filter(([k]) => !OWN.has(k)));
    const size = num(n.fontSize);
    const lh = typeof n.lineHeight === "string" && n.lineHeight.endsWith("%") ? (parseFloat(n.lineHeight) / 100) * (size ?? 0) : num(n.lineHeight);
    out.set(id, {
      id,
      parent,
      type: String(n.type ?? ""),
      box,
      geom: round(box),
      text: typeof n.characters === "string" ? n.characters : "",
      look: JSON.stringify([n.fills, n.strokes]),
      line: lh || (size ? size * 1.25 : undefined),
      round: n.type === "ELLIPSE",
    });
    // other props (corner radius, effects…) count as a look change
    const it = out.get(id)!;
    it.look += JSON.stringify(rest);
    arr(n.children).map(obj).forEach((c) => walk(c, id));
  };
  if (page) arr(page.children).map(obj).forEach((c) => walk(c));
  return out;
}

function deckItems(slide: Record<string, unknown>): Map<string, Item> {
  const out = new Map<string, Item>();
  for (const sh of arr(slide.shapes).map(obj)) {
    const id = String(sh.id);
    const [x, y, w, h] = arr(sh.box).map(Number);
    const box = { x: x || 0, y: y || 0, w: w || 0, h: h || 0 };
    const rest = Object.fromEntries(Object.entries(sh).filter(([k]) => !["box", "text", "id"].includes(k)));
    out.set(id, { id, type: String(sh.kind ?? ""), box, geom: round(box), text: typeof sh.text === "string" ? sh.text : "", look: JSON.stringify(rest), round: /ellipse|oval|circle/i.test(String(sh.preset ?? "")) });
  }
  return out;
}

/** The document as shown now (null when the engine can't say). */
export async function readModel(engine: string, w: Window): Promise<Model | null> {
  if (engine === "figcraft") {
    const fc = figApi(w);
    if (!fc) return null;
    const [doc, view] = await Promise.all([fc.request("document.inspect", { depth: 64 }).then(obj), fc.execute("view.get", {}).then(obj)]);
    return { engine, items: figItems(doc), view: { cx: view.cx, cy: view.cy, zoom: view.zoom, page: doc.currentPage } };
  }
  if (engine === "deckcraft") {
    const dc = deckApi(w);
    if (!dc) return null;
    const doc = obj(await dc.docInspect({}));
    const index = num(obj(doc.selection).slide) ?? 0;
    const slide = obj(await dc.execute("slide.inspect", { index }));
    return { engine, items: deckItems(slide), view: { index } };
  }
  return null;
}

/** After a reload: look at the same place as before (a reload otherwise resets the view). */
export async function restoreView(model: Model, w: Window) {
  const v = model.view;
  if (model.engine === "figcraft") {
    const fc = figApi(w);
    if (fc && num(v.zoom)) await fc.execute("view.set", { cx: v.cx, cy: v.cy, zoom: v.zoom }).catch(() => undefined);
  } else if (model.engine === "deckcraft") {
    const dc = deckApi(w);
    if (dc && num(v.index) != null) await dc.execute("slide.go", { index: v.index }).catch(() => undefined);
  }
}

const NEW_TEXT = new Set(["TEXT", "textbox", "text"]);

/** What changed, in drawing order (top to bottom, left to right), mapped onto the screen. */
export function diff(before: Model, after: Model, view: EngineView): Change[] {
  const found: { item: Item; kind: DrawKind; retype?: boolean }[] = [];
  for (const [id, it] of after.items) {
    const old = before.items.get(id);
    if (!old) found.push({ item: it, kind: NEW_TEXT.has(it.type) || (before.engine === "deckcraft" && it.text && it.type !== "shape") ? "type" : "draw" });
    else if (old.geom !== it.geom) found.push({ item: it, kind: "draw" });
    else if (old.text !== it.text) found.push({ item: it, kind: "type", retype: !!old.text });
    else if (old.look !== it.look) found.push({ item: it, kind: "paint" });
  }
  for (const [id, it] of before.items) if (!after.items.has(id)) found.push({ item: it, kind: "erase" });

  // inside something that is drawn as a whole (new, moved or removed): drawn along with it
  const whole = new Set(found.filter((f) => f.kind === "draw" || f.kind === "erase").map((f) => f.item.id));
  const under = (it: Item, items: Map<string, Item>) => {
    for (let p = it.parent; p; p = items.get(p)?.parent) if (whole.has(p)) return true;
    return false;
  };
  const a = view.area;
  return found
    .filter((f) => !under(f.item, f.kind === "erase" ? before.items : after.items))
    .map((f) => {
      const p = view.toScreen(f.item.box.x, f.item.box.y);
      const rect = { x: p.x, y: p.y, w: f.item.box.w * view.unit, h: f.item.box.h * view.unit };
      const lineH = (f.item.line ?? 0) * view.unit;
      // with a known line height: the box's lines; else (a slide's text box, taller than its text) one per paragraph
      const lines = Math.max(1, Math.min(12, lineH > 4 ? Math.round(rect.h / lineH) : f.item.text.split("\n").length));
      return { id: f.item.id, kind: f.kind, rect, lines, chars: f.item.text.length, round: !!f.item.round, retype: !!f.retype };
    })
    // on screen only, and big enough to see
    .filter((c) => c.rect.w >= 3 && c.rect.h >= 3 && c.rect.x < a.x + a.w && c.rect.y < a.y + a.h && c.rect.x + c.rect.w > a.x && c.rect.y + c.rect.h > a.y)
    .map((c) => {
      // clipped to the canvas
      const x = Math.max(c.rect.x, a.x);
      const y = Math.max(c.rect.y, a.y);
      return { ...c, rect: { x, y, w: Math.min(c.rect.x + c.rect.w, a.x + a.w) - x, h: Math.min(c.rect.y + c.rect.h, a.y + a.h) - y } };
    })
    .sort((p, q) => p.rect.y - q.rect.y || p.rect.x - q.rect.x);
}

export { engineView };
