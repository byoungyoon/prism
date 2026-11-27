// 대시보드 상태 (칸 목록 · 끌기 중 여부). 바뀌면 설계도 형식으로 잠깐 뒤에 저장한다.
import { create } from "zustand";
import { dashboardApi, type Widget, type WidgetKind } from "../../lib/api";
import { useApp } from "../../store";
import { applyBlueprint, blueprintOf, validateBlueprint } from "./blueprint.ts";
import { specOf } from "./connectors/specs.ts";
import { findFreeSpot } from "./grid.ts";

interface DashState {
  widgets: Widget[];
  loaded: boolean;
  /** 칸을 끌거나 크기를 바꾸는 중: 웹 칸은 그동안 가려 둔다 */
  dragging: boolean;
  load: (widgets: Widget[]) => void;
  update: (fn: (ws: Widget[]) => Widget[]) => void;
  setDragging: (v: boolean) => void;
}

export const useDash = create<DashState>()((set) => ({
  widgets: [],
  loaded: false,
  dragging: false,
  load: (widgets) => set({ widgets, loaded: true }),
  update: (fn) => set((s) => ({ widgets: fn(s.widgets) })),
  setDragging: (dragging) => set({ dragging }),
}));

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 칸 하나만 바꾼다 */
export function patchWidget(id: string, p: Partial<Widget>) {
  useDash.getState().update((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w)));
}

let loading: Promise<void> | null = null;

/** 저장 파일을 읽어 설계도로 검사한 뒤 칸을 넣는다. 파일이 이상하면 빈 대시보드로 시작하고 알린다.
 *  대시보드 화면과 확장 메뉴가 동시에 불러도 한 번만 읽는다. */
export function loadDashboard() {
  loading ??= readDashboard().finally(() => (loading = null));
  return loading;
}

async function readDashboard() {
  try {
    const raw = (await dashboardApi.load()) as unknown;
    const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    // 버전 표시가 없던 예전 저장 형식도 받는다
    const check = validateBlueprint(obj.version === undefined ? { ...obj, version: 1 } : obj);
    if (!check.ok) throw new Error(`저장된 대시보드를 읽지 못해서 빈 대시보드로 시작했어요: ${check.errors[0]}`);
    useDash.getState().load(applyBlueprint(check.blueprint!).widgets);
  } catch (e) {
    useDash.getState().load([]);
    useApp.getState().setError(e);
  }
}

/** 빈 자리를 찾아 새 칸을 만든다. 저장된 대시보드를 읽은 뒤에 불러야 한다. */
export function addWidget(kind: WidgetKind, config: Record<string, string> = {}) {
  const spec = specOf(kind);
  if (!spec) return;
  const box = findFreeSpot(useDash.getState().widgets, spec.size.w, spec.size.h);
  const id = `w-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  useDash.getState().update((ws) => [...ws, { id, kind, title: spec.name, ...box, config }]);
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** 저장 형식(설계도)으로 쓴다. 연속해서 바뀌어도 마지막에 한 번만. */
function saveSoon(widgets: Widget[]) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    dashboardApi.save(blueprintOf(widgets)).catch((e) => useApp.getState().setError(`대시보드를 저장하지 못했어요: ${errText(e)}`));
  }, 400);
}

useDash.subscribe((s, prev) => {
  if (s.loaded && prev.loaded && s.widgets !== prev.widgets) saveSoon(s.widgets);
});
