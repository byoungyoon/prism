// What the office cats mutter to themselves now and then. Short lines in the tone of office-worker
// small talk, written for Prism (not copied from anywhere). Add lines freely: each list is picked at
// random, and `pickLine` chooses the list from what the cat is doing and the time of day.

export type ChatterMood = "work" | "longWork" | "rest" | "ask" | "done" | "error" | "night" | "morning";

export const CHATTER: Record<ChatterMood, string[]> = {
  work: [
    "아 일하기 싫다",
    "이것만 하고 쉬어야지",
    "버그 어디 숨었냥",
    "타닥타닥… 집중 집중",
    "이거 왜 되는 거지?",
    "이거 왜 안 되는 거지?",
    "오늘 안에 끝낸다냥",
    "커밋 메시지 뭐라고 쓰지",
    "테스트 한 번만 더…",
    "꼬리까지 바쁘다옹",
    "점심 뭐 먹지",
    "회의만 없으면 금방인데",
    "코드가 나를 보고 있어",
    "일단 돌아가게만 하자",
    "이 정도면 칭찬받겠지?",
    "키보드에 털 들어갔다",
    "월급 루팡은 아니다냥",
  ],
  longWork: [
    "벌써 이 시간이야?",
    "엉덩이에 뿌리 내리는 중",
    "눈이 침침하다냥",
    "기지개 한 번만…",
    "이 카드 생각보다 크다",
    "끝이 보이는 것 같기도?",
    "물 한 잔 마셔야지",
    "오늘의 야근 각인가",
    "집중력 충전 필요",
    "아직 반도 안 왔냥",
    "다 하면 간식 사 먹을 거야",
    "꼬리가 저리다옹",
    "누가 대신 해주면 좋겠다",
    "버티는 자가 이긴다",
    "이것만 넘기면 된다…",
  ],
  rest: [
    "쉬는 거 너무 좋은데?",
    "커피 한 잔 더…",
    "소파가 나를 부른다",
    "오늘은 여기까지만 할래",
    "일 들어오면 깨워줘",
    "햇살 좋다냥",
    "잠깐 눈만 감을게",
    "다음 일 뭐 주려나",
    "간식 서랍 누가 털었어",
    "꾹꾹이 타임",
    "쉬는 것도 일이다옹",
    "대기도 근무다",
    "커피머신 또 고장났어?",
    "털 정리 중이니 말 걸지 마",
    "오늘 퇴근 몇 시지?",
    "기분 좋게 늘어지는 중",
  ],
  ask: [
    "허락해 주세요냥…",
    "이거 해도 될까요?",
    "결재 기다리는 중",
    "눌러만 주시면 바로 할게요",
    "허락 떨어지면 달린다",
    "여기서 멈춰 있어요…",
    "한 번만 봐주세요냥",
    "제 차례 언제 와요?",
    "손 들고 기다리는 중",
    "답장 기다리다 목 빠지겠다",
    "확인 부탁드려요!",
    "혹시 바쁘세요…?",
    "허락이 필요하다옹",
    "착하게 기다리는 중",
    "OK 한 번이면 돼요",
  ],
  done: [
    "끝났다! 칼퇴각",
    "오늘 할 일 클리어",
    "보고 올렸다냥",
    "완벽해… 아마도",
    "박수 쳐 주세요",
    "이번 건 자신 있어",
    "끝! 간식 먹으러 간다",
    "깔끔하게 마무리",
    "다음 일도 덤벼라",
    "한 건 해치웠다옹",
    "이 맛에 일하지",
    "검토만 통과하면 된다",
    "결과물 예쁘다냥",
    "오늘 나 좀 멋있었다",
    "마감 지켰다!",
  ],
  error: [
    "어… 이게 왜 터지지",
    "빨간 글씨 무섭다냥",
    "내 코드 아니야… 아마",
    "다시 해볼게요",
    "로그 좀 보자…",
    "멘탈 잠깐 나갔다 옴",
    "꼬리가 바짝 섰다",
    "재부팅하면 되지 않을까",
    "누가 내 커피에 버그 탔어",
    "침착하자 침착하자",
    "한 번 더 해보면 될 거야",
    "실패도 경험이다옹",
    "도움 좀 받아야겠다",
    "이건 내일의 내가…",
    "오류랑 눈싸움 중",
  ],
  night: [
    "밤에 일하는 고양이",
    "야식 생각난다냥",
    "다들 퇴근했어?",
    "밤이라 집중 잘 된다",
    "내일 아침의 나에게 미안",
    "달 보면서 코딩 중",
    "졸리다옹…",
    "이것만 하고 잘게",
    "야근 수당 나오나?",
    "조용해서 좋다",
    "새벽 감성 코드",
    "눈 반쯤 감고 일하는 중",
    "불 끄고 가지 마세요",
    "밤샘은 오늘까지만",
    "고양이는 원래 야행성이다냥",
  ],
  morning: [
    "좋은 아침이다냥",
    "출근 완료!",
    "커피부터 마시자",
    "오늘은 일찍 끝내야지",
    "아침 회의 없지?",
    "일단 메일부터…",
    "어제 뭐 했더라",
    "상쾌하다옹",
    "오늘 할 일 정리 중",
    "아침밥 먹고 왔어?",
    "기지개 쭉~",
    "월요일 아니지?",
    "출근길 힘들었다냥",
    "오늘도 화이팅",
    "햇살 받으며 시작",
  ],
};

/** a cat working longer than this mutters about it */
const LONG_WORK_MS = 25 * 60 * 1000;

export interface ChatterInput {
  /** where the cat is and what it does: at its desk working, lounging, just finished, failed, stuck */
  state: "work" | "think" | "rest" | "done" | "fail" | "block";
  /** since when it's been in this state (ms) */
  since: number;
  now?: number;
}

/** One line to say, or null when this cat shouldn't talk (asking for permission shows its own bubble). */
export function pickLine({ state, since, now = Date.now() }: ChatterInput): string | null {
  const hour = new Date(now).getHours();
  const any = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  let mood: ChatterMood;
  if (state === "fail") mood = "error";
  else if (state === "block") mood = "ask";
  else if (state === "done") mood = "done";
  else if (state === "rest") mood = "rest";
  else mood = now - since > LONG_WORK_MS ? "longWork" : "work";
  // the time of day colors it now and then
  if ((mood === "work" || mood === "rest") && Math.random() < 0.35) {
    if (hour >= 22 || hour < 5) mood = "night";
    else if (hour >= 6 && hour < 10) mood = "morning";
  }
  return any(CHATTER[mood]);
}
