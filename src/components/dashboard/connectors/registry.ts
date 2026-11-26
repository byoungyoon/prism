// 연결 종류 목록. 설명서(specs.ts) + 화면(connectors/*.tsx)을 종류 이름으로 맞춘다.
// 새 서비스: specs.ts에 항목 추가 → connectors/에 화면 파일 → 아래 UI 목록에 한 줄.
import type { WidgetKind } from "../../../lib/api";
import { SPECS, type ConnectorSpec } from "./specs.ts";
import { sheetUi } from "./sheet";
import { slackUi } from "./slack";
import type { ConnectorUI } from "./types";
import { webUi } from "./web";

const UI: Record<WidgetKind, ConnectorUI> = { web: webUi, sheet: sheetUi, slack: slackUi };

export type Connector = ConnectorSpec & ConnectorUI;

export const CONNECTORS: Connector[] = SPECS.map((s) => ({ ...s, ...UI[s.kind] }));

export const connectorOf = (kind: WidgetKind): Connector | undefined => CONNECTORS.find((c) => c.kind === kind);
