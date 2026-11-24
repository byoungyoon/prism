// Small safe markdown renderer for chat bubbles: tables, bold, italic, lists, headings,
// inline code, code blocks, links. Never inserts raw HTML — everything is built as React nodes.
import { Fragment, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>)]+)|(\*[^*\s][^*\n]*?\*)/g;

function open(url: string) {
  void openUrl(url).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        open(href);
      }}
      className="underline"
      style={{ color: "var(--navy)" }}
    >
      {children}
    </a>
  );
}

function inline(text: string, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const s = m[0];
    const key = `${depth}-${k++}`;
    if (m[1]) out.push(<code key={key} className="rounded px-1 font-mono text-[0.92em]" style={{ background: "var(--chip)" }}>{s.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key}>{depth < 2 ? inline(s.slice(2, -2), depth + 1) : s.slice(2, -2)}</strong>);
    else if (m[3]) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(s)!;
      if (/^https?:\/\//i.test(mm[2])) out.push(<Link key={key} href={mm[2]}>{mm[1]}</Link>);
      else out.push(s);
    } else if (m[4]) {
      const url = s.replace(/[.,;:!?]+$/, "");
      out.push(<Link key={key} href={url}>{url}</Link>);
      if (url.length < s.length) out.push(s.slice(url.length));
    } else out.push(<em key={key}>{depth < 2 ? inline(s.slice(1, -1), depth + 1) : s.slice(1, -1)}</em>);
    last = i + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const splitRow = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
const isRow = (l: string) => l.includes("|");

type Block = ReactNode;

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let key = 0;
  const para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push(<p key={key++} className="m-0 whitespace-pre-wrap">{inline(para.join("\n"))}</p>);
      para.length = 0;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key++} className="m-0 overflow-x-auto rounded-lg px-2.5 py-2 font-mono text-[12px] leading-snug" style={{ background: "var(--chip)", maxWidth: "100%" }}>
          <code style={{ whiteSpace: "pre", overflowWrap: "normal" }}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1]) && !isSep(line)) {
      flush();
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isRow(lines[i]) && lines[i].trim()) rows.push(splitRow(lines[i++]));
      blocks.push(
        <div key={key++} className="max-w-full overflow-x-auto">
          <table className="border-collapse text-[12.5px]">
            <thead>
              <tr>{head.map((c, j) => <th key={j} className="px-2.5 py-1 text-left font-semibold whitespace-nowrap" style={{ background: "var(--chip)", border: "1px solid var(--line)" }}>{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, a) => (
                <tr key={a}>{head.map((_, j) => <td key={j} className="px-2.5 py-1 align-top" style={{ border: "1px solid var(--line)", minWidth: 60 }}>{inline(r[j] ?? "")}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const size = h[1].length <= 1 ? "text-[1.15em]" : h[1].length === 2 ? "text-[1.08em]" : "text-[1em]";
      blocks.push(<div key={key++} className={`${size} font-bold`}>{inline(h[2])}</div>);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push(<hr key={key++} className="m-0 border-0 border-t" style={{ borderColor: "var(--line)" }} />);
      i++;
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items: { depth: number; text: string; n: string }[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push({ depth: Math.min(2, Math.floor(m[1].replace(/\t/g, "  ").length / 2)), text: m[3], n: m[2] });
        i++;
      }
      blocks.push(
        <div key={key++} className="flex flex-col gap-0.5">
          {items.map((it, a) => (
            <div key={a} className="flex gap-1.5" style={{ paddingLeft: it.depth * 16 }}>
              <span className="shrink-0 text-ink-2">{ordered && /\d/.test(it.n) ? it.n : "•"}</span>
              <span className="min-w-0 whitespace-pre-wrap">{inline(it.text)}</span>
            </div>
          ))}
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<div key={key++} className="whitespace-pre-wrap pl-2.5 text-ink-2" style={{ borderLeft: "3px solid var(--line)" }}>{inline(q.join("\n"))}</div>);
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return blocks;
}

/** Renders chat markdown as React nodes (no raw HTML). Put it inside the bubble element. */
export function Markdown({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2 break-words select-text">
      {blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}
    </div>
  );
}
