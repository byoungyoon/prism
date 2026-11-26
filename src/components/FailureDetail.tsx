import { useState } from "react";
import type { InstallFailure } from "./useInstall";

/** The program's own words, folded away, with a button to copy them for whoever helps. */
export function FailureDetail({ text }: { text: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const full = `Prism ${__APP_VERSION__}\n${text}`;
  const copy = () => {
    navigator.clipboard.writeText(full).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <details className="text-[12px] text-ink-2">
      <summary className="cursor-pointer select-none">자세한 내용</summary>
      <pre className="m-0 mt-2 max-h-[140px] overflow-auto rounded-lg p-2.5 font-mono text-[11px] break-all whitespace-pre-wrap select-text" style={{ background: "var(--chip)" }}>
        {full}
      </pre>
      <button onClick={copy} className="mt-1.5 min-h-8 rounded-full bg-transparent px-3 text-[12px]" style={{ border: "1px solid var(--line)" }}>
        {copied === null ? "복사" : copied ? "복사했어요" : "복사하지 못했어요. 글을 직접 선택해 주세요"}
      </button>
    </details>
  );
}

export function InstallFailed({ label, failure }: { label: string; failure: InstallFailure }) {
  return (
    <div role="alert" className="flex flex-col gap-1.5 rounded-xl px-3.5 py-3" style={{ background: "var(--block-bg)", border: "1px solid var(--block)" }}>
      <span className="text-[13.5px] font-semibold" style={{ color: "var(--block-ink)" }}>
        {label}을(를) 설치하지 못했어요
      </span>
      <span className="text-[12.5px] leading-relaxed">{failure.reason}</span>
      <FailureDetail text={failure.detail} />
    </div>
  );
}
