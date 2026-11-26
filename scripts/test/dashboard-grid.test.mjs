// 대시보드 격자 배치 검사: 겹침 해소 · 12열 스냅 · 경계 보정 · 빈 자리 찾기.
//   node --test scripts/test/   (npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, clampBox, findFreeSpot, overlaps, boxPx, deltaCells, COLS, MIN_W, MIN_H, GAP_PX } from "../../src/components/dashboard/grid.ts";

const item = (id, x, y, w, h) => ({ id, x, y, w, h });
const at = (list, id) => list.find((i) => i.id === id);

test("경계: 12열 밖으로 나가지 않고 최소 크기를 지킨다", () => {
  assert.deepEqual(clampBox({ x: 10, y: 0, w: 6, h: 2 }), { x: COLS - 6, y: 0, w: 6, h: MIN_H });
  assert.deepEqual(clampBox({ x: -3, y: -2, w: 1, h: 1 }), { x: 0, y: 0, w: MIN_W, h: MIN_H });
  assert.deepEqual(clampBox({ x: 0, y: 0, w: 20, h: 5 }), { x: 0, y: 0, w: COLS, h: 5 });
});

test("겹침 해소: 움직인 칸과 겹친 칸은 아래로 밀린다", () => {
  const items = [item("A", 0, 0, 6, 4), item("B", 6, 0, 6, 4)];
  const out = arrange(items, "A", { x: 4, y: 0, w: 6, h: 4 });
  assert.deepEqual(at(out, "A"), { id: "A", x: 4, y: 0, w: 6, h: 4 }, "움직인 칸은 놓은 자리에 그대로");
  assert.equal(at(out, "B").y, 4, "겹친 B는 A 아래로");
  assert.equal(at(out, "B").x, 6);
});

test("위로 당기기: 밀려난 뒤 빈 틈이 있으면 다시 올라온다", () => {
  const items = [item("A", 0, 0, 12, 4), item("C", 0, 12, 6, 4)];
  const out = arrange(items, "A", { x: 0, y: 0, w: 12, h: 4 });
  assert.equal(at(out, "C").y, 4, "A 바로 아래 빈 줄로 당겨진다");
});

test("불변식: 어떤 이동을 해도 칸끼리 겹치지 않고 격자 안에 있다", () => {
  let items = [item("a", 0, 0, 4, 4), item("b", 4, 0, 4, 4), item("c", 8, 0, 4, 4), item("d", 0, 4, 6, 5), item("e", 6, 4, 6, 5)];
  // 결정적 의사 난수로 이동·크기 변경을 반복
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let step = 0; step < 200; step++) {
    const pick = items[rnd(items.length)];
    const box = { x: rnd(14) - 1, y: rnd(12), w: rnd(14) - 1, h: rnd(10) };
    items = arrange(items, pick.id, box);
    for (const a of items) {
      assert.ok(a.x >= 0 && a.x + a.w <= COLS && a.w >= MIN_W && a.h >= MIN_H && a.y >= 0, `경계 밖: ${JSON.stringify(a)}`);
      for (const b of items) if (a !== b) assert.equal(overlaps(a, b), false, `겹침 ${a.id}-${b.id} (step ${step})`);
    }
  }
});

test("빈 자리 찾기: 위쪽의 빈 틈부터 채운다", () => {
  assert.deepEqual(findFreeSpot([{ x: 0, y: 0, w: 12, h: 4 }], 6, 4), { x: 0, y: 4, w: 6, h: 4 });
  assert.deepEqual(findFreeSpot([{ x: 0, y: 0, w: 6, h: 4 }], 6, 4), { x: 6, y: 0, w: 6, h: 4 }, "옆으로 붙는다");
  assert.deepEqual(findFreeSpot([], 6, 2), { x: 0, y: 0, w: 6, h: MIN_H }, "최소 높이");
});

test("스냅: 픽셀 이동을 가장 가까운 열·줄로 맞춘다", () => {
  const width = 1000; // 열 너비 (1000 - 11*12) / 12 ≈ 72.33px, 한 칸 간격 포함 ≈ 84.33px
  assert.deepEqual(deltaCells(42, 0, width), { cols: 0, rows: 0 });
  assert.deepEqual(deltaCells(43, 0, width), { cols: 1, rows: 0 });
  assert.deepEqual(deltaCells(-130, 40, width), { cols: -2, rows: 1 });
  assert.equal(deltaCells(0, 35, width).rows, 1, "줄 높이 56+12=68의 절반 이상이면 한 줄");
});

test("px 박스: 12열 전체는 컨테이너 폭과 같다", () => {
  const width = 1000;
  const full = boxPx({ x: 0, y: 0, w: COLS, h: 4 }, width);
  assert.ok(Math.abs(full.width - width) < 1e-9);
  const one = boxPx({ x: 0, y: 2, w: 1, h: 4 }, width);
  assert.ok(Math.abs(one.left) < 1e-9);
  assert.equal(one.top, 2 * (56 + GAP_PX));
});
