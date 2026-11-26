// AI가 바꾼 결과 그리기: 표 · 요약 · 막대/선 그래프 (SVG 직접). 색은 dataviz 검증을 통과한 3색 (첫 3계열만).
import type { AiView } from "../../lib/api";

const SERIES_COLOR = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];
const MAX_SERIES = 3;
const cell = (v: unknown) => (v == null ? "" : String(v));

/** 보기 좋은 눈금 상한 (1·2·5 × 10^n) */
function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function Chart({ chart }: { chart: NonNullable<AiView["chart"]> }) {
  const series = chart.series.slice(0, MAX_SERIES);
  const labels = chart.labels;
  const W = 360, H = 190, L = 40, R = 10, T = 14, B = 28;
  const plotW = W - L - R, plotH = H - T - B;
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const y = (v: number) => T + plotH - (v / top) * plotH;
  const groupW = plotW / Math.max(1, labels.length);
  const every = Math.ceil(labels.length / 8); // 라벨이 많으면 몇 개 건너뛰어 보인다
  const ticks = [0, top / 2, top];
  const showValues = labels.length * series.length <= 12; // 많으면 숫자는 아래 표에서 본다

  return (
    <div className="dash-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${chart.kind === "bar" ? "막대" : "선"} 그래프`} className="dash-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="dash-grid" />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" className="dash-axis">{Math.round(t).toLocaleString("ko-KR")}</text>
          </g>
        ))}
        {chart.kind === "bar" &&
          labels.map((lab, i) => {
            const k = series.length;
            const gap = 2;
            const bw = Math.min(24, (groupW * 0.7 - gap * (k - 1)) / k);
            const x0 = L + i * groupW + (groupW - (bw * k + gap * (k - 1))) / 2;
            return series.map((s, j) => {
              const v = s.values[i] ?? 0;
              const x = x0 + j * (bw + gap);
              const base = y(0);
              const topY = y(v);
              const r = Math.max(0, Math.min(4, bw / 2, (base - topY) / 2));
              const d = `M${x},${base} L${x},${topY + r} Q${x},${topY} ${x + r},${topY} L${x + bw - r},${topY} Q${x + bw},${topY} ${x + bw},${topY + r} L${x + bw},${base} Z`;
              return (
                <g key={`${i}-${j}`}>
                  <path d={d} style={{ fill: SERIES_COLOR[j] }}><title>{`${lab} · ${s.name}: ${v.toLocaleString("ko-KR")}`}</title></path>
                  {showValues && <text x={x + bw / 2} y={topY - 4} textAnchor="middle" className="dash-value">{v.toLocaleString("ko-KR")}</text>}
                </g>
              );
            });
          })}
        {chart.kind === "line" &&
          series.map((s, j) => {
            const pts = s.values.map((v, i) => [L + i * groupW + groupW / 2, y(v)] as const);
            return (
              <g key={j}>
                <polyline points={pts.map((p) => p.join(",")).join(" ")} className="dash-line" style={{ stroke: SERIES_COLOR[j] }} />
                {pts.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={4} className="dash-dot" style={{ fill: SERIES_COLOR[j] }}>
                    <title>{`${labels[i] ?? ""} · ${s.name}: ${(s.values[i] ?? 0).toLocaleString("ko-KR")}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        {labels.map((lab, i) => (i % every === 0 ? <text key={i} x={L + i * groupW + groupW / 2} y={H - 8} textAnchor="middle" className="dash-axis">{lab}</text> : null))}
      </svg>
      {series.length >= 2 && (
        <ul className="dash-legend" aria-label="범례">
          {series.map((s, j) => (
            <li key={j}><i style={{ background: SERIES_COLOR[j] }} />{s.name}</li>
          ))}
        </ul>
      )}
      {chart.series.length > MAX_SERIES && <p className="dash-hint">계열이 {chart.series.length}개라 앞의 {MAX_SERIES}개만 그렸어요.</p>}
      <details className="dash-numbers">
        <summary>숫자로 보기</summary>
        <table className="dash-table">
          <thead><tr><th>항목</th>{series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
          <tbody>
            {labels.map((lab, i) => (
              <tr key={i}><td>{lab}</td>{series.map((s) => <td key={s.name}>{(s.values[i] ?? 0).toLocaleString("ko-KR")}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function AiResult({ view }: { view: AiView }) {
  return (
    <div className="dash-ai">
      <p className="dash-ai-title">{view.title}</p>
      {view.type === "table" && (
        <div className="dash-scroll">
          <table className="dash-table">
            <thead><tr>{(view.columns ?? []).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
            <tbody>
              {(view.rows ?? []).map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === "number" ? "num" : undefined}>{cell(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.type === "summary" && <p className="dash-summary">{view.text}</p>}
      {view.type === "chart" && view.chart && <Chart chart={view.chart} />}
    </div>
  );
}
