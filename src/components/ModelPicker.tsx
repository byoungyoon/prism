import { motion } from "motion/react";
import type { Effort } from "../lib/api";
import { EFFORTS, FAMILIES, findModel } from "../data/models";

const spring = { type: "spring" as const, stiffness: 380, damping: 32 };

/** Family pills (Fable/Opus/Sonnet/Haiku) + version pills, with a sliding highlight. */
export function ModelPicker({ value, onChange, uid, compact }: { value: string; onChange: (id: string) => void; uid: string; compact?: boolean }) {
  const cur = findModel(value);
  const fam = cur?.family ?? FAMILIES[1];
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="모델 계열" className="grid grid-cols-4 gap-0.5 rounded-xl p-[3px]" style={{ background: "var(--chip)" }}>
        {FAMILIES.map((f) => {
          const on = f.family === fam.family;
          return (
            <button
              key={f.family}
              role="radio"
              aria-checked={on}
              title={f.note}
              onClick={() => !on && onChange(f.versions[0].id)}
              className={`relative rounded-[9px] border-0 bg-transparent ${compact ? "min-h-7 text-[12px]" : "min-h-8 text-[12.5px]"} font-medium`}
              style={{ color: on ? "var(--text)" : "var(--text2)" }}
            >
              {on && (
                <motion.span
                  layoutId={`${uid}-fam`}
                  transition={spring}
                  className="absolute inset-0 rounded-[9px]"
                  style={{ background: "var(--tile)", boxShadow: "0 2px 8px rgba(120,90,50,0.14), inset 0 1px 0 var(--glass-border)" }}
                />
              )}
              <span className="relative">{f.label}</span>
            </button>
          );
        })}
      </div>
      <div role="radiogroup" aria-label={`${fam.label} 버전`} className="flex flex-wrap items-center gap-1">
        {fam.versions.map((v) => {
          const on = v.id === value;
          return (
            <button
              key={v.id}
              role="radio"
              aria-checked={on}
              onClick={() => onChange(v.id)}
              className="relative min-h-6 rounded-full border-0 bg-transparent px-2.5 font-mono text-[11.5px]"
              style={{ color: on ? "#2B2520" : "var(--text2)" }}
            >
              {on && <motion.span layoutId={`${uid}-ver`} transition={spring} className="absolute inset-0 rounded-full" style={{ background: "var(--amber)" }} />}
              <span className="relative">{v.label}</span>
            </button>
          );
        })}
        {!compact && cur && (
          <span className="ml-auto font-mono text-[11px] text-ink-2" title="1M 토큰당 입력 / 출력">
            ${cur.version.price[0]} / ${cur.version.price[1]}
          </span>
        )}
      </div>
    </div>
  );
}

/** Five rising bars; everything up to the chosen level lights up. */
export function EffortPicker({ value, onChange, uid }: { value: Effort; onChange: (e: Effort) => void; uid: string }) {
  const idx = EFFORTS.findIndex((e) => e.id === value);
  return (
    <div className="flex items-end gap-3">
      <div role="radiogroup" aria-label="생각 깊이" className="flex items-end gap-1">
        {EFFORTS.map((e, i) => {
          const lit = i <= idx;
          return (
            <button
              key={e.id}
              role="radio"
              aria-checked={i === idx}
              aria-label={e.label}
              title={e.label}
              onClick={() => onChange(e.id)}
              className="group flex h-7 w-5 items-end justify-center border-0 bg-transparent p-0"
            >
              <motion.span
                className="block w-full rounded-[4px]"
                initial={false}
                animate={{ height: 8 + i * 4.5, backgroundColor: lit ? "var(--amber)" : "var(--chip)" }}
                transition={{ ...spring, delay: lit ? i * 0.03 : 0 }}
                style={{ boxShadow: lit ? "0 0 10px rgba(232,161,90,0.45)" : "inset 0 0 0 1px var(--line)" }}
              />
            </button>
          );
        })}
      </div>
      <motion.span key={`${uid}-${value}`} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} className="pb-0.5 text-[12.5px] font-medium">
        {idx >= 0 ? EFFORTS[idx].label : "CLI 기본값"}
      </motion.span>
    </div>
  );
}
