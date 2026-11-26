// 슬랙 칸: 토큰은 백엔드에만 머문다. 이 화면은 입력 즉시 값을 지우고, 상태·설계도·저장소에 남기지 않는다.
// 읽기 전용 (메시지를 보내는 기능은 없다).
import { useCallback, useEffect, useState } from "react";
import { dashboardApi, type SlackChannel, type SlackStatus } from "../../../lib/api";
import { errText } from "../state.ts";
import type { BodyProps, ConnectorUI, FormProps } from "./types";

function SlackForm({ widget, onConfig }: FormProps) {
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await dashboardApi.slackTokenStatus();
    setStatus(s);
    setChannels(s.connected ? await dashboardApi.slackChannels() : []);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setErr(errText(e)));
  }, [refresh]);

  const connect = async () => {
    const t = token.trim();
    setToken(""); // 입력한 토큰은 바로 화면 상태에서 지운다
    if (!t) return setErr("슬랙 토큰을 붙여 넣어 주세요");
    setBusy(true);
    setErr(null);
    try {
      await dashboardApi.slackTokenSet(t);
      await refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setErr(null);
    try {
      await dashboardApi.slackTokenClear();
      await refresh();
    } catch (e) {
      setErr(errText(e));
    }
  };

  if (!status) return <p className="dash-hint">슬랙 연결을 확인하는 중…</p>;

  if (!status.connected) {
    return (
      <div className="dash-form">
        <p className="dash-hint">
          🔐 슬랙 연결이 필요해요. 슬랙 앱의 <b>사용자 토큰</b>(xoxp-로 시작하는 긴 글자)을 붙여 넣어 주세요. 메시지를 읽기만 하고 보내지는 않아요.
        </p>
        <label className="dash-field">
          <span>슬랙 토큰</span>
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void connect()} />
        </label>
        {err && <p role="alert" className="dash-err">{err}</p>}
        <button className="dash-primary" disabled={busy} onClick={() => void connect()}>{busy ? "연결하는 중…" : "연결하기"}</button>
      </div>
    );
  }

  return (
    <div className="dash-form">
      <p className="dash-hint">✅ {status.team ?? "슬랙"} 에 연결됨 · <button className="dash-link" onClick={() => void disconnect()}>연결 끊기</button></p>
      <label className="dash-field">
        <span>보여 줄 채널</span>
        <select value={widget.config.channelId ?? ""} onChange={(e) => {
          const c = channels.find((x) => x.id === e.target.value);
          if (c) onConfig({ channelId: c.id, channelName: c.name });
        }}>
          <option value="">채널을 고르세요</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.isPrivate ? "🔒 " : "# "}{c.name}</option>)}
        </select>
      </label>
      {err && <p role="alert" className="dash-err">{err}</p>}
    </div>
  );
}

function SlackBody({ widget }: BodyProps) {
  const channelId = widget.config.channelId ?? "";
  const [msgs, setMsgs] = useState<{ ts: string; userName: string; time: string; text: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!channelId) return;
    let alive = true;
    const load = () =>
      dashboardApi.slackHistory(channelId, 30).then((m) => { if (alive) { setMsgs(m); setErr(null); } }).catch((e) => alive && setErr(errText(e)));
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [channelId]);
  if (err) return <p role="alert" className="dash-err">슬랙 메시지를 못 가져왔어요. ⚙ 설정에서 연결을 확인해 주세요. ({err})</p>;
  return (
    <ul className="dash-msgs">
      {msgs.map((m) => (
        <li key={m.ts}>
          <span className="dash-msg-who">{m.userName} <time>{m.time}</time></span>
          <span className="dash-msg-text">{m.text}</span>
        </li>
      ))}
    </ul>
  );
}

export const slackUi: ConnectorUI = {
  Form: SlackForm,
  Body: SlackBody,
  getData: async (widget) => {
    const msgs = await dashboardApi.slackHistory(widget.config.channelId ?? "", 50);
    return msgs.map((m) => `[${m.time}] ${m.userName}: ${m.text}`).join("\n");
  },
  subtitle: (widget) => (widget.config.channelName ? `#${widget.config.channelName}` : "채널 고르기 전"),
};
