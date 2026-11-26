// 놀이방의 규칙: 쉬는 고양이 몇 마리가 휴게실에서 놀이방으로 건너가 놀다가 돌아간다.
// 놀이 하나는 몇 단계(step)로 되어 있다. 단계마다 설 자리(놀이방 그림의 [data-play] 표시), 자세,
// 머무는 시간이 정해져 있다. 여기는 화면 없는 순수한 규칙이라 node 테스트로 확인한다
// (scripts/test/playroom.test.mjs). 그림과 자리 재기는 Playroom.tsx · Office.tsx.
import type { Pose } from "../critters/state";

export type Act = "tower" | "hammock" | "ball" | "rod" | "house" | "wheel" | "tunnel" | "stay";

export interface PlayStep {
  /** 설 자리: 놀이방의 data-play 이름. "ball"은 공 옆 (공 위치로 계산), "stay"는 사람이 놓은 자리 */
  at: string;
  /** 걷지 않을 때의 자세 */
  pose: Pose;
  /** 머무는 시간 (ms) */
  ms: number;
  /** 이 단계에서 가끔 하는 말 */
  say?: string;
  /** 이 단계로 가는 걸음 빠르기 (px/s) */
  speed?: number;
  /** 이 단계가 시작될 때 공이 굴러간다 */
  roll?: boolean;
}

const roll = (say?: string): PlayStep => ({ at: "ball", pose: "raise", ms: 3200, speed: 110, roll: true, say });

export const SCRIPTS: Record<Act, PlayStep[]> = {
  // 바닥 → 낮은 칸 → 가운데 칸 → 꼭대기에서 한숨 → 다시 내려온다
  tower: [
    { at: "tower-floor", pose: "sit", ms: 2500 },
    { at: "tower-1", pose: "sit", ms: 3500, speed: 70 },
    { at: "tower-2", pose: "sit", ms: 4500, speed: 70 },
    { at: "tower-3", pose: "sleep", ms: 16000, speed: 70, say: "여기가 내 자리" },
    { at: "tower-2", pose: "sit", ms: 3000, speed: 80 },
  ],
  hammock: [{ at: "hammock", pose: "sleep", ms: 30000 }],
  ball: [{ at: "ball", pose: "sit", ms: 2500 }, roll("데굴데굴"), roll(), roll("잡았다!"), roll(), roll(), { at: "ball", pose: "coffee", ms: 5000 }],
  rod: [
    { at: "rod", pose: "sit", ms: 3000 },
    { at: "rod", pose: "raise", ms: 9000, say: "냥! 냥!" },
    { at: "rod", pose: "cheer", ms: 4000 },
  ],
  house: [
    { at: "house", pose: "sit", ms: 5000, say: "숨었다" },
    { at: "house", pose: "sleep", ms: 18000 },
  ],
  // 바퀴 옆에 선 다음 옆걸음으로 들어가 달린다
  wheel: [
    { at: "wheel-side", pose: "sit", ms: 1800 },
    { at: "wheel", pose: "walk", ms: 11000, speed: 60, say: "우다다!" },
    { at: "wheel", pose: "sit", ms: 3500 },
  ],
  tunnel: [
    { at: "tunnel-a", pose: "sit", ms: 3000 },
    { at: "tunnel-b", pose: "sit", ms: 2600, speed: 150 },
    { at: "tunnel-a", pose: "sit", ms: 2600, speed: 150, say: "까꿍" },
    { at: "tunnel-b", pose: "coffee", ms: 6000, speed: 150 },
  ],
  // 사람이 놀이방에 놓은 고양이: 그 자리에 한동안 앉아 있다 (놀이 목록에는 없어 스스로 고르지 않는다)
  stay: [{ at: "stay", pose: "sit", ms: 30000 }],
};

/** 처음부터 놀이방에 있는 놀이 */
const BASE_ACTS: Act[] = ["tower", "ball", "hammock", "rod", "house"];
/** 상점에서 사야 생기는 놀이 (물건 이름 → 놀이) */
export const SHOP_ACTS: Record<string, Act> = { 캣휠: "wheel", "캣 터널": "tunnel" };
export const actsFor = (has: (item: string) => boolean): Act[] => [...BASE_ACTS, ...Object.entries(SHOP_ACTS).flatMap(([item, act]) => (has(item) ? [act] : []))];

export interface PlayCat {
  act: Act;
  step: number;
  /** 다음 단계로 넘어가는 때 */
  until: number;
  /** "stay": 사람이 놓은 자리 (놀이방 왼쪽 위에서 px) */
  spot?: { x: number; y: number };
}

export interface PlayState {
  /** 놀이방에 있는 고양이 */
  cats: Record<string, PlayCat>;
  /** 휴게실로 돌아간 고양이가 다시 놀러 갈 수 있는 때 */
  rest: Record<string, number>;
  /** 공의 위치 (공이 구르는 길의 0‥1) 와 마지막으로 굴러간 방향 */
  ball: number;
  ballDir: 1 | -1;
}

export const emptyPlay = (): PlayState => ({ cats: {}, rest: {}, ball: 0.5, ballDir: 1 });

/** 놀이방까지 걸어가는 시간: 첫 단계에 더해 준다 */
export const ARRIVE_MS = 8000;
/** 휴게실로 돌아간 뒤 쉬는 시간 */
const REST_MIN = 12000;
const REST_MORE = 16000;
/** 놀이방에 한꺼번에 가는 고양이는 쉬는 고양이의 절반쯤, 많아야 이만큼 */
export const PLAY_MAX = 4;
export const quota = (lounging: number) => Math.min(PLAY_MAX, Math.ceil(lounging / 2));

