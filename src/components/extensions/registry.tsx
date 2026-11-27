// 확장 목록. 확장 메뉴는 이 목록을 카드로 그리기만 한다.
// 새 확장: Extension 하나를 만들어 EXTENSIONS 에 한 줄 넣는다.
// 새 연결(플러그인)은 dashboard/connectors/ 에 넣으면 여기에 저절로 나온다.
import { useEffect, type ComponentType } from "react";
import { useApp } from "../../store";
import { CONNECTORS, type Connector } from "../dashboard/connectors/registry.ts";
import type { LinkStatus } from "../dashboard/connectors/types";
import { addWidget, loadDashboard, useDash } from "../dashboard/state.ts";

export interface PanelProps {
  /** 확장 메뉴 닫기 */
  close: () => void;
}

interface Base {
  id: string;
  group: "화면" | "연결";
  emoji: string;
  name: string;
  blurb: string;
  /** 카드 오른쪽에 보일 상태 */
  useStatus?: () => LinkStatus;
}

/** 카드를 누르면 화면을 열거나(open), 카드 아래에 설정을 펼친다(Panel) */
export type Extension = Base & ({ open: () => void; Panel?: never } | { open?: never; Panel: ComponentType<PanelProps> });

const dashboard: Extension = {
  id: "dashboard",
  group: "화면",
  emoji: "📊",
  name: "대시보드",
  blurb: "자주 보는 웹·파일·슬랙을 한 화면에 모아 봐요",
  open: () => useApp.getState().setDashboardOpen(true),
};

function connectorExtension(c: Connector): Extension {
  const account = c.account;

  /** 대시보드에 이 연결의 칸을 만들고 대시보드를 연다 */
  const addAndShow = (config: Record<string, string>, close: () => void) => {
    addWidget(c.kind, config);
    close();
    useApp.getState().setDashboardOpen(true);
  };

  function Panel({ close }: PanelProps) {
    const loaded = useDash((s) => s.loaded);
    if (account) {
      return (
        <>
          <account.Panel />
          <button className="dash-link self-start" disabled={!loaded} onClick={() => addAndShow({}, close)}>
            대시보드에 {c.name} 칸 추가하기
          </button>
        </>
      );
    }
    // 계정 연결이 없는 서비스는 칸마다 설정한다: 여기서 설정하면 칸이 만들어진다
    if (!loaded) return <p className="dash-hint">대시보드를 불러오는 중…</p>;
    return (
      <>
        <p className="dash-hint">여기서 설정하면 대시보드에 새 칸이 생겨요.</p>
        <c.Form widget={{ id: `new-${c.kind}`, kind: c.kind, title: c.name, x: 0, y: 0, ...c.size, config: {} }} onConfig={(config) => addAndShow(config, close)} />
      </>
    );
  }

  /** 계정 연결이 없는 서비스의 상태: 대시보드에 설정해 둔 칸 수 */
  function useWidgetCount(): LinkStatus {
    const loaded = useDash((s) => s.loaded);
    const n = useDash((s) => s.widgets.filter((w) => w.kind === c.kind).length);
    useEffect(() => {
      if (!loaded) void loadDashboard();
    }, [loaded]);
    if (!loaded) return { text: "확인 중", tone: "idle" };
    return n ? { text: `칸 ${n}개`, tone: "on" } : { text: "아직 없음", tone: "idle" };
  }

  /** 계정 연결 서비스도 칸을 추가할 수 있게 저장된 대시보드를 읽어 둔다 */
  function useAccountStatus(): LinkStatus {
    useWidgetCount();
    return account!.useStatus();
  }

  return {
    id: c.kind,
    group: "연결",
    emoji: c.emoji,
    name: c.name,
    blurb: c.blurb,
    useStatus: account ? useAccountStatus : useWidgetCount,
    Panel,
  };
}

export const EXTENSIONS: Extension[] = [dashboard, ...CONNECTORS.map(connectorExtension)];
