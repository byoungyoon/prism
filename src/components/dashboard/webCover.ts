// 웹 칸(자식 웹뷰)은 HTML 위에 떠 있어서, 지금 보여도 되는지와 어디까지 보이는지를 직접 계산한다.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 이보다 좁게 남으면 웹뷰를 숨긴다 */
export const MIN_VISIBLE_PX = 40;

export const intersect = (a: Box, b: Box): Box => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
});

export const overlaps = (a: Box, b: Box) => {
  const i = intersect(a, b);
  return i.right > i.left && i.bottom > i.top;
};

/** 칸 자리에서 실제로 보이는 부분. clips = 잘라 내는 바깥 상자들(스크롤 영역·창). 너무 조금 남으면 null */
export function visibleRect(slot: Box, clips: Box[]) {
  const v = clips.reduce(intersect, slot);
  const w = v.right - v.left;
  const h = v.bottom - v.top;
  return w >= MIN_VISIBLE_PX && h >= MIN_VISIBLE_PX ? { x: v.left, y: v.top, w, h } : null;
}

/** 열려 있으면 위치와 상관없이 웹 칸을 숨기는 것: 팝업·모달·메뉴. 새 팝업은 role 이나 data-covers-web 을 붙인다 */
const POPUPS = '[role="dialog"],[role="alertdialog"],[role="menu"],[aria-modal="true"],[data-covers-web]';
/** 칸과 겹칠 때만 숨기는 것: 알림·업데이트 띠 */
const TOASTS = '[role="alert"],[role="status"]';

/** 화면에 실제로 그려진 것만 (가려 둔 사무실 화면 안의 창은 뺀다) */
const drawn = (el: Element) => el.getClientRects().length > 0;

export function isCovered(slot: Box, root: ParentNode = document) {
  if (Array.from(root.querySelectorAll(POPUPS)).some(drawn)) return true;
  // 대시보드 안의 안내 글은 칸 위에 뜨지 않는다
  return Array.from(root.querySelectorAll(TOASTS)).some((el) => !el.closest(".dash-root") && drawn(el) && overlaps(slot, el.getBoundingClientRect()));
}

/** 칸을 잘라 내는 상자: 창과, overflow 가 visible 이 아닌 조상들 */
export function clipsOf(el: Element): Box[] {
  const clips: Box[] = [{ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }];
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX !== "visible" || s.overflowY !== "visible") clips.push(p.getBoundingClientRect());
  }
  return clips;
}
