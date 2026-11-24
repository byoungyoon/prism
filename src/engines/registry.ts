// Every outside editor Prism knows. A new one (pptx, …) is one more entry in ENGINES.
import { deckcraft } from "./deckcraft";
import { figcraft } from "./figcraft";
import type { EngineDef } from "./types";

export const ENGINES: EngineDef[] = [figcraft, deckcraft];

export function engineById(id: string): EngineDef | undefined {
  return ENGINES.find((e) => e.id === id);
}

/** The engine that opens this file (by extension), or undefined for files Prism only previews. */
export function engineFor(path: string): EngineDef | undefined {
  const p = path.toLowerCase();
  return ENGINES.find((e) => e.exts.some((x) => p.endsWith(x)));
}
