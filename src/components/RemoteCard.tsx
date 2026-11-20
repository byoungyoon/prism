// "Use from other devices": turn on remote access, see the Tailscale state, scan the QR.
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import QRCode from "qrcode";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type RemoteStatus } from "../lib/api";
import { useApp } from "../store";

const spring = { type: "spring" as const, stiffness: 300, damping: 30 };

export function RemoteCard() {
  const setError = useApp((s) => s.setError);
  const [st, setSt] = useState<RemoteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api.remoteStatus().then(setSt).catch(setError);
  }, [setError]);

  useEffect(() => {
    if (!st?.url) return setQr(null);
    void QRCode.toDataURL(st.url, { margin: 1, width: 220, color: { dark: "#2b2520", light: "#ffffff" } }).then(setQr);
  }, [st?.url]);

  const run = async (fn: () => Promise<RemoteStatus>) => {
    setBusy(true);
    try {
      setSt(await fn());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const ts = st?.tailscale;
  const on = !!st?.enabled;

  return (
    <section className="glass flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div className="flex flex-auto flex-col gap-1">
          <h3 className="m-0 text-[13.5px] font-semibold">다른 기기에서 접속</h3>
          <span className="text-[12px] leading-relaxed text-ink-2">
            휴대폰이나 다른 컴퓨터에서 이 팀을 그대로 이어서 볼 수 있어요. AI는 계속 이 Mac에서 일하고, 내 기기끼리만 연결돼요(Tailscale).
          </span>
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-label="다른 기기에서 접속"
          disabled={busy || !st}
          onClick={() => void run(() => api.setRemote(!on))}
          className="relative h-7 w-12 shrink-0 rounded-full border-0 p-0 transition-colors duration-200 disabled:opacity-60"
          style={{ background: on ? "var(--amber)" : "var(--chip)", boxShadow: "inset 0 0 0 1px var(--line)" }}
        >
          <motion.span layout transition={spring} className="absolute top-1 size-5 rounded-full" style={{ left: on ? 24 : 4, background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.18)" }} />
        </button>
      </div>

      {/* Tailscale state, in plain words */}
      {ts && !ts.installed && (
        <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: "var(--chip)" }}>
          <span className="flex-auto">Tailscale이 필요해요. 이 Mac과 접속할 기기에 설치하고 같은 계정으로 로그인해 주세요.</span>
          <button onClick={() => void openUrl("https://tailscale.com/download")} className="min-h-8 shrink-0 rounded-full border-0 px-3 text-[12px] font-semibold" style={{ background: "var(--amber)", color: "#2B2520" }}>
            설치하기
          </button>
        </div>
      )}
      {ts?.installed && !ts.running && (
        <div className="rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: "var(--chip)" }}>
          Tailscale이 꺼져 있거나 로그인이 안 돼 있어요. 메뉴 막대의 Tailscale에서 로그인해 주세요.
        </div>
      )}
      {st?.note?.startsWith("ENABLE_SERVE ") && (
        <div className="flex flex-col gap-2 rounded-xl px-3.5 py-3 text-[12.5px] leading-relaxed" style={{ background: "rgba(232,161,90,0.12)", border: "1px solid var(--amber)" }}>
          <span>
            처음 한 번만, Tailscale에서 <b>Serve</b> 기능을 켜야 해요. 아래 버튼을 눌러 Tailscale 페이지에서 켠 다음 <b>다시 시도</b>를 눌러주세요.
          </span>
          <div className="flex gap-1.5">
            <button onClick={() => void openUrl(st.note!.slice("ENABLE_SERVE ".length))} className="min-h-8 rounded-full border-0 px-3.5 text-[12.5px] font-semibold" style={{ background: "var(--amber)", color: "#2B2520" }}>
              켜러 가기
            </button>
            <button onClick={() => void run(() => api.setRemote(true))} disabled={busy} className="min-h-8 rounded-full px-3.5 text-[12.5px]" style={{ border: "1px solid var(--line)" }}>
              {busy ? "확인 중…" : "다시 시도"}
            </button>
          </div>
        </div>
      )}
      {st?.note && !st.note.startsWith("ENABLE_SERVE ") && (
        <div className="rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed" style={{ background: "var(--block-bg)", color: "var(--block-ink)" }}>
          {st.note}
          {st.note.includes("HTTPS") || st.note.toLowerCase().includes("cert") ? " · Tailscale 관리 화면(DNS)에서 HTTPS 인증서를 켜주세요." : ""}
        </div>
      )}

      {on && st?.url && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex flex-wrap items-center gap-4">
          {qr && <img src={qr} alt="접속용 QR 코드" width={150} height={150} className="rounded-xl" style={{ border: "1px solid var(--line)" }} />}
          <div className="flex min-w-[220px] flex-[1_1_220px] flex-col gap-2">
            <span className="text-[13px] font-semibold">휴대폰 카메라로 QR을 찍으세요</span>
            <span className="text-[12px] leading-relaxed text-ink-2">
              접속할 기기에도 Tailscale이 켜져 있어야 해요. 열린 화면은 홈 화면에 추가하면 앱처럼 쓸 수 있어요.
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(st.url!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="min-h-8 rounded-full px-3 text-[12px]"
                style={{ border: "1px solid var(--line)" }}
              >
                {copied ? "복사했어요" : "접속 주소 복사"}
              </button>
              <button
                onClick={() => void run(api.remoteNewKey)}
                disabled={busy}
                title="연결했던 기기들은 QR을 다시 찍어야 해요"
                className="min-h-8 rounded-full px-3 text-[12px] text-ink-2"
                style={{ border: "1px solid var(--line)" }}
              >
                접속 키 새로 만들기
              </button>
            </div>
          </div>
        </motion.div>
      )}
      {on && !st?.url && ts?.running && !st?.note && <span className="text-[12px] text-ink-2">준비하는 중…</span>}
      {!on && <span className="text-[11.5px] text-ink-2">켜면 접속용 QR이 나와요. 켜져 있는 동안 이 Mac은 잠자기에 들어가지 않아요.</span>}
    </section>
  );
}
