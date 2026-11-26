// 연결 종류별 '설명서' (순수 데이터·검사 함수). 설계도 검사(blueprint.ts)와 화면 양쪽이 같이 쓴다.
// 새 서비스 추가: 여기에 한 항목을 넣고, connectors/ 에 화면 파일을 만든 뒤 registry.ts 에 잇는다.
import type { WidgetKind } from "../../../lib/api";

export interface ConfigField {
  key: string;
  label: string;
  required: boolean;
}

export interface ConnectorSpec {
  kind: WidgetKind;
  name: string;
  emoji: string;
  /** 한 줄 설명 (빈 대시보드 카드에 쓴다) */
  blurb: string;
  size: { w: number; h: number };
  configSchema: ConfigField[];
  /** 설정 값 형식 검사. 비어 있는 칸은 통과 (아직 안 채운 칸은 화면에서 설정을 요청한다). 문제 있으면 쉬운 한국어 문장. */
  validateConfig(config: Record<string, string>): string | null;
  /** 이 칸을 쓰려면 사용자가 이 칸에서 로그인·연결해야 하는가 */
  needsLogin(config: Record<string, string>): boolean;
}

const httpUrl = (v: string): string | null => {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? null : "웹 주소는 http 또는 https로 시작해야 해요";
  } catch {
    return "웹 주소 형식이 맞지 않아요 (예: https://example.com)";
  }
};

export const SPECS: ConnectorSpec[] = [
  {
    kind: "web",
    name: "웹사이트",
    emoji: "🌐",
    blurb: "자주 보는 웹 페이지를 칸에 그대로 띄워요",
    size: { w: 6, h: 7 },
    configSchema: [
      { key: "url", label: "웹 주소", required: true },
      { key: "login", label: "로그인이 필요한 사이트 (1이면 예)", required: false },
    ],
    validateConfig: (c) => (c.url ? httpUrl(c.url) : null),
    needsLogin: (c) => c.login === "1",
  },
  {
    kind: "sheet",
    name: "엑셀·CSV 파일",
    emoji: "📊",
    blurb: "파일을 고르면 바뀔 때마다 자동으로 다시 읽어요",
    size: { w: 6, h: 7 },
    configSchema: [{ key: "path", label: "파일 경로 (csv·tsv·xlsx·xls)", required: true }],
    validateConfig: (c) => {
      if (!c.path) return null;
      return /\.(csv|tsv|xlsx|xls)$/i.test(c.path) ? null : "엑셀(xlsx·xls)이나 CSV·TSV 파일만 고를 수 있어요";
    },
    needsLogin: () => false,
  },
  {
    kind: "slack",
    name: "슬랙",
    emoji: "💬",
    blurb: "채널의 최근 메시지를 읽어 와요 (읽기만 해요)",
    size: { w: 4, h: 7 },
    configSchema: [
      { key: "channelId", label: "채널", required: true },
      { key: "channelName", label: "채널 이름", required: false },
    ],
    validateConfig: (c) => (c.channelId && !/^[CGD][A-Z0-9]+$/.test(c.channelId) ? "슬랙 채널 번호 형식이 맞지 않아요" : null),
    needsLogin: () => true,
  },
];

export const specOf = (kind: WidgetKind): ConnectorSpec | undefined => SPECS.find((s) => s.kind === kind);