export interface TickInput {
  /** 지금 쉬고 있는 고양이 */
  keys: string[];
  /** 지금 할 수 있는 놀이 */
  acts: Act[];
  now: number;
  /** 사람이 만지고 있거나 아직 휴게실로 걸어오는 중: 새로 보내거나 단계를 넘기지 않는다 */
  busy?: (key: string) => boolean;
  /** 처음 그릴 때: 걸어가는 시간 없이 정원만큼 바로 채운다 */
  fill?: boolean;
  random?: () => number;
}

/** 시간이 흐른 뒤의 놀이방. 바뀐 것이 없으면 받은 상태를 그대로 돌려준다 */
export function tickPlay(s: PlayState, { keys, acts, now, busy = () => false, fill = false, random = Math.random }: TickInput): PlayState {
  let changed = false;
  const cats = { ...s.cats };
  const rest = { ...s.rest };
  let { ball, ballDir } = s;
  const goHome = (k: string) => {
    delete cats[k];
    rest[k] = now + REST_MIN + random() * REST_MORE;
    changed = true;
  };
  // 일하러 갔거나 사라진 고양이, 없어진 놀이를 하던 고양이
  for (const [k, c] of Object.entries(cats))
    if (!keys.includes(k)) {
      delete cats[k];
      changed = true;
    } else if (c.act !== "stay" && !acts.includes(c.act)) goHome(k);
  for (const k of Object.keys(rest))
    if (!keys.includes(k)) {
      delete rest[k];
      changed = true;
    }
  /** 아무도 안 하고 있는 놀이 하나 */
  const freeAct = (not?: Act): Act | undefined => {
    const taken = new Set(Object.values(cats).map((c) => c.act));
    const free = acts.filter((a) => !taken.has(a) && a !== not);
    return free[Math.floor(random() * free.length)];
  };
  for (const [k, c] of Object.entries(cats)) {
    if (now < c.until || busy(k)) continue;
    const next = SCRIPTS[c.act][c.step + 1];
    if (next) {
      cats[k] = { ...c, step: c.step + 1, until: now + next.ms };
      if (next.roll) {
        // 길 끝에 닿으면 반대로 굴린다
        ballDir = ball > 0.7 ? -1 : ball < 0.3 ? 1 : random() < 0.7 ? ballDir : ((-ballDir) as 1 | -1);
        ball = Math.min(1, Math.max(0, ball + ballDir * (0.3 + random() * 0.3)));
      }
      changed = true;
      continue;
    }
    // 놀이가 끝났다: 가끔은 다른 놀이를 이어 하고, 아니면 휴게실로 돌아간다
    const more = random() < 0.35 ? freeAct(c.act) : undefined;
    if (more) {
      cats[k] = { act: more, step: 0, until: now + SCRIPTS[more][0].ms + ARRIVE_MS / 2 };
      changed = true;
    } else goHome(k);
  }
  // 빈자리가 있으면 쉬던 고양이를 부른다 (평소에는 한 번에 한 마리씩)
  while (Object.keys(cats).length < quota(keys.length)) {
    const ready = keys.filter((k) => !cats[k] && !busy(k) && (rest[k] ?? 0) <= now);
    // 처음 채울 때는 눈에 잘 띄는 놀이부터 차례로
    const act = fill ? acts.find((a) => !Object.values(cats).some((c) => c.act === a)) : freeAct();
    if (!ready.length || !act) break;
    const k = ready[Math.floor(random() * ready.length)];
    // 처음 채울 때: 타워는 이미 올라가 있는 모습으로
    const step = fill && act === "tower" ? 2 : 0;
    cats[k] = { act, step, until: now + SCRIPTS[act][step].ms + (fill ? 0 : ARRIVE_MS) };
    delete rest[k];
    changed = true;
    if (!fill) break;
  }
  return changed ? { cats, rest, ball, ballDir } : s;
}

/** 사람이 들어 옮긴 고양이는 놀이를 그만두고 한동안 휴게실에 있는다 */
export function leavePlay(s: PlayState, key: string, now: number): PlayState {
  const cats = { ...s.cats };
  delete cats[key];
  return { ...s, cats, rest: { ...s.rest, [key]: now + REST_MIN + REST_MORE } };
}

/** 사람이 놀이방에 놓은 고양이는 그 자리에 남는다 (정원이 차 있어도) */
export function placeInPlay(s: PlayState, key: string, spot: { x: number; y: number }, now: number): PlayState {
  const rest = { ...s.rest };
  delete rest[key];
  return { ...s, cats: { ...s.cats, [key]: { act: "stay", step: 0, until: now + SCRIPTS.stay[0].ms, spot } }, rest };
}

export type RoomName = "lounge" | "play";
type Rect = { x: number; y: number; w: number; h: number };
const away = (p: { x: number; y: number }, r: Rect) => Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.w), Math.max(r.y - p.y, 0, p.y - r.y - r.h));
/** 고양이를 놓은 곳의 방: 방 밖(두 방 사이, 책상 쪽)이면 가까운 방 */
export const dropRoom = (p: { x: number; y: number }, lounge: Rect, play: Rect): RoomName => (away(p, play) < away(p, lounge) ? "play" : "lounge");
