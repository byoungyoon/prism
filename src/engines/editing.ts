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
  open: (t: EditTarget) => void;
  close: () => void;
}

export const useEngineEdit = create<EditState>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
