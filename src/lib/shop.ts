// 상점 표: 휴게실 소품의 가격·이름·설명을 한 곳에 모았다 (그림은 components/shopArt.ts, 이름으로 찾는다). 고양이는 상점에서 사지 않고 뽑기로만 얻는다
// (뽑기 가격·확률은 Rust가 정하고 gacha_info로 받는다). 소품 가격은 Rust의 ITEM_PRICES(projects.rs)가
// 기준이고, 여기와 같아야 한다: scripts/test/shop-prices.test.mjs 가 맞는지 본다.
// 물건 id는 Prefs.owned에 그대로 저장된다: "cat:<털색 id>"(뽑기) · "item:<이름>"(상점). 휴게실(Office.tsx)은
// 이 id로 산 소품을 알아본다. 이름을 바꾸면 저장된 구매 기록이 끊기니 주의.

/** 처음에 가진 물건 (돈 없이 쓸 수 있는 털색) */
export const DEFAULT_OWNED = ["cat:white"];

/** 뽑기 등급 이름(Rust GACHA_CATS) → 표시 색 클래스(styles.css .rarity-*). 흰 고양이의 '기본'은 뽑기 등급이 아니다. */
export const RARITY_CLASS: Record<string, string> = {
  기본: "rarity-base",
  흔함: "rarity-common",
  레어: "rarity-rare",
  에픽: "rarity-epic",
  유니크: "rarity-unique",
  레전더리: "rarity-legendary",
};

export interface ShopEntry {
  id: string;
  kind: "item";
  name: string;
  /** 츄르 개수 (Rust ITEM_PRICES와 같아야 한다) */
  price: number;
  /** 휴게실에 보이는 이름 설명 (쉬운 말) */
  hint: string;
}

/** 휴게실 소품 (20~150 범위). 이름이 id가 된다: item:<이름> */
const ITEMS: { name: string; price: number; hint: string }[] = [
  { name: "소파", price: 150, hint: "고양이들이 눕는 큰 소파" },
  { name: "책장", price: 100, hint: "휴게실 벽 책장" },
  { name: "액자", price: 30, hint: "벽에 거는 그림" },
  { name: "스탠드", price: 60, hint: "구석의 작은 등" },
  { name: "햇살 자리", price: 40, hint: "창가에 드는 햇살 자리" },
  { name: "숨숨집", price: 80, hint: "들어가 숨는 상자 집" },
  { name: "스크래처", price: 70, hint: "발톱 가는 긁개" },
  { name: "털실", price: 20, hint: "굴러다니는 털실 뭉치" },
  { name: "밥그릇", price: 20, hint: "고양이 밥그릇" },
  { name: "러그", price: 50, hint: "바닥에 까는 깔개" },
  { name: "러그·쿠션", price: 30, hint: "깔개와 쿠션 한 벌" },
  { name: "화분", price: 60, hint: "초록 화분 두 개" },
  { name: "정수기", price: 120, hint: "커피 머신 자리의 정수기" },
  { name: "캣타워", price: 100, hint: "여러 층으로 된 캣타워" },
];

/** 상점에 나오는 소품 전부 */
export const SHOP: ShopEntry[] = ITEMS.map((it): ShopEntry => ({ id: `item:${it.name}`, kind: "item", name: it.name, price: it.price, hint: it.hint }));

/** 토큰 말고 츄르를 받는 양 (안내용). Rust 상수(ATTEND_*·CARD_*·PET_*·TOKENS_PER_CHURU)와 같아야 한다 */
export const EARN = {
  tokensPerChuru: 12500,
  attendBase: 20,
  attendStep: 2,
  attendExtraMax: 10,
  attendWeekBonus: 50,
  cardReward: 6,
  cardDailyMax: 10,
  petReward: 2,
  petDailyMax: 5,
} as const;
