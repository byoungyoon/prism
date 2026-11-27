// 맨 위 '🧩 확장' 버튼과 확장 메뉴: 컴퓨터에서는 버튼 아래 팝오버, 휴대폰에서는 아래에서 올라오는 시트.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EXTENSIONS, type Extension } from "./registry";

const GROUPS = ["화면", "연결"] as const;

function Status({ useStatus }: { useStatus: NonNullable<Extension["useStatus"]> }) {
  const s = useStatus();
  return <span className="ext-status" data-tone={s.tone}>{s.text}</span>;
}

function ExtensionCard({ ext, expanded, onToggle, close }: { ext: Extension; expanded: boolean; onToggle: () => void; close: () => void }) {
  return (
    <li className="ext-card" data-open={expanded}>
      <button
        className="ext-head"
        aria-expanded={ext.Panel ? expanded : undefined}
        onClick={() => {
          if (ext.Panel) return onToggle();
          close();
          ext.open();
        }}
      >
        <span className="ext-emoji" aria-hidden="true">{ext.emoji}</span>
        <span className="ext-text">
          <b>{ext.name}</b>
          <small>{ext.blurb}</small>
        </span>
        {ext.useStatus && <Status useStatus={ext.useStatus} />}
        <span className="ext-arrow" aria-hidden="true">{!ext.Panel ? "›" : expanded ? "▴" : "▾"}</span>
      </button>
      {ext.Panel && expanded && (
        <div className="ext-panel">
          <ext.Panel close={close} />
        </div>
      )}
    </li>
  );
}

export function ExtensionButton() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setExpanded(null);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="확장"
        title="대시보드 열기, 웹사이트·엑셀·슬랙 연결"
        className="flex min-h-9 items-center gap-1.5 rounded-full px-3 max-[480px]:px-2 text-[12.5px] font-medium whitespace-nowrap"
        style={open ? { background: "var(--amber)", color: "#2B2520" } : { border: "1px solid var(--line)" }}
      >
        <span aria-hidden="true">🧩</span>
        <span className="max-[820px]:hidden">확장</span>
      </button>
      <AnimatePresence>
        {open && <div aria-hidden="true" onClick={close} className="fixed inset-0 z-40 hidden bg-black/25 max-[820px]:block" />}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="확장"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="absolute top-[calc(100%+8px)] right-0 z-50 flex max-h-[calc(100dvh-80px)] w-[380px] max-w-[calc(100vw-24px)] origin-top-right flex-col gap-3 overflow-y-auto rounded-2xl p-4 max-[820px]:fixed max-[820px]:inset-x-0 max-[820px]:top-auto max-[820px]:bottom-0 max-[820px]:max-h-[85dvh] max-[820px]:w-auto max-[820px]:max-w-none max-[820px]:rounded-b-none max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))]"
            style={{ background: "var(--bg2)", border: "1px solid var(--glass-border)", boxShadow: "var(--shadow)" }}
          >
            <div className="flex items-center gap-2">
              <span className="flex-auto text-[14px] font-semibold">🧩 확장</span>
              <button onClick={close} className="min-h-8 rounded-full bg-transparent px-3 text-[12px]" style={{ border: "1px solid var(--line)" }}>
                닫기
              </button>
            </div>
            {GROUPS.map((g) => (
              <section key={g} className="flex flex-col gap-2">
                <span className="text-[11.5px] font-semibold text-ink-2">{g}</span>
                <ul className="ext-list">
                  {EXTENSIONS.filter((e) => e.group === g).map((e) => (
                    <ExtensionCard key={e.id} ext={e} expanded={expanded === e.id} onToggle={() => setExpanded((x) => (x === e.id ? null : e.id))} close={close} />
                  ))}
                </ul>
              </section>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
