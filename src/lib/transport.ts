// One way to talk to the backend from both places Prism's UI runs:
//  · inside the desktop app → Tauri invoke / events
//  · in a browser on another device (remote access over Tailscale) → HTTP + one WebSocket
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const isRemote = typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

const KEY = "prism-remote-key";

/** Access key from the pairing link (?k=…), remembered on this device. */
function key(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get("k");
    if (fromUrl) {
      localStorage.setItem(KEY, fromUrl);
      history.replaceState(null, "", location.pathname); // don't leave it in the address bar
      return fromUrl;
    }
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
const remoteKey = isRemote ? key() : "";

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isRemote) return invoke<T>(cmd, args);
  const res = await fetch(`/api/${cmd}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-prism-key": remoteKey },
    body: JSON.stringify(args ?? {}),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof body === "string" ? body : `요청 실패 (${res.status})`);
  return body as T;
}

// ── events ────────────────────────────────────────────

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
let socket: WebSocket | null = null;
let retry = 1000;

function connect() {
  if (socket) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/events?k=${encodeURIComponent(remoteKey)}`);
  socket = ws;
  ws.onopen = () => (retry = 1000);
  ws.onmessage = (m) => {
    try {
      const { event, payload } = JSON.parse(String(m.data)) as { event: string; payload: unknown };
      handlers.get(event)?.forEach((h) => h(payload));
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    socket = null;
    if ([...handlers.values()].some((s) => s.size)) setTimeout(connect, (retry = Math.min(retry * 2, 15000)));
  };
}

export function on<T>(event: string, fn: (payload: T) => void): Promise<UnlistenFn> {
  if (!isRemote) return listen<T>(event, (e) => fn(e.payload));
  const set = handlers.get(event) ?? new Set();
  set.add(fn as Handler);
  handlers.set(event, set);
  connect();
  return Promise.resolve(() => set.delete(fn as Handler));
}
