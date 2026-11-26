// 상점: 고양이 탭은 츄르로 '뽑기'(확률표·보유 목록·뽑기 연출), 소품 탭은 물건마다 그림·이름·가격과 [사기]/[보유].
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useApp } from "../store";
import { api, type GachaInfo } from "../lib/api";
import { RARITY_CLASS, SHOP, type ShopEntry } from "../lib/shop";
import { COATS, type Coat } from "./critters/pixel/coats";
import { FH, FW, K } from "./critters/pixel/art";
import { strip } from "./critters/pixel/render";
import { ART_SIZE, shopArt } from "./shopArt";

const spring = { type: "spring" as const, stiffness: 320, damping: 30 };

/** 뽑기 연출 한 번: 흔들기(1.1초) → 열기(0.9초) → 끝(잔액·보유·사무실 반영) */
const SHAKE_MS = 1100;
const DONE_MS = 2000;

/** 도트 그림 한 장 (소품·뽑기 상자) */
function PixelArt({ name }: { name: string }) {
  return <img src={shopArt(name)} width={ART_SIZE} height={ART_SIZE} alt="" draggable={false} style={{ imageRendering: "pixelated" }} />;
}

/** 소품 그림 */
function ItemPicture({ e }: { e: ShopEntry }) {
  return (
    <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-[12px]" style={{ background: "var(--chip)" }}>
      <PixelArt name={e.name} />
    </span>
  );
}

/** 사무실과 같은 도트 고양이가 앉은 모습. silhouette면 털색 없이 회색 그림자 (아직 못 얻은 고양이) */
function CatPicture({ coat, silhouette = false }: { coat: Coat; silhouette?: boolean }) {
  // 그림 한 칸(FW·K × FH·K)에서 위쪽 빈 곳(감정 표시 자리)은 잘라내고 보여준다. 그림자 모양은 흰 고양이로 통일
  const url = strip(silhouette ? COATS[0] : coat, "look", [1], "plain");
  return (
    <span aria-hidden="true" className="relative block size-14 shrink-0 overflow-hidden rounded-[12px]" style={{ background: "var(--chip)" }}>
      <img
        src={url}
        width={FW * K}
        height={FH * K}
        alt=""
        draggable={false}
        className="absolute top-[-7px] left-[4px] max-w-none"
        style={{ imageRendering: "pixelated", filter: silhouette ? "brightness(0) invert(0.5)" : undefined, opacity: silhouette ? 0.35 : 1 }}
      />
    </span>
  );
}

/** 등급 표시: 등급마다 다른 색의 작은 알약 (레전더리만 은은하게 반짝인다) */
function RarityBadge({ tier }: { tier: string }) {
  return <span className={`rarity ${RARITY_CLASS[tier] ?? "rarity-base"}`}>{tier}</span>;
}

