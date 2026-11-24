// figcraft's web build, driven through `window.figcraft` inside its frame
// (figcraft docs/control-protocol.md, "In the browser"). Opening puts the bytes in a new tab,
// so a reload first closes the tab that shows the old copy.
import { fromBase64 } from "./bytes";
import type { EngineDef } from "./types";

interface FigcraftApi {
  request(method: string, params?: object): Promise<unknown>;
  execute(command: string, params?: object): Promise<unknown>;
  openFile(name: string, bytes: Uint8Array): Promise<unknown>;
}

const apiOf = (frame: Window): FigcraftApi | undefined => (frame as Window & { figcraft?: FigcraftApi }).figcraft;

function need(frame: Window): FigcraftApi {
  const fc = apiOf(frame);
  if (!fc) throw new Error("편집 엔진이 아직 준비되지 않았어요");
  return fc;
}

export const figcraft: EngineDef = {
  id: "figcraft",
  label: "FigCraft",
  icon: "🎨",
  verb: "그리는 중",
  exts: [".figcraft"],
  url: "/engines/figcraft/index.html?control",

  ready: (frame) => typeof apiOf(frame)?.execute === "function",

  async load(frame, bytes, name) {
    const fc = need(frame);
    // nothing to close on the first load; later loads replace the copy shown
    await fc.execute("file.close", { force: true }).catch(() => undefined);
    await fc.openFile(name, bytes);
  },

  async save(frame) {
    const fc = need(frame);
    // without a path, saveAs hands the file back as base64 (no download, no file system needed);
    // markSaved then clears the unsaved mark, as the docs ask once the file was delivered
    const out = (await fc.execute("file.saveAs", { data: true })) as { data: string };
    await fc.execute("file.markSaved", {});
    return fromBase64(out.data);
  },

  async isDirty(frame) {
    const doc = (await need(frame).request("document.inspect", { depth: 0 })) as { dirty?: boolean } | null;
    return !!doc?.dirty;
  },
};
