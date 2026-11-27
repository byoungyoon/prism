// 다시 시작 on a broken member: it goes on with the same card.
import { useState } from "react";
import { useApp } from "../store";

export function RestartButton({ projectId, agentId, name }: { projectId: string; agentId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={() => {
        setBusy(true);
        void useApp.getState().restartAgent(projectId, agentId).finally(() => setBusy(false));
      }}
      disabled={busy}
      aria-label={`${name} 다시 시작`}
      title="같은 작업을 이어서 다시 시작해요"
      className="min-h-7 shrink-0 cursor-pointer rounded-full border-0 px-3 text-[12px] font-semibold disabled:opacity-60"
      style={{ background: "var(--block)", color: "#fff" }}
    >
      {busy ? "다시 시작하는 중…" : "다시 시작"}
    </button>
  );
}