function ItemCard({ e, owned, churu, busy, onBuy }: { e: ShopEntry; owned: boolean; churu: number; busy: boolean; onBuy: () => void }) {
  const short = !owned && churu < e.price;
  return (
    <li className="flex items-center gap-3 rounded-2xl p-3" style={{ border: "1px solid var(--line)" }}>
      <ItemPicture e={e} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13.5px] font-semibold">{e.name}</span>
        <span className="truncate text-[11.5px] text-ink-2">{e.hint}</span>
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

/** 뽑기 연출 상태. stage: 흔드는 중 → 열리는 중 → 끝 (끝나야 잔액·보유가 바뀐다) */
type Reveal = { stage: "shake" | "open" | "done"; cat: string; isNew: boolean };

export function ShopSheet() {
  const open = useApp((s) => s.shopOpen);
  const close = () => useApp.getState().openShop(false);
  const churu = useApp((s) => s.churu);
  const owned = useApp((s) => s.owned);
  const buyItem = useApp((s) => s.buyItem);
  const startGacha = useApp((s) => s.startGacha);
  const releaseGacha = useApp((s) => s.releaseGacha);
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<"cat" | "item">("cat");
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<GachaInfo | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  /** 뽑기 요청~연출 끝까지 true: 중복 클릭 방지 */
  const pulling = useRef(false);
  /** 상점이 열려 있는 동안만 true (닫힌 뒤 도착한 응답·타이머가 상태를 건드리지 않게) */
  const alive = useRef(false);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  /** 상점을 닫으면 연출을 멈추고, 미뤄 둔 잔액·보유 반영을 한다 (뽑기 결과는 이미 저장돼 있다) */
  const reset = () => {
    alive.current = false;
    pulling.current = false;
    clearTimers();
    setReveal(null);
    releaseGacha();
  };

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    alive.current = true;
    setNote(null);
    void api.gachaInfo().then(setInfo).catch(() => {});
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => clearTimers(), []);

  const buy = async (e: ShopEntry) => {
    setBusy(true);
    setNote(null);
    const err = await buyItem(e.id);
    setBusy(false);
    setNote(err ? { text: err, ok: false } : { text: `${e.name}을(를) 샀어요`, ok: true });
  };

  const pull = async () => {
    if (pulling.current) return;
    pulling.current = true;
    setNote(null);
    const r = await startGacha();
    if (!alive.current) {
      // 뽑는 사이에 상점을 닫았다: 결과는 저장돼 있고 반영은 이미 풀렸다
      releaseGacha();
      pulling.current = false;
      return;
    }
    if (!r.ok) {
      pulling.current = false;
      setNote({ text: r.reason, ok: false });
      return;
    }
    const { cat, isNew } = r.res;
    if (reduce) {
      // 동작 줄이기: 연출 없이 바로 결과
      setReveal({ stage: "done", cat, isNew });
      releaseGacha();
      pulling.current = false;
      return;
    }
    setReveal({ stage: "shake", cat, isNew });
    timers.current.push(
      window.setTimeout(() => setReveal((v) => (v ? { ...v, stage: "open" } : v)), SHAKE_MS),
      window.setTimeout(() => {
        setReveal((v) => (v ? { ...v, stage: "done" } : v));
        releaseGacha();
        pulling.current = false;
      }, DONE_MS),
    );
  };

  const have = (coat: string) => owned.includes(`cat:${coat}`);
  const animating = reveal !== null && reveal.stage !== "done";
  const price = info?.price ?? 0;
  const short = Math.max(0, price - churu);
  const allCollected = info !== null && info.cats.every((c) => have(c.id));
  const pullDisabled = !info || animating || allCollected || short > 0;
  const revealCoat = reveal ? COATS.find((c) => `cat:${c.id}` === reveal.cat) : undefined;
  const revealWord = revealCoat?.word ?? "";
  /** 고양이 등급: 흰 고양이는 '기본', 나머지는 뽑기 정보에서 */
  const tierOf = (id: string) => (id === "white" ? "기본" : info?.cats.find((x) => x.id === id)?.tier ?? "");
  const revealTier = revealCoat ? tierOf(revealCoat.id) : "";
  const list = SHOP;

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
                <span className="text-[12px] text-ink-2">고양이는 뽑기로, 휴게실 물건은 상점에서 얻어요</span>
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

            {tab === "cat" ? (
              <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                {/* 뽑기 패널: 연출 칸 + 버튼 */}
                <div className="flex items-center gap-3 rounded-2xl p-3" style={{ border: "1px solid var(--line)" }}>
                  <span className="flex size-16 shrink-0 items-center justify-center rounded-[16px]" style={{ background: "var(--chip)" }}>
                    {!reveal || reveal.stage === "shake" ? (
                      <motion.span
                        aria-hidden="true"
                        animate={reveal && !reduce ? { rotate: [0, -8, 8, -8, 8, 0], x: [0, -3, 3, -3, 3, 0] } : undefined}
                        transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <PixelArt name="뽑기 상자" />
                      </motion.span>
                    ) : revealCoat ? (
                      <motion.span initial={reduce ? false : { scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring}>
                        <CatPicture coat={revealCoat} />
                      </motion.span>
                    ) : null}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span role="status" aria-live="polite" className="text-[13.5px] font-semibold">
                      {!reveal ? "고양이 뽑기" : reveal.stage === "shake" ? "두근두근…" : reveal.isNew ? "새 고양이!" : "이미 가진 고양이"}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-2">
                      {reveal && reveal.stage !== "shake" ? (
                        <>
                          {revealTier && <RarityBadge tier={revealTier} />}
                          <span>{revealWord} 고양이</span>
                        </>
                      ) : (
                        `한 번에 ${price.toLocaleString("ko-KR")}츄르 (같은 고양이가 나와도 값은 같아요)`
                      )}
                    </span>
                    {allCollected ? (
                      <span className="text-[11.5px]" style={{ color: "var(--block-ink)" }}>고양이를 모두 모았어요</span>
                    ) : (
                      short > 0 && <span className="text-[11.5px]" style={{ color: "var(--block)" }}>츄르가 {short.toLocaleString("ko-KR")}개 모자라요</span>
                    )}
                  </div>
                  <button
                    onClick={() => void pull()}
                    disabled={pullDisabled}
                    aria-label={`고양이 뽑기 (${price}츄르)`}
                    className="shrink-0 rounded-full px-3.5 py-2 text-[12.5px] font-semibold disabled:opacity-45"
                    style={{ background: "var(--navy)", color: "var(--me-fg)" }}
                  >
                    고양이 뽑기 · {price.toLocaleString("ko-KR")}츄르
                  </button>
                </div>

                <p aria-live="polite" className="m-0 min-h-[18px] text-[12px]" style={{ color: note?.ok ? "var(--work)" : "var(--block-ink)" }}>
                  {note?.text ?? ""}
                </p>

                {/* 확률표 */}
                {info && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12px] font-semibold">뽑기 확률 (한 마리당)</span>
                    <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1 p-0 text-[12px] text-ink-2">
                      {info.cats.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2">
                          <span>{COATS.find((x) => x.id === c.id)?.word ?? c.id}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <RarityBadge tier={c.tier} />
                            <span className="w-8 text-right font-mono">{c.percent}%</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 보유 목록: 없는 고양이는 실루엣 */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-semibold">
                    내 고양이 {COATS.filter((c) => have(c.id)).length}/{COATS.length}
                  </span>
                  <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
                    {COATS.map((c) => {
                      const got = have(c.id);
                      const tier = tierOf(c.id);
                      return (
                        <li key={c.id} className="flex flex-col items-center gap-1 rounded-2xl p-2" style={{ border: "1px solid var(--line)" }}>
                          <CatPicture coat={c} silhouette={!got} />
                          <span className="text-[12px] font-semibold">{got ? `${c.word} 고양이` : "아직 없어요"}</span>
                          {tier && <RarityBadge tier={tier} />}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ) : (
              <>
                <p aria-live="polite" className="m-0 min-h-[18px] text-[12px]" style={{ color: note?.ok ? "var(--work)" : "var(--block-ink)" }}>
                  {note?.text ?? ""}
                </p>
                <ul className="m-0 flex list-none flex-col gap-2 overflow-y-auto p-0 pr-1">
                  {list.map((e) => (
                    <ItemCard key={e.id} e={e} owned={owned.includes(e.id)} churu={churu} busy={busy} onBuy={() => void buy(e)} />
                  ))}
                </ul>
              </>
            )}

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
