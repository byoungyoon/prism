// '하는 일을 설명해 주세요': 말로 적으면 AI가 설계도 초안을 만든다 → 검사 → 미리보기 → 이대로 만들기 / 다시 만들기 / 취소.
import { useState } from "react";
import { dashboardApi } from "../../lib/api";
import { connectorOf } from "./connectors/registry.ts";
import { applyBlueprint, validateBlueprint, type Blueprint } from "./blueprint.ts";
import { COLS } from "./grid.ts";
import { errText, useDash } from "./state.ts";

/** 미리보기: 칸 목록 + 배치 축소판 (실제 적용과 같은 자리 계산) */
export function DraftPreview({ draft, onApply, onRetry, onCancel }: { draft: Blueprint; onApply: () => void; onRetry: () => void; onCancel: () => void }) {
  const placed = applyBlueprint(draft).widgets;
  const rows = placed.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  const MINI = 10; // 미니 줄 높이 (px)
  return (
    <div className="dash-draft" role="region" aria-label="설계도 미리보기">
      <p className="dash-draft-title">이렇게 만들어 볼까요? ({placed.length}개 칸)</p>
      <div className="dash-mini" style={{ height: rows * MINI + 8 }}>
        {placed.map((w) => (
          <div key={w.id} className="dash-mini-cell" style={{ left: `${(w.x / COLS) * 100}%`, width: `${(w.w / COLS) * 100}%`, top: w.y * MINI, height: w.h * MINI - 2 }}>
            <span>{connectorOf(w.kind)?.emoji} {w.title}</span>
          </div>
        ))}
      </div>
      <ul className="dash-draft-list">
        {placed.map((w) => {
          const c = connectorOf(w.kind);
          const pending = !!c?.needsLogin(w.config);
          return (
            <li key={w.id}>
              <span>{c?.emoji} {w.title}</span>
              {pending && <span className="dash-badge">🔐 여기서 로그인해 주세요</span>}
            </li>
          );
        })}
      </ul>
      <p className="dash-hint">🔐 표시된 칸은 만든 뒤 그 칸에서 직접 로그인·연결하면 돼요.</p>
      <div className="dash-ask-row">
        <button className="dash-primary" onClick={onApply}>이대로 만들기</button>
        <button className="dash-link" onClick={onRetry}>다시 만들기</button>
        <button className="dash-link" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

export function DraftBox() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Blueprint | null>(null);

  const ask = async (description: string) => {
    setBusy(true);
    setErr(null);
    try {
      const raw = await dashboardApi.aiDashboardDraft(description);
      const check = validateBlueprint(raw);
      if (!check.ok) {
        setDraft(null);
        setErr(`AI가 만든 초안에 문제가 있어요: ${check.errors.slice(0, 3).join(" / ")}`);
        return;
      }
      setDraft(check.blueprint!);
    } catch (e) {
      setDraft(null);
      setErr(`초안을 만들지 못했어요: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const d = text.trim();
    if (d && !busy) void ask(d);
  };

  if (draft) {
    return (
      <DraftPreview
        draft={draft}
        onApply={() => {
          useDash.getState().update(() => applyBlueprint(draft).widgets);
          setDraft(null);
          setText("");
        }}
        onRetry={() => void ask(text.trim())}
        onCancel={() => setDraft(null)}
      />
    );
  }

  return (
    <div className="dash-draft-box">
      <label className="dash-field">
        <span>하는 일을 설명해 주세요</span>
        <div className="dash-ask-row">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="예: 고객 문의 엑셀에서 답 안 단 문의만 보고, 슬랙 고객센터 채널도 같이 보고 싶어요"
          />
          <button className="dash-primary" disabled={busy || !text.trim()} onClick={submit}>{busy ? "만드는 중…" : "초안 만들기"}</button>
        </div>
      </label>
      {err && <p role="alert" className="dash-err">{err}</p>}
    </div>
  );
}
