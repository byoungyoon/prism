// Twelve coats for the pixel cat: white, grey, cream, ginger, grey-and-white, silver tabby, black,
// calico, brown tabby, siamese, pale pink, tuxedo. A coat colours the letters of art.ts; stripes
// and patches are worked out from where a dot is.

export interface Coat {
  id: string;
  /** 털색 in plain words (상점과 털색 고르기 메뉴에 보인다) */
  word: string;
  line: string;
  /** k: head top and back */
  top: string;
  /** w: cheeks and sides */
  side: string;
  /** c: chest and muzzle */
  chest: string;
  ear: string;
  paw: string;
  tail: string;
  eye: string;
  nose: string;
  /** dots of a stripe (tabby) on top/back fur */
  stripe?: string;
  /** calico: two patch colours */
  patch?: [string, string];
  /** siamese: the dark points (ears, face, paws, tail) */
  point?: string;
}

const LINE = "#3f3434";

export const COATS: Coat[] = [
  { id: "white", word: "흰색", line: LINE, top: "#f8f6f4", side: "#ffffff", chest: "#ffffff", ear: "#f2b8c0", paw: "#ffffff", tail: "#f8f6f4", eye: "#5d8fc4", nose: "#f0a8b4" },
  { id: "grey", word: "회색", line: LINE, top: "#9a9da2", side: "#a7aaae", chest: "#b4b6ba", ear: "#d9a9ae", paw: "#a7aaae", tail: "#8e9196", eye: "#5aa07c", nose: "#d99aa4" },
  { id: "cream", word: "치즈(연한)", line: "#5a3e26", top: "#f3b961", side: "#f7c97e", chest: "#fbe3b6", ear: "#f1a99a", paw: "#fbe3b6", tail: "#eaa94b", eye: "#4f7f5a", nose: "#e99a8e" },
  { id: "ginger", word: "치즈", line: "#5a3523", top: "#e2874e", side: "#e99660", chest: "#f4c29b", ear: "#f0a491", paw: "#f4c29b", tail: "#d97b42", eye: "#5b7e43", nose: "#e48c84", stripe: "#c86c35" },
  { id: "bicolor", word: "회색·흰색", line: LINE, top: "#7d7671", side: "#ffffff", chest: "#ffffff", ear: "#d7a2a6", paw: "#ffffff", tail: "#7d7671", eye: "#5d8fc4", nose: "#e9a1ab" },
  { id: "silver", word: "은색 고등어", line: "#3b3a3d", top: "#d8d9dc", side: "#e6e7ea", chest: "#f4f4f6", ear: "#e0b2b6", paw: "#f0f0f2", tail: "#c9cace", eye: "#6a8f6a", nose: "#d9a0a8", stripe: "#7f8187" },
  { id: "black", word: "검정", line: "#141215", top: "#2b292d", side: "#333136", chest: "#38353b", ear: "#6e555b", paw: "#333136", tail: "#262428", eye: "#e0b44a", nose: "#5a4247" },
  { id: "calico", word: "삼색", line: LINE, top: "#ffffff", side: "#ffffff", chest: "#ffffff", ear: "#efb1b7", paw: "#ffffff", tail: "#e58a45", eye: "#5f9b6a", nose: "#eaa0aa", patch: ["#5b504c", "#e58a45"] },
  { id: "brown", word: "갈색 고등어", line: "#4a3426", top: "#a8876c", side: "#b6977c", chest: "#d6c0a8", ear: "#d9a296", paw: "#c8ad93", tail: "#957459", eye: "#6b8f4d", nose: "#c9867c", stripe: "#7a5a44" },
  { id: "siamese", word: "샴", line: "#3e2f2a", top: "#efe5d6", side: "#f5ede1", chest: "#f8f2e9", ear: "#5e4639", paw: "#6b5246", tail: "#5e4639", eye: "#4f86c6", nose: "#3e2f2a", point: "#6b5246" },
  { id: "pink", word: "분홍빛 흰색", line: "#4a3a3c", top: "#f5e1e2", side: "#f9eaeb", chest: "#fdf4f4", ear: "#efa9b4", paw: "#fdf4f4", tail: "#efd5d7", eye: "#6b93c2", nose: "#ec9aa8" },
  { id: "tuxedo", word: "턱시도", line: "#141215", top: "#262428", side: "#2e2c31", chest: "#ffffff", ear: "#6e555b", paw: "#ffffff", tail: "#262428", eye: "#e0b44a", nose: "#e9a1ab" },
];

/** the coats a team can show: only the ones bought in the shop (white is free) */
let OWNED: Coat[] = [COATS[0]];

