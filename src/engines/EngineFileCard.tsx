// A file an outside editor can open, shown in a report card. Light on purpose: the editor only
// starts when the person presses 열기. If this build has no editor for the file, the card says so
// and offers the plain view (내용 보기) instead.
import { useEffect, useState } from "react";
import type { EngineDef } from "./types";
import { engineAvailable } from "./registry";

// `status`: the line under the name while the file is still being worked on ("팀원 · 그리는 중")
export function EngineFileCard({ engine, path, status, onOpen, onView }: { engine: EngineDef; path: string; status?: string; onOpen: () => void; onView?: () => void }) {
  const name = path.split(/[\\/]/).pop() || path;
  // undefined while the check runs
  const [installed, setInstalled] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    engineAvailable(engine).then((ok) => alive && setInstalled(ok));
    return () => {
      alive = false;
    };
  }, [engine]);

  const note = status
    ? `${status}${installed === false ? " · 편집기 설치 필요" : ""}`
    : installed === undefined
      ? "편집기를 준비하는 중…"
      : installed
        ? `${engine.label} 파일 · 편집 화면에서 직접 고칠 수 있어요`
        : "이 파일을 고치는 편집기가 이 앱에 설치돼 있지 않아요 (설치 필요)";

  return (
    <div className="glass-soft flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-2.5">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[18px]" style={{ background: "var(--chip)" }}>
        {engine.icon}
      </span>
      <div className="min-w-0 flex-auto">
        <div className="truncate font-mono text-[12.5px] font-semibold" title={path}>
          {name}
        </div>
        <div className="text-[11.5px] text-ink-2" role="status">
          {note}
        </div>
      </div>
      {installed === false ? (
        onView && (
          <button onClick={onView} className="min-h-8 shrink-0 rounded-full px-3.5 text-[12.5px]" style={{ border: "1px solid var(--line)", background: "var(--tile)" }}>
            내용 보기
          </button>
        )
      ) : (
        <button
          onClick={onOpen}
          disabled={installed === undefined}
          className="min-h-8 shrink-0 rounded-full border-0 px-3.5 text-[12.5px] font-semibold disabled:opacity-50"
          style={{ background: "var(--amber)", color: "#2B2520" }}
        >
          열기
        </button>
      )}
    </div>
  );
}
