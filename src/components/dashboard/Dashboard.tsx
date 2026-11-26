// 대시보드 탭 본체: 칸 격자(추가 · 끌어 옮기기 · 모서리로 크기 · 지우기), 칸이 없을 때의 안내 화면.
// 칸이 바뀌면 state.ts 가 설계도 형식으로 잠깐 뒤에 저장한다.
import { useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import { DraftBox } from "./Draft";
import { CONNECTORS, connectorOf } from "./connectors/registry.ts";
import { specOf } from "./connectors/specs.ts";
import { arrange, boxPx, clampBox, deltaCells, findFreeSpot, GAP_PX, ROW_PX, type Box } from "./grid.ts";
import { WidgetCard } from "./WidgetCard";
import { loadDashboard, useDash } from "./state.ts";
import type { Widget, WidgetKind } from "../../lib/api";

/** 화면 폭을 아직 못 쟀을 때 쓰는 값 */
const FALLBACK_W = 960;

const newId = () => `w-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 칸이 하나도 없을 때: 안내 · 설명으로 만들기 · 세 가지 큰 카드 */
function EmptyState({ onAdd }: { onAdd: (kind: WidgetKind) => void }) {
  return (
    <div className="dash-empty">
      <h2>무엇을 연결할까요?</h2>
      <p className="dash-hint">웹사이트·엑셀 파일·슬랙 중에서 골라 칸을 만들어요. 칸마다 “이렇게 보여줘”라고 적으면 AI가 표나 그래프로 바꿔 줘요.</p>
      <DraftBox />
      <div className="dash-cards">
        {CONNECTORS.map((c) => (
          <button key={c.kind} className="dash-bigcard" onClick={() => onAdd(c.kind)}>
            <span className="dash-big-emoji" aria-hidden="true">{c.emoji}</span>
            <b>{c.name}</b>
            <small>{c.blurb}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const widgets = useDash((s) => s.widgets);
  const loaded = useDash((s) => s.loaded);
  const [menu, setMenu] = useState(false);
  const [width, setWidth] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const stopDrag = useRef<(() => void) | null>(null);

  // 처음 열 때 저장된 대시보드를 읽는다 (탭을 오가도 메모리에 남아 있어서 한 번만)
  useEffect(() => {
    if (!loaded) void loadDashboard();
  }, [loaded]);

  // 칸 격자의 실제 폭: 칸 위치를 px로 바꿀 때 쓴다
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // 화면을 떠날 때 끌기가 남아 있으면 걷는다
  useEffect(() => () => stopDrag.current?.(), []);

  const add = (kind: WidgetKind) => {
    const spec = specOf(kind);
    if (!spec) return;
    const box = findFreeSpot(useDash.getState().widgets, spec.size.w, spec.size.h);
    const w: Widget = { id: newId(), kind, title: spec.name, ...box, config: {} };
    useDash.getState().update((ws) => [...ws, w]);
    setMenu(false);
  };

  const remove = (w: Widget) => {
    connectorOf(w.kind)?.onRemove?.(w);
    useDash.getState().update((ws) => ws.filter((x) => x.id !== w.id));
  };

  /** 칸 끌기(move) 또는 크기 바꾸기(resize). 움직이는 동안 다른 칸은 겹치지 않게 밀린다. */
  const begin = (e: RPE<HTMLElement>, id: string, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    const start = useDash.getState().widgets.find((w) => w.id === id);
    if (!start) return;
    e.preventDefault();
    stopDrag.current?.();
    const origin: Box = { x: start.x, y: start.y, w: start.w, h: start.h };
    const sx = e.clientX;
    const sy = e.clientY;
    const cw = canvas.current?.clientWidth || FALLBACK_W;
    useDash.getState().setDragging(true);

    const move = (ev: PointerEvent) => {
      const { cols, rows } = deltaCells(ev.clientX - sx, ev.clientY - sy, cw);
      const next =
        mode === "move"
          ? clampBox({ ...origin, x: origin.x + cols, y: origin.y + rows })
          : clampBox({ ...origin, w: origin.w + cols, h: origin.h + rows });
      useDash.getState().update((ws) => arrange(ws, id, next));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      stopDrag.current = null;
      useDash.getState().setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    stopDrag.current = stop;
  };

  const W = width || FALLBACK_W;
  const rows = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);

  return (
    <div className="dash-root">
      {widgets.length > 0 && (
        <div className="dash-toolbar">
          <div className="dash-title">
            <b>📊 대시보드</b>
            <small>칸을 끌어서 옮기고, 오른쪽 아래 모서리로 크기를 바꿔요. 바뀌면 자동으로 저장돼요.</small>
          </div>
          <div className="dash-add">
            <button className="dash-primary" aria-expanded={menu} onClick={() => setMenu((o) => !o)}>+ 칸 추가</button>
            {menu && (
              <div className="dash-menu" role="menu">
                {CONNECTORS.map((c) => (
                  <button key={c.kind} role="menuitem" onClick={() => add(c.kind)}>
                    <span aria-hidden="true">{c.emoji}</span> {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div
        ref={canvas}
        className="dash-canvas"
        style={widgets.length ? { height: rows * (ROW_PX + GAP_PX) } : undefined}
      >
        {widgets.length === 0 ? (
          <EmptyState onAdd={add} />
        ) : (
          widgets.map((w, i) => (
            <WidgetCard
              key={w.id}
              widget={w}
              index={i}
              style={boxPx(w, W)}
              onStart={(e, mode) => begin(e, w.id, mode)}
              onRemove={() => remove(w)}
            />
          ))
        )}
      </div>
    </div>
  );
}
