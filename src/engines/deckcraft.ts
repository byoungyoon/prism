// deckcraft's web build (pptx), driven through `window.deckcraft` inside its frame
// (docs/engines-deckcraft.md, branch prism/c217/t-23). The frame runs with `?host=parent`: a save
// then hands the file to this page instead of downloading it, and that save is what clears the
// engine's unsaved mark. Opening puts the bytes in a new tab, so a reload closes the old one first.
import { fromBase64, toBase64 } from "./bytes";
import type { EngineDef } from "./types";

interface DeckcraftApi {
  execute(command: string, params?: object): Promise<unknown>;
  docInspect(params?: object): Promise<unknown>;
}

const apiOf = (frame: Window): DeckcraftApi | undefined => (frame as Window & { deckcraft?: DeckcraftApi }).deckcraft;

/** the file name each frame was loaded with */
const names = new WeakMap<Window, string>();

function need(frame: Window): DeckcraftApi {
  const dc = apiOf(frame);
  if (!dc) throw new Error("편집 엔진이 아직 준비되지 않았어요");
  return dc;
}

/** `.deckcraft` keeps the native format; a PowerPoint name saves as .pptx */
const formatOf = (name: string) => (name.toLowerCase().endsWith(".deckcraft") ? "deckcraft" : "pptx");

export const deckcraft: EngineDef = {
  id: "deckcraft",
  label: "DeckCraft",
  icon: "📊",
  verb: "만드는 중",
  exts: [".pptx", ".deckcraft"],
  url: "/engines/deckcraft/index.html?host=parent",

  ready: (frame) => typeof apiOf(frame)?.execute === "function",

  async load(frame, bytes, name) {
    const dc = need(frame);
    // nothing to close on the first load; later loads replace the copy shown
    await dc.execute("file.close").catch(() => undefined);
    await dc.execute("file.openBytes", { name, data: toBase64(bytes) });
    names.set(frame, name);
  },

  async save(frame) {
    const dc = need(frame);
    const name = names.get(frame);
    if (!name) throw new Error("열린 파일 이름을 알 수 없어요");
    const out = (await dc.execute("file.saveBytes", { format: formatOf(name) })) as { data: string };
    // Save with no path goes to the page (?host=parent) and clears the unsaved mark. The page
    // ignores the copy it gets: the bytes above are the ones returned.
    await dc.execute("file.save", {});
    return fromBase64(out.data);
  },

  async isDirty(frame) {
    const doc = (await need(frame).docInspect({})) as { dirty?: boolean } | null;
    return !!doc?.dirty;
  },
};
