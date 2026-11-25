// 상점: 츄르로 고양이 털색과 휴게실 소품을 산다. 고양이 탭·소품 탭, 물건마다 그림·이름·가격과 [사기]/[보유].
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useApp } from "../store";
import { SHOP, type ShopEntry } from "../lib/shop";
import { COATS } from "./critters/pixel/coats";

const spring = { type: "spring" as const, stiffness: 320, damping: 30 };

/** 그림: 고양이는 털색을 칠한 얼굴 조각, 소품은 이모지 한 개 */
function Picture({ e }: { e: ShopEntry }) {
  if (e.kind === "item") {
    return (
      <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-[12px] text-[26px]" style={{ background: "var(--chip)" }}>
        {e.icon}
      </span>
    );
  }
  const coat = COATS.find((c) => c.id === e.coat);
  return (
    <span aria-hidden="true" className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[12px]" style={{ background: "var(--chip)" }}>
      <span className="absolute top-[9px] left-[12px] size-0 border-x-[6px] border-b-[9px] border-x-transparent" style={{ borderBottomColor: coat?.ear }} />
      <span className="absolute top-[9px] right-[12px] size-0 border-x-[6px] border-b-[9px] border-x-transparent" style={{ borderBottomColor: coat?.ear }} />
      <span className="absolute bottom-[6px] h-[26px] w-[32px] rounded-[14px]" style={{ background: coat?.top, boxShadow: `inset 0 -6px 0 ${coat?.chest ?? coat?.top}` }} />
      <span className="absolute top-[18px] size-[6px] rounded-full" style={{ left: 16, background: coat?.eye }} />
      <span className="absolute top-[18px] size-[6px] rounded-full" style={{ right: 16, background: coat?.eye }} />
    </span>
  );
}

function Card({ e, owned, churu, busy, onBuy }: { e: ShopEntry; owned: boolean; churu: number; busy: boolean; onBuy: () => void }) {
  const short = !owned && churu < e.price;
  return (
    <li className="flex items-center gap-3 rounded-2xl p-3" style={{ border: "1px solid var(--line)" }}>
      <Picture e={e} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13.5px] font-semibold">{e.name}</span>
        {e.hint && <span className="truncate text-[11.5px] text-ink-2">{e.hint}</span>}
        <span className="font-mono text-[12px] text-ink-2">{owned ? "이미 가진 물건" : `${e.price.toLocaleString("ko-KR")} 츄르`}</span>
        {short && <span className="text-[11.5px]" style={{ color: "var(--block)" }}>츄르가 {(e.price - churu).toLocaleString("ko-KR")}개 모자라요</span>}
      </div>
      {owned ? (
        <span className="shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-medium text-ink-2" style={{ background: "var(--chip)" }}>
          보유
        </span>
      ) : (
        <button
          onClick={onBuy}
          disabled={short || busy}
          aria-label={`${e.name} 사기 (${e.price}츄르)`}
          className="shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold disabled:opacity-45"
          style={{ background: "var(--navy)", color: "var(--me-fg)" }}
        >
          사기
        </button>
      )}
    </li>
  );
}

export function ShopSheet() {
  const open = useApp((s) => s.shopOpen);
  const close = () => useApp.getState().openShop(false);
  const churu = useApp((s) => s.churu);
  const owned = useApp((s) => s.owned);
  const buyItem = useApp((s) => s.buyItem);
  const [tab, setTab] = useState<"cat" | "item">("cat");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const buy = async (e: ShopEntry) => {
    setBusy(true);
    setNote(null);
    const err = await buyItem(e.id, e.price);
    setBusy(false);
    if (err) setNote(err);
    else setNote(`${e.name}을(를) 샀어요`);
  };

  const list = SHOP.filter((e) => e.kind === tab);

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="shop" className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div aria-hidden="true" onClick={close} className="absolute inset-0 bg-black/30" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="상점"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={spring}
            className="relative flex max-h-[84vh] w-[480px] max-w-full flex-col gap-3 overflow-hidden rounded-2xl p-5"
            style={{ background: "color-mix(in srgb, var(--bg2) 97%, transparent)", border: "1px solid var(--glass-border)", boxShadow: "var(--shadow)" }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[16px] font-semibold">츄르 상점</span>
                <span className="text-[12px] text-ink-2">츄르로 고양이 털색과 휴게실 물건을 살 수 있어요</span>
              </div>
              <span className="rounded-full px-3 py-1.5 font-mono text-[13px] font-semibold" style={{ background: "var(--chip)" }}>
                츄르 {churu.toLocaleString("ko-KR")}개
              </span>
            </div>

            <div role="tablist" aria-label="상점 목록" className="flex gap-2">
              {(
                [
                  ["cat", "고양이"],
                  ["item", "소품"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className="min-h-9 rounded-full px-4 text-[12.5px] font-medium"
                  style={tab === k ? { background: "var(--navy)", color: "var(--me-fg)" } : { border: "1px solid var(--line)" }}
                >
                  {label}
                </button>
              ))}
            </div>

            <p aria-live="polite" className="m-0 min-h-[18px] text-[12px]" style={{ color: note && note.endsWith("샀어요") ? "var(--work)" : "var(--block-ink)" }}>
              {note ?? ""}
            </p>

            <ul className="m-0 flex list-none flex-col gap-2 overflow-y-auto p-0 pr-1">
              {list.map((e) => (
                <Card key={e.id} e={e} owned={owned.includes(e.id)} churu={churu} busy={busy} onBuy={() => void buy(e)} />
              ))}
            </ul>

            <div className="flex justify-end">
              <button onClick={close} className="min-h-9 rounded-full px-4 text-[12.5px] font-medium" style={{ border: "1px solid var(--line)" }}>
                닫기
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
