// 연결 칸 화면 파일이 맞춰야 하는 모양. 설명서(specs.ts)와 짝을 이룬다.
import type { ComponentType } from "react";
import type { Widget } from "../../../lib/api";

export interface FormProps {
  widget: Widget;
  onConfig: (config: Record<string, string>) => void;
}

export interface BodyProps {
  widget: Widget;
}

export interface ConnectorUI {
  /** 설정 폼 (칸 안에서 연결·로그인·고르기) */
  Form: ComponentType<FormProps>;
  /** 원본 본문 */
  Body: ComponentType<BodyProps>;
  /** AI에 넘길 텍스트 */
  getData(widget: Widget): Promise<string>;
  /** 칸 제목 밑에 보일 짧은 말 (예: 채널 이름) */
  subtitle(widget: Widget): string;
  /** 칸을 지울 때 정리할 일 (웹 창 닫기 등) */
  onRemove?(widget: Widget): void;
}
