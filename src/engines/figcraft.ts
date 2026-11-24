// figcraft's web build, driven through `window.figcraft` inside its frame
// (figcraft docs/control-protocol.md, "In the browser"). Opening puts the bytes in a new tab,
// so a reload first closes the tab that shows the old copy.
import type { EngineDef } from "./types";

interface FigcraftApi {
  request(method: string, params?: object): Promise<unknown>;
  execute(command: string, params?: object): Promise<unknown>;
  openFile(name: string, bytes: Uint8Array): Promise<unknown>;
  captureDownloads(on: boolean): void;
  readFile(name: string): Uint8Array;
}

const apiOf = (frame: Window): FigcraftApi | undefined => (frame as Window & { figcraft?: FigcraftApi }).figcraft;

/** the file name each frame was loaded with: save writes under it */
const names = new WeakMap<Window, string>();

function need(frame: Window): FigcraftApi {
  const fc = apiOf(frame);
  if (!fc) throw new Error("편집 엔진이 아직 준비되지 않았어요");
  return fc;
}

export const figcraft: EngineDef = {
  id: "figcraft",
  label: "FigCraft",
  icon: "🎨",
  exts: [".figcraft"],
  url: "/engines/figcraft/index.html?control",

  ready: (frame) => typeof apiOf(frame)?.execute === "function",

  async load(frame, bytes, name) {
    const fc = need(frame);
    // nothing to close on the first load; later loads replace the copy shown
    await fc.execute("file.close", { force: true }).catch(() => undefined);
    await fc.openFile(name, bytes);
    names.set(frame, name);
  },

  async save(frame) {
    const fc = need(frame);
    const name = names.get(frame);
    if (!name) throw new Error("열린 파일 이름을 알 수 없어요");
    // the save is kept in the page instead of downloaded, then read back by name
    fc.captureDownloads(true);
    try {
      await fc.execute("file.saveAs", { path: name });
      return fc.readFile(name);
    } finally {
      fc.captureDownloads(false);
    }
  },

  async isDirty(frame) {
    const doc = (await need(frame).request("document.inspect", { depth: 0 })) as { dirty?: boolean } | null;
    return !!doc?.dirty;
  },
};
