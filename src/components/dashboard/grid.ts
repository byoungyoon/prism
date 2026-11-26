// 대시보드 격자 계산 (순수 함수: React·Tauri 의존 없음, node --test 로 직접 검사한다).
// x·w는 열(12열), y·h는 줄. 칸 높이는 줄 단위라 세로로 자유롭게 늘어난다.

export const COLS = 12;
export const MIN_W = 3;
export const MIN_H = 4;
/** 한 줄의 높이 (px) 와 칸 사이 간격 (px) */
export const ROW_PX = 56;
export const GAP_PX = 12;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed extends Box {
  id: string;
}

/** 칸을 격자 안에 가두고 최소 크기를 지킨다 (경계 보정). */
export function clampBox(b: Box): Box {
  const w = Math.min(COLS, Math.max(MIN_W, Math.round(b.w)));
  const x = Math.min(COLS - w, Math.max(0, Math.round(b.x)));
  const h = Math.max(MIN_H, Math.round(b.h));
  const y = Math.max(0, Math.round(b.y));
  return { x, y, w, h };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 칸들을 배치한다. movedId 칸은 moved 자리에 그대로 두고, 그 칸과 겹치는 칸은 아래로 밀어낸다.
 * 밀린 뒤에는 빈 틈이 있으면 위로 당겨 올린다(겹침은 절대 만들지 않는다). 입력 순서대로 결과를 돌려준다.
 */
export function arrange<T extends Placed>(items: T[], movedId: string | null, moved?: Box): T[] {
  const boxes = new Map<string, Box>();
  const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x || 0);
  const fixed = movedId != null ? items.find((i) => i.id === movedId) : undefined;
  if (fixed) boxes.set(fixed.id, clampBox(moved ?? fixed));

  // 1) 자리 잡기: 이미 놓인 칸과 겹치면 그 칸 아래로 내린다
  for (const it of order) {
    if (it.id === fixed?.id) continue;
    let b = clampBox(it);
    for (;;) {
      const hit = [...boxes.values()].find((p) => overlaps(p, b));
      if (!hit) break;
      b = { ...b, y: hit.y + hit.h };
    }
    boxes.set(it.id, b);
  }

  // 2) 위로 당기기: 겹치지 않는 한 한 줄씩 올린다 (움직인 칸은 제자리)
  for (const it of order) {
    if (it.id === fixed?.id) continue;
    let b = boxes.get(it.id)!;
    const others = [...boxes.entries()].filter(([id]) => id !== it.id).map(([, v]) => v);
    while (b.y > 0 && !others.some((o) => overlaps(o, { ...b, y: b.y - 1 }))) b = { ...b, y: b.y - 1 };
    boxes.set(it.id, b);
  }

  return items.map((i) => ({ ...i, ...boxes.get(i.id)! }));
}

/** 빈 자리 찾기: 위에서부터 훑어 처음 들어가는 자리 (추가 버튼용). */
export function findFreeSpot(items: Box[], w: number, h: number): Box {
  const bottom = items.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  const cw = Math.min(COLS, Math.max(MIN_W, w));
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + cw <= COLS; x++) {
      const b = { x, y, w: cw, h: Math.max(MIN_H, h) };
      if (!items.some((o) => overlaps(o, b))) return b;
    }
  }
  return { x: 0, y: bottom, w: cw, h: Math.max(MIN_H, h) };
}

/** 열 하나의 너비 (px). 가장자리 여백 없이 간격만 뺀다. */
export function colPx(width: number): number {
  return (width - GAP_PX * (COLS - 1)) / COLS;
}

/** 칸을 화면 px 박스로 */
export function boxPx(b: Box, width: number): { left: number; top: number; width: number; height: number } {
  const c = colPx(width);
  return {
    left: b.x * (c + GAP_PX),
    top: b.y * (ROW_PX + GAP_PX),
    width: b.w * c + (b.w - 1) * GAP_PX,
    height: b.h * ROW_PX + (b.h - 1) * GAP_PX,
  };
}

/** 끌기 거리(px)를 열·줄 칸 수로 스냅 (반올림) */
export function deltaCells(dx: number, dy: number, width: number): { cols: number; rows: number } {
  const c = colPx(width);
  return { cols: Math.round(dx / (c + GAP_PX)), rows: Math.round(dy / (ROW_PX + GAP_PX)) };
}
