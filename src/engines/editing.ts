// Which file is open in the editing screen (at most one). Kept outside the app store so the
// editor's state doesn't touch the rest of the app.
import { create } from "zustand";
import type { EngineDef } from "./types";

export interface EditTarget {
  projectId: string;
  taskId: string;
  /** path of the file inside the task's folder */
  path: string;
  engine: EngineDef;
}

interface EditState {
  target: EditTarget | null;
  /** kept open (with its unsaved edits) but out of the way, so the main view shows */
  tucked: boolean;
  tuck: () => void;
  /** is the editing screen where the main view would be? */
  covering: () => boolean;
  open: (t: EditTarget) => void;
  close: () => void;
}

export const useEngineEdit = create<EditState>()((set, get) => ({
  target: null,
  tucked: false,
  tuck: () => set({ tucked: true }),
  covering: () => !!get().target && !get().tucked,
  open: (target) => {
    // while an editor is tucked away, another file doesn't replace it (that would drop unsaved edits):
    // the tucked one comes back, to be saved or closed first
    const kept = get().tucked ? get().target : null;
    set({ target: kept && (kept.path !== target.path || kept.taskId !== target.taskId || kept.projectId !== target.projectId) ? kept : target, tucked: false });
  },
  close: () => set({ target: null, tucked: false }),
}));
