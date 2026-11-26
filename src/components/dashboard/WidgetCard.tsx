// 칸 하나: 제목 바(끌어 옮기기) · 본문(연결 설정 / 원본 / AI 결과) · '이렇게 보여줘' 입력 · 모서리 크기 손잡이.
import { useState, type CSSProperties, type PointerEvent as RPE } from "react";
import { dashboardApi, type AiView, type Widget } from "../../lib/api";
import { AiResult } from "./AiResult";
import { connectorOf } from "./connectors/registry.ts";
import { errText, patchWidget } from "./state.ts";

/** 입력창 예시 (칸마다 돌아가며 보여 준다) */
const EXAMPLES = ["답 안 단 문의만 표로", "이번 주 매출 합계 그래프로", "중요한 메시지만 요약"];
const stop = (e: RPE) => e.stopPropagation();

interface Props {
  widget: Widget;
  index: number;
  style: CSSProperties;
  onStart: (e: RPE<HTMLElement>, mode: "move" | "resize") => void;
  onRemove: () => void;
}

export function WidgetCard({ widget, index, style, onStart, onRemove }: Props) {
  const c = connectorOf(widget.kind);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(widget.view?.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!c) return null;

  const ready = c.configSchema.filter((f) => f.required).every((f) => !!widget.config[f.key]);
  const needsLogin = c.needsLogin(widget.config);
  const showForm = editing || !ready;
  const result: AiView | undefined = widget.view?.result;
  const showAi = !!result && widget.view?.showOriginal === false;

  const setView = (view: Widget["view"]) => patchWidget(widget.id, { view });
  const onConfig = (config: Record<string, string>) => {
    patchWidget(widget.id, { config });
    setEditing(false);
  };

  const run = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const data = await c.getData(widget);
      const r = await dashboardApi.aiTransform(p, data, widget.kind);
      setView({ prompt: p, result: r, showOriginal: false });
    } catch (e) {
      setErr(`AI 보기를 만들지 못했어요: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dash-card" style={style} aria-label={`${c.name} 칸`}>
      <header className="dash-card-head" onPointerDown={(e) => onStart(e, "move")} title="끌어서 옮기기">
        <span className="dash-card-emoji" aria-hidden="true">{c.emoji}</span>
        <div className="dash-card-name">
          <b>{c.name}</b>
          <small>{c.subtitle(widget)}</small>
        </div>
        {!ready && <span className="dash-badge">{needsLogin ? "🔐 여기서 연결" : "설정 필요"}</span>}
        {ready && (
          <button className="dash-icon" aria-label="연결 설정" aria-pressed={editing} onPointerDown={stop} onClick={() => setEditing((v) => !v)}>⚙</button>
        )}
        <button className="dash-icon" aria-label="칸 지우기" onPointerDown={stop} onClick={onRemove}>✕</button>
      </header>

      <div className="dash-card-body">
        {showForm ? <c.Form widget={widget} onConfig={onConfig} /> : showAi ? <AiResult view={result!} /> : <c.Body widget={widget} />}
        {busy && <div className="dash-busy" role="status">AI가 보고 있어요…</div>}
      </div>

      {ready && !showForm && (
        <footer className="dash-ask">
          {err && <p role="alert" className="dash-err">{err}</p>}
          <div className="dash-ask-row">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void run()}
              placeholder={`이렇게 보여줘 · 예: ${EXAMPLES[index % EXAMPLES.length]}`}
              aria-label="이렇게 보여줘"
            />
            <button className="dash-primary" disabled={busy || !prompt.trim()} onClick={() => void run()}>
              {busy ? "보는 중" : "보기"}
            </button>
          </div>
          {result && (
            <div className="dash-ask-row small">
              <button className="dash-link" onClick={() => setView({ prompt: widget.view?.prompt ?? prompt, result, showOriginal: showAi })}>
                {showAi ? "원본 보기" : "AI 보기"}
              </button>
              <button className="dash-link" onClick={() => { setView(undefined); setPrompt(""); }}>지우기</button>
            </div>
          )}
        </footer>
      )}

      <div className="dash-handle" role="separator" aria-label="크기 바꾸기" onPointerDown={(e) => onStart(e, "resize")} />
    </section>
  );
}
