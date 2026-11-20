import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { pty } from "../lib/api";

// Warm palette matching docs/DESIGN.md; the terminal itself stays opaque (no blur) for perf.
const theme: ITheme = {
  background: "#00000000",
  foreground: "#efe6d8",
  cursor: "#f0b070",
  cursorAccent: "#221d18",
  selectionBackground: "#f0b07040",
  black: "#2b2520",
  red: "#d9725f",
  green: "#7fb08a",
  yellow: "#e2b866",
  blue: "#8fa3d6",
  magenta: "#c79ac0",
  cyan: "#8fc1c4",
  white: "#e8dfd2",
  brightBlack: "#7a6e62",
  brightRed: "#ec8b77",
  brightGreen: "#9cc9a6",
  brightYellow: "#f0cd85",
  brightBlue: "#aebde3",
  brightMagenta: "#ddb3d6",
  brightCyan: "#aad6d8",
  brightWhite: "#fbf6ef",
};

interface Props {
  /** Attach to an existing backend PTY (an agent). It keeps running after unmount. */
  ptyId?: number | null;
  /** Without `ptyId`: spawn a private shell here, killed on unmount. */
  cwd?: string;
  /** Small preview: no input, no cursor, smaller font. */
  preview?: boolean;
  fontSize?: number;
  className?: string;
}

export function TerminalView({ ptyId, cwd, preview, fontSize, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", D2Coding, Menlo, Consolas, monospace',
      fontSize: fontSize ?? (preview ? 10 : 13),
      lineHeight: 1.2,
      cursorBlink: !preview,
      cursorInactiveStyle: "none",
      disableStdin: !!preview,
      allowTransparency: true,
      scrollback: 10_000,
      theme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri)));
    term.open(host);
    if (!preview) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // DOM renderer fallback
      }
    }
    fit.fit();

    let id: number | undefined = ptyId ?? undefined;
    let detach: (() => void) | undefined;
    let disposed = false;
    const owned = ptyId == null;

    (async () => {
      try {
        if (id == null) id = await pty.spawnShell(term.cols, term.rows, cwd);
        if (disposed) {
          if (owned) void pty.kill(id);
          return;
        }
        detach = await pty.attach(id, (b) => term.write(b));
        if (disposed) detach();
        else if (!preview) void pty.resize(id, term.cols, term.rows);
      } catch (err) {
        term.write(`\x1b[31m터미널 연결 실패: ${err}\x1b[0m\r\n`);
      }
    })();

    const input = term.onData((d) => id != null && !preview && void pty.write(id, d));
    // previews don't own the PTY size; the full view does
    const resize = term.onResize(({ cols, rows }) => id != null && !preview && void pty.resize(id, cols, rows));
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host);
    if (!preview) term.focus();

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      resize.dispose();
      detach?.();
      if (owned && id != null) void pty.kill(id);
      term.dispose();
    };
  }, [ptyId, cwd, preview, fontSize]);

  return <div ref={hostRef} className={className} />;
}
