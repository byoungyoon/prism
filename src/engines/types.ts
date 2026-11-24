// What an outside editor (a "외부 편집 엔진") must provide to open and save a file in Prism.
// An engine is a static web app under public/engines/<id>/, shown in an iframe on the same origin,
// so Prism reaches its API through the frame's window. Only the adapter differs per engine; the
// screen, the save button and the live refresh (EngineStage) are shared.
export interface EngineDef {
  /** stable id ("figcraft") */
  id: string;
  /** product name shown to the person */
  label: string;
  /** a glyph on the file card */
  icon: string;
  /** file extensions it opens, lowercase with the dot: [".figcraft"] */
  exts: string[];
  /** static path opened in the iframe, control channel on: "/engines/figcraft/index.html?control" */
  url: string;
  /** true once the engine's API is on the frame's window; polled while the frame starts */
  ready(frame: Window): boolean;
  /** put these bytes into the engine, replacing what it shows */
  load(frame: Window, bytes: Uint8Array, name: string): Promise<void>;
  /** the file as the engine would write it now */
  save(frame: Window): Promise<Uint8Array>;
  /** whether the person changed something since the last load or save (optional: default false) */
  isDirty?(frame: Window): Promise<boolean>;
}
