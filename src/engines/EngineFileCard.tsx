// A file an outside editor can open, shown in a report card. Light on purpose: the editor only
// starts when the person presses 열기.
import type { EngineDef } from "./types";

export function EngineFileCard({ engine, path, onOpen }: { engine: EngineDef; path: string; onOpen: () => void }) {
  const name = path.split(/[\\/]/).pop() || path;
  return (
    <div className="glass-soft flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-2.5">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[18px]" style={{ background: "var(--chip)" }}>
        {engine.icon}
      </span>
      <div className="min-w-0 flex-auto">
        <div className="truncate font-mono text-[12.5px] font-semibold" title={path}>
          {name}
        </div>
        <div className="text-[11.5px] text-ink-2">{engine.label} 파일 · 편집 화면에서 직접 고칠 수 있어요</div>
      </div>
      <button onClick={onOpen} className="min-h-8 shrink-0 rounded-full border-0 px-3.5 text-[12.5px] font-semibold" style={{ background: "var(--amber)", color: "#2B2520" }}>
        열기
      </button>
    </div>
  );
}