/** 상점에서 산 털색 (Prefs.owned의 "cat:<id>"). 팀원 털색은 이 안에서만 고른다. */
export function setOwnedCoats(ids: string[]) {
  const pool = COATS.filter((c) => ids.includes(`cat:${c.id}`));
  OWNED = pool.length ? pool : [COATS[0]];
}

/** 사용자가 팀원마다 직접 고른 털색 (Prefs.coats) */
let CHOSEN: Record<string, string> = {};
export function setChosenCoats(picks: Record<string, string>) {
  CHOSEN = picks;
}

/** 고른 털색을 저장하는 팀원별 키. 같은 팀원은 새 카드를 받아도 같은 키다. 어느 팀인지 모르면 undefined */
export const coatKey = (a: { projectId?: string; role: "lead" | "mgr" | "worker"; name: string }): string | undefined =>
  a.projectId ? `${a.projectId}:${a.role}:${a.name}` : undefined;

/** W1, W2… each a different coat in turn; other names a steady pick. 총괄 and 팀장 start elsewhere. */
export function coatOf(name: string, role: "lead" | "mgr" | "worker", key?: string): Coat {
  const pool = OWNED;
  // 직접 고른 털색이 먼저다
  const picked = key ? pool.find((c) => c.id === CHOSEN[key]) : undefined;
  if (picked) return picked;
  const n = /(\d+)\s*$/.exec(name);
  const base = role === "lead" ? 2 : role === "mgr" ? 5 : 0;
  if (n) return pool[(base + Number(n[1]) - 1 + pool.length * 4) % pool.length];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return pool[(base + Math.abs(h)) % pool.length];
}

/**
 * 성격: 순응형(docile)은 들어 올려도 축 늘어져 있다가 놓은 자리에 앉거나 눕고, 반항형(wild)은
 * 버둥대며 "하악!" 하고 놓으면 원래 자리로 도망간다. 털색마다 정해 두고, 약 20%는 반대로 행동한다.
 */
export type Temper = "docile" | "wild";
export const TEMPER: Record<string, Temper> = {
  white: "docile",
  grey: "docile",
  cream: "docile",
  ginger: "wild",
  bicolor: "docile",
  silver: "wild",
  black: "wild",
  calico: "docile",
  brown: "docile",
  siamese: "wild",
  pink: "docile",
  tuxedo: "wild",
};
/** 성격과 반대로 행동할 확률 */
export const TEMPER_FLIP = 0.2;
export const temperOf = (coat: Coat): Temper => TEMPER[coat.id] ?? "docile";

/** 코트 색과 어울리는 한국어 고양이 이름 (COATS와 같은 순서) */
const CAT_NAMES = ["두부", "안개", "모모", "치즈", "보리", "은비", "까망이", "나비", "호두", "라떼", "솜이", "턱시"];

/** 사용자가 지어 준 고양이 이름 (Prefs.catNames, 키는 coatKey) */
let NAMED: Record<string, string> = {};
export function setCatNames(names: Record<string, string>) {
  NAMED = names;
}

/** 지어 줄 수 있는 이름의 글자 수 상한 (projects.rs `CAT_NAME_MAX`와 같게) */
export const CAT_NAME_MAX = 12;

type Member = { name: string; role: "lead" | "mgr" | "worker"; projectId?: string };

/** 지어 준 이름 (없으면 undefined) */
export const givenName = (a: Member): string | undefined => NAMED[coatKey(a) ?? ""];

/** 팀원이 정리되고 카드에 내부 이름(task.who)만 남았을 때: 지어 준 이름이 있으면 그 이름, 없으면 그대로 */
export const leftName = (projectId: string, who: string): string =>
  (["worker", "mgr", "lead"] as const).map((role) => givenName({ projectId, role, name: who })).find(Boolean) ?? who;

/** 화면에 보이는 이름: 지어 준 이름이 먼저. 없으면 작업자·팀장의 W1/M1 같은 내부 이름은 털색에 맞는 고양이 별명으로. 내부 ID는 그대로. */
export function catName(a: Member): string {
  const given = givenName(a);
  if (given) return given;
  if (a.role === "lead" || !/^[A-Za-z]+\d+$/.test(a.name)) return a.name;
  return CAT_NAMES[COATS.indexOf(coatOf(a.name, a.role, coatKey(a)))] ?? a.name;
}

/** a colour a little darker (#rrggbb → rgb()) */
export const darken = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const d = (v: number) => Math.round(v * 0.82);
  return `rgb(${d(n >> 16)}, ${d((n >> 8) & 255)}, ${d(n & 255)})`;
};

