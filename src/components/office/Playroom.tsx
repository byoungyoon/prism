// 놀이방: 휴게실과 벽 하나를 두고 통로로 이어진 방. 같은 도트 그림에 바닥은 퍼즐 매트. 캣타워 · 숨숨집 · 공 · 낚싯대 · 창가 해먹은 처음부터
// 있고, 캣휠 · 캣 터널 · 장난감 상자는 상점에서 산다. data-play 표시는 고양이의 발이 놓이는 자리다
// (Office.tsx가 화면에서 재고, 어떤 놀이를 하는지는 playRules.ts).
import type { CSSProperties, ReactNode } from "react";

/** 고양이 발 자리: 놀이 도구 왼쪽 위에서 도트(--u) 단위로 */
const Mark = ({ name, x, y }: { name: string; x: number; y: number }) => (
  <span className="of-mark" data-play={name} style={{ left: `calc(var(--u) * ${x})`, top: `calc(var(--u) * ${y})` }} />
);

const Piece = ({ cls, sprite, children }: { cls: string; sprite: string; children?: ReactNode }) => <span className={`of-toy ${cls} px-${sprite}`}>{children}</span>;

export function Playroom({ count, has, ball }: { count: number; has: (item: string) => boolean; ball: number }) {
  return (
    <div className="of-playroom" data-playroom aria-hidden="true">
      <span className="of-lounge-name">놀이방{count ? ` · ${count}명` : ""}</span>
      <Piece cls="of-hammock" sprite="hammock">
        <Mark name="hammock" x={21} y={29} />
      </Piece>
      {/* 해먹 천의 앞자락은 고양이보다 앞에: 폭 파묻혀 보인다 */}
      <span className="of-toy of-hammock-lip px-hammocklip" />
      <Piece cls="of-ptower" sprite="ptower">
        <Mark name="tower-floor" x={5} y={59} />
        <Mark name="tower-1" x={26} y={43} />
        <Mark name="tower-2" x={12} y={27} />
        <Mark name="tower-3" x={26} y={8} />
      </Piece>
      <Piece cls="of-rod" sprite="rod">
        <span className="of-lure px-lure" />
        <Mark name="rod" x={21} y={35} />
      </Piece>
      <Piece cls="of-phouse" sprite="phouse">
        <Mark name="house" x={17} y={27} />
      </Piece>
      {has("캣휠") && (
        <Piece cls="of-wheel" sprite="wheel">
          <span className="of-spokes px-spokes" />
          <Mark name="wheel" x={18} y={32} />
          <Mark name="wheel-side" x={40} y={32} />
        </Piece>
      )}
      {has("장난감 상자") && <Piece cls="of-toybox" sprite="toybox" />}
      {has("캣 터널") && (
        <Piece cls="of-tunnel" sprite="tunnel">
          <Mark name="tunnel-a" x={3} y={17} />
          <Mark name="tunnel-b" x={37} y={17} />
        </Piece>
      )}
      {/* 공이 구르는 길: 공은 길의 0‥1 자리에 놓인다 */}
      <span className="of-balltrack" data-balltrack>
        <span className="of-ball" style={{ left: `${ball * 100}%`, "--turn": `${Math.round(ball * 8) * 90}deg` } as CSSProperties}>
          <span className="of-ball-art px-ball" />
        </span>
      </span>
    </div>
  );
}
