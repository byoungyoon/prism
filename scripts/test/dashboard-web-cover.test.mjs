import test from "node:test";
import assert from "node:assert/strict";
import { isCovered, overlaps, visibleRect } from "../../src/components/dashboard/webCover.ts";

const box = (left, top, right, bottom) => ({ left, top, right, bottom });
const win = box(0, 0, 1000, 800);

test("다 보이면 칸 자리 그대로", () => {
  assert.deepEqual(visibleRect(box(10, 100, 410, 400), [win]), { x: 10, y: 100, w: 400, h: 300 });
});

test("스크롤로 잘리면 스크롤 영역 안의 부분만", () => {
  const scroller = box(0, 60, 1000, 800);
  assert.deepEqual(visibleRect(box(10, -50, 410, 250), [win, scroller]), { x: 10, y: 60, w: 400, h: 190 });
});

test("화면 밖·조금만 남음·가려 둔 화면(크기 0)은 숨김", () => {
  assert.equal(visibleRect(box(10, 900, 410, 1200), [win]), null);
  assert.equal(visibleRect(box(10, 780, 410, 1080), [win]), null);
  assert.equal(visibleRect(box(0, 0, 0, 0), [win]), null);
});

const el = (rect, { drawn = true, inDash = false } = {}) => ({
  getClientRects: () => (drawn ? [rect] : []),
  getBoundingClientRect: () => rect,
  closest: () => (inDash ? {} : null),
});
const root = ({ popups = [], toasts = [] }) => ({ querySelectorAll: (q) => (q.includes("dialog") ? popups : toasts) });
const slot = box(100, 100, 500, 400);

test("팝업은 어디에 떠도 가리고, 그려지지 않은 창은 무시한다", () => {
  assert.equal(isCovered(slot, root({ popups: [el(box(900, 0, 990, 50))] })), true);
  assert.equal(isCovered(slot, root({ popups: [el(box(0, 0, 0, 0), { drawn: false })] })), false);
});

test("알림은 칸과 겹칠 때만, 대시보드 안 안내 글은 제외", () => {
  assert.equal(isCovered(slot, root({ toasts: [el(box(400, 350, 700, 500))] })), true);
  assert.equal(isCovered(slot, root({ toasts: [el(box(600, 500, 700, 600))] })), false);
  assert.equal(isCovered(slot, root({ toasts: [el(box(200, 200, 300, 220), { inDash: true })] })), false);
  assert.equal(overlaps(slot, box(500, 100, 600, 400)), false);
});
