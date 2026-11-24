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

// Whether this build ships the engine's web files (public/engines/<id>/index.html). Missing files
// are not an error for the person: the card and the editing screen say "설치 필요" and offer the plain view.
const installed = new Map<string, Promise<boolean>>();

/** Asked once per engine for the life of the page; every card and editing screen shares the answer. */
export function engineAvailable(engine: EngineDef): Promise<boolean> {
  let answer = installed.get(engine.id);
  if (!answer) {
    answer = probe(engine.url.split("?")[0]);
    installed.set(engine.id, answer);
  }
  return answer;
}

async function probe(path: string): Promise<boolean> {
  try {
    // Without text/html in Accept, a dev server answers a missing file with 404 instead of its
    // HTML fallback page (which would look like an installed engine).
    const res = await fetch(path, { cache: "no-store", headers: { Accept: "application/octet-stream" } });
    const type = res.headers.get("content-type") ?? "";
    await res.body?.cancel();
    return res.ok && type.includes("text/html");
  } catch {
    return false;
  }
}