/** a colour a little lighter (#rrggbb → rgb()) */
export const lift = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const up = (v: number) => Math.round(v + (255 - v) * 0.08);
  return `rgb(${up(n >> 16)}, ${up((n >> 8) & 255)}, ${up(n & 255)})`;
};

/**
 * The markings of a cat seen from the side, placed on the walk's drawing (walk.ts): a mask on the turned face,
 * stripes on the forehead and down the back, patches on the rump. `x` is from the middle of the
 * face, `ry` from the top of the head, `by` from the middle of the body (so they ride with it).
 */
function sideMark(coat: Coat, ch: string, x: number, ry: number, by: number): string | null {
  const onBody = by >= -7 && (x < -13 || (ry > 18 && x < -7));
  if (coat.stripe) {
    if (!onBody && "k".includes(ch) && ry >= 4 && ry <= 7 && (Math.abs(x) <= 1 || Math.abs(Math.abs(x) - 5) <= 0)) return coat.stripe;
    if (onBody && "kw".includes(ch) && by <= 1 && (x + 64 + Math.floor(by / 3)) % 5 < 2) return coat.stripe;
    if (ch === "t" && (ry + 64) % 5 < 2) return coat.stripe;
  }
  if (coat.patch && "kw".includes(ch)) {
    if (!onBody && ch === "k" && ry <= 11 && x < -1) return coat.patch[0];
    if (!onBody && ch === "k" && ry <= 9 && x > 2) return coat.patch[1];
    if (onBody && ((x + 21) / 5) ** 2 + ((by + 5) / 5) ** 2 <= 1) return coat.patch[0];
  }
  if (coat.point) {
    if ("kwc".includes(ch) && (x / 8.5) ** 2 + ((ry - 13) / 5.5) ** 2 <= 1) return coat.point;
    if (ch === "k" && !onBody && ry <= 4) return coat.point;
  }
  return null;
}

/**
 * The colour of one dot. `x, y` are in the frame; `top` is where the head starts (patterns follow
 * the head, so they don't slide about as the cat bobs); `faceX` the middle of the face; `bodyY` the middle of the body,
 * given for the cats seen from the side (walking, lying, curled up); `back` for the one seen from behind.
 */
export function dotColor(coat: Coat, ch: string, x: number, y: number, top: number, faceX: number, bodyY?: number, back?: boolean): string | null {
  // x, y, top and faceX are in the drawn cat's dots (K × K per drawing dot, see art.ts), so the
  // patterns below are twice as fine as the drawing: thin tabby stripes, smaller patches
  const fur = (c: string) => {
    const ry = y - top;
    const speckle = (x * 5 + y * 3) % 23 === 0 ? lift(c) : c;
    if (bodyY !== undefined) return sideMark(coat, ch, x - faceX, ry, y - bodyY) ?? speckle;
    if (coat.stripe && (ch === "k" || ch === "t") && ry >= 6 && ry % 6 < 2 && (x + ry) % 11 !== 0) return coat.stripe;
    if (coat.stripe && ch === "w" && ry >= 12 && ry % 6 < 2 && (x < faceX - 10 || x > faceX + 10)) return coat.stripe;
    if (coat.patch && ch === "k") {
      // a dark patch over one ear and eye, an orange one over the other ear, both on the back
      if (ry < 18 && x < faceX) return coat.patch[0];
      if (ry < 12 && x > faceX + 2) return coat.patch[1];
      if (ry >= 24 && ry <= 28 && x >= faceX - 8 && x <= faceX) return coat.patch[0];
    }
    // siamese: a dark oval over the middle of the face, and dark ear rims
    if (coat.point && !back && ry >= 12 && ry <= 22 && Math.abs(x - faceX) <= (ry === 12 || ry === 22 ? 4 : 8)) return coat.point;
    if (coat.point && ry <= 6 && ch === "k") return coat.point;
    // a few lighter hairs, so the fur is not one flat colour
    return speckle;
  };
  switch (ch) {
    case "o":
      return coat.line;
    case "k":
      return fur(coat.top);
    case "w":
      return fur(coat.side);
    case "c":
      return fur(coat.chest);
    case "p":
      return coat.ear;
    case "l":
      return coat.paw;
    case "t":
      return fur(coat.tail);
    // the legs on the far side: the same fur and paw, a shade darker
    case "f":
      return darken(coat.point ?? coat.side);
    case "g":
      return darken(coat.paw);
    case "y":
      return coat.line;
    case "n":
      return coat.nose;
    default:
      return null;
  }
}
