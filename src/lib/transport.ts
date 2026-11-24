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

/** Remote only: send a file as raw bytes (not a JSON number array) and get back the saved path. */
export async function uploadFile(projectId: string, name: string, blob: Blob): Promise<string> {
  const MAX = 50 * 1024 * 1024;
  if (blob.size > MAX) throw new Error(`"${name}" 파일이 너무 커요 (최대 50MB)`);
  let res: Response;
  try {
    res = await fetch(`/api/upload?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "x-prism-key": remoteKey },
      body: blob,
    });
  } catch {
    throw new Error(`"${name}" 파일을 보내지 못했어요. 연결을 확인해 주세요`);
  }
  const body = await res.json().catch(() => null);
  if (res.status === 413) throw new Error(`"${name}" 파일이 너무 커요 (최대 50MB)`);
  if (!res.ok) throw new Error(`"${name}" 파일을 보내지 못했어요${typeof body === "string" ? `: ${body}` : ` (${res.status})`}`);
  return body as string;
}

// ── events ────────────────────────────────────────────

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
let socket: WebSocket | null = null;
let retry = 1000;
let lastSeen = 0; // when we last heard anything from the server
let everOpened = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const STALE_MS = 45000; // the server pings every 20s; silence this long means a dead connection

// "reconnecting" indicator + "refetch everything" listeners
const resyncFns = new Set<() => void>();
const stateFns = new Set<(connected: boolean) => void>();
let connected = true;
function setConnected(v: boolean) {
  if (connected === v) return;
  connected = v;
  stateFns.forEach((f) => f(v));
}
/** Called after a reconnect, or when the server says it dropped updates: reload the whole screen state. */
export function onResync(fn: () => void): () => void {
  resyncFns.add(fn);
  return () => resyncFns.delete(fn);
}
/** Live connection state (remote only; the desktop app is always "connected"). */
export function onConnection(fn: (connected: boolean) => void): () => void {
  stateFns.add(fn);
  return () => stateFns.delete(fn);
}
const resync = () => resyncFns.forEach((f) => f());

function wanted() {
  return [...handlers.values()].some((s) => s.size);
}

function connect() {
  if (socket) return;
  clearTimeout(timer);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/events?k=${encodeURIComponent(remoteKey)}`);
  socket = ws;
  lastSeen = Date.now();
  ws.onopen = () => {
    if (socket !== ws) return;
    retry = 1000;
    lastSeen = Date.now();
    setConnected(true);
    // changes made while we were away were missed: fetch the full state again
    if (everOpened) resync();
    everOpened = true;
  };
  ws.onmessage = (m) => {
    lastSeen = Date.now();
    try {
      const { event, payload } = JSON.parse(String(m.data)) as { event: string; payload: unknown };
      if (event === "ping") return;
      if (event === "resync") return resync();
      handlers.get(event)?.forEach((h) => h(payload));
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return; // an old socket we already replaced
    socket = null;
    setConnected(false);
    if (wanted()) timer = setTimeout(connect, (retry = Math.min(retry * 2, 5000)));
  };
}

/** Drop the current socket (even a zombie one that never fired onclose) and connect again right away. */
function reconnectNow() {
  const old = socket;
  socket = null;
  clearTimeout(timer);
  if (old) {
    old.onopen = old.onmessage = old.onclose = null;
    try {
      old.close();
    } catch {
      /* already dead */
    }
  }
  setConnected(false);
  retry = 1000;
  connect();
}

/** Is the connection alive? If it looks dead or stale, reconnect immediately. */
function check() {
  if (!wanted()) return;
  const dead = !socket || socket.readyState > WebSocket.OPEN;
  if (dead || Date.now() - lastSeen > STALE_MS) reconnectNow();
}

if (isRemote && typeof document !== "undefined") {
  const wake = () => {
    if (document.visibilityState === "hidden") return;
    // a phone coming back from the background: don't trust the old socket, even if it claims to be open
    if (socket && socket.readyState === WebSocket.OPEN && Date.now() - lastSeen > 25000) reconnectNow();
    else check();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("pageshow", wake);
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
  setInterval(check, 5000);
}

export function on<T>(event: string, fn: (payload: T) => void): Promise<UnlistenFn> {
  if (!isRemote) return listen<T>(event, (e) => fn(e.payload));
  const set = handlers.get(event) ?? new Set();
  set.add(fn as Handler);
  handlers.set(event, set);
  connect();
  return Promise.resolve(() => set.delete(fn as Handler));
}
