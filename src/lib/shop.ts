// 상점 표: 고양이 털색과 휴게실 소품의 가격·이름·그림을 한 곳에 모았다. 가격을 바꾸려면 여기만 고친다.
// 물건 id는 Prefs.owned에 그대로 저장된다: "cat:<털색 id>" · "item:<이름>". 휴게실(Office.tsx)과
// 털색(coats.ts)은 이 id로 산 것을 알아본다. 이름을 바꾸면 저장된 구매 기록이 끊기니 주의.
import { COATS } from "../components/critters/pixel/coats";

/** 츄르 1개 = 토큰 25,000개 (이 컴퓨터 기준: 입력+출력+캐시생성, 캐시읽기는 뺌) */
export const TOKENS_PER_CHURU = 25_000;
/**
 * 이 컴퓨터의 최근 4주 주간 평균 사용량 (입력+출력+캐시생성, 캐시읽기 제외).
 * 츄르 가격의 근거: 4주 동안 쓰는 만큼 벌면 상점 물건을 전부 살 수 있게 맞췄다.
 */
export const WEEKLY_TOKENS = 29_900_000;
/** 4주 치 츄르 = WEEKLY_TOKENS × 4 / TOKENS_PER_CHURU ≈ 4,784. 가격 합계는 이 값의 ±3% 안 (SHOP_TOTAL) */
export const TARGET_TOTAL = Math.round((WEEKLY_TOKENS * 4) / TOKENS_PER_CHURU);

/** 처음에 가진 물건 (돈 없이 쓸 수 있는 털색) */
export const DEFAULT_OWNED = ["cat:white"];

export interface ShopEntry {
  id: string;
  kind: "cat" | "item";
  name: string;
  /** 츄르 개수 */
  price: number;
  /** 그림: 고양이는 털색 칠, 소품은 이모지 한 개 */
  icon: string;
  /** 고양이만: 털색 id (coats.ts) */
  coat?: string;
  /** 소품만: 휴게실에 보이는 이름 설명 (쉬운 말) */
  hint?: string;
}

/** 고양이 털색 가격 (200~500 범위). white는 기본 보유라 여기 없다 */
const CAT_PRICE: Record<string, number> = {
  grey: 200,
  cream: 250,
  ginger: 300,
  bicolor: 300,
  silver: 350,
  black: 350,
  calico: 450,
  brown: 400,
  siamese: 500,
  pink: 300,
  tuxedo: 450,
};

/** 휴게실 소품 (20~150 범위). 이름이 id가 된다: item:<이름> */
const ITEMS: { name: string; price: number; icon: string; hint: string }[] = [
  { name: "소파", price: 150, icon: "🛋️", hint: "고양이들이 눕는 큰 소파" },
  { name: "책장", price: 100, icon: "📚", hint: "휴게실 벽 책장" },
  { name: "액자", price: 30, icon: "🖼️", hint: "벽에 거는 그림" },
  { name: "스탠드", price: 60, icon: "💡", hint: "구석의 작은 등" },
  { name: "햇살 자리", price: 40, icon: "☀️", hint: "창가에 드는 햇살 자리" },
  { name: "숨숨집", price: 80, icon: "📦", hint: "들어가 숨는 상자 집" },
  { name: "스크래처", price: 70, icon: "🪵", hint: "발톱 가는 긁개" },
  { name: "털실", price: 20, icon: "🧶", hint: "굴러다니는 털실 뭉치" },
  { name: "밥그릇", price: 20, icon: "🥣", hint: "고양이 밥그릇" },
  { name: "러그", price: 50, icon: "🟫", hint: "바닥에 까는 깔개" },
  { name: "러그·쿠션", price: 30, icon: "🛏️", hint: "깔개와 쿠션 한 벌" },
  { name: "화분", price: 60, icon: "🪴", hint: "초록 화분 두 개" },
  { name: "정수기", price: 120, icon: "💧", hint: "커피 머신 자리의 정수기" },
  { name: "캣타워", price: 100, icon: "🏠", hint: "여러 층으로 된 캣타워" },
];

/** 상점에 나오는 물건 전부 (고양이 먼저, 그다음 소품). white는 기본 보유 */
export const SHOP: ShopEntry[] = [
  ...COATS.map((c): ShopEntry => ({
    id: `cat:${c.id}`,
    kind: "cat",
    name: `${c.word} 고양이`,
    price: CAT_PRICE[c.id] ?? 0,
    icon: c.top,
    coat: c.id,
  })),
  ...ITEMS.map((it): ShopEntry => ({ id: `item:${it.name}`, kind: "item", name: it.name, price: it.price, icon: it.icon, hint: it.hint })),
];

/** 살 수 있는 물건 가격 합계 (기본 보유 white는 제외) */
export const SHOP_TOTAL = SHOP.filter((e) => !DEFAULT_OWNED.includes(e.id)).reduce((sum, e) => sum + e.price, 0);

/** 가격 합계 확인: 고양이 3,850 + 소품 930 = 4,780 (목표 4,784의 -0.1%, ±3% 안) */
export const PRICE_OK = Math.abs(SHOP_TOTAL - TARGET_TOTAL) / TARGET_TOTAL <= 0.03;

export const priceOf = (id: string) => SHOP.find((e) => e.id === id)?.price ?? 0;
export const entryOf = (id: string) => SHOP.find((e) => e.id === id);
