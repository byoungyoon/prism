// 슬랙 칸: 토큰은 백엔드에만 머문다. 직접 붙여 넣는 토큰은 입력 즉시 지우고, 상태·설계도·저장소에 남기지 않는다.
// 읽기 전용 (메시지를 보내는 기능은 없다).
import { useEffect, useState } from "react";
import { create } from "zustand";
import { dashboardApi, type SlackChannel, type SlackOAuthConfig, type SlackStatus } from "../../../lib/api";
import { errText } from "../state.ts";
import type { BodyProps, ConnectorUI, FormProps, LinkStatus } from "./types";

/** 연결 상태는 한곳에 둔다: 칸에서 연결·끊기를 해도 확장 메뉴에 바로 보이고, 그 반대도 같다 */
const useSlack = create<{ status: SlackStatus | null; err: string | null }>()(() => ({ status: null, err: null }));

/** 버튼 연결의 진행 상태. 화면을 닫았다 열어도 "기다리는 중"이 남도록 한곳에 둔다 */
const useOAuth = create<{ waiting: boolean; err: string | null }>()(() => ({ waiting: false, err: null }));
let oauthRun = 0;

async function connectWithSlack() {
  const run = ++oauthRun;
  useOAuth.setState({ waiting: true, err: null });
  try {
    await dashboardApi.slackOAuthConnect();
    await refreshSlack();
    if (run === oauthRun) useOAuth.setState({ waiting: false });
  } catch (e) {
    // 그만뒀거나 새로 시작한 뒤에 늦게 온 실패는 무시한다
    if (run === oauthRun) useOAuth.setState({ waiting: false, err: errText(e) });
  }
}

function stopWaiting() {
  oauthRun++;
  useOAuth.setState({ waiting: false, err: null });
  void dashboardApi.slackOAuthCancel().catch(() => {});
}

async function refreshSlack() {
  try {
    useSlack.setState({ status: await dashboardApi.slackTokenStatus(), err: null });
  } catch (e) {
    useSlack.setState({ err: errText(e) });
  }
}

function useSlackLink(): LinkStatus {
  const { status, err } = useSlack();
  useEffect(() => void refreshSlack(), []);
  if (status) return status.connected ? { text: "연결됨", tone: "on" } : { text: "연결 필요", tone: "need" };
  return { text: err ? "확인 못 함" : "확인 중", tone: "idle" };
}

/** [슬랙으로 연결] 버튼과 기다리는 화면 */
function SlackOAuthButton({ ready }: { ready: boolean }) {
  const { waiting, err } = useOAuth();
  const [reopenErr, setReopenErr] = useState<string | null>(null);

  if (waiting) {
    return (
      <>
        <p className="dash-hint" role="status">⏳ 브라우저에 열린 슬랙 화면에서 <b>[허용]</b>을 눌러 주세요. 누르면 여기가 알아서 바뀌어요.</p>
        <p className="dash-hint">
          <b>관리자 승인</b>을 요청하라고 나오면: 요청을 보내고 [그만두기]를 누르세요. 승인 알림을 받은 뒤 다시 연결하면 돼요.
        </p>
        <div className="dash-ask-row">
          <button className="dash-link" onClick={() => void dashboardApi.slackOAuthReopen().then(() => setReopenErr(null), (e) => setReopenErr(errText(e)))}>브라우저 다시 열기</button>
          <button className="dash-link" onClick={stopWaiting}>그만두기</button>
        </div>
        {reopenErr && <p role="alert" className="dash-err">{reopenErr}</p>}
      </>
    );
  }

  return (
    <>
      <button className="dash-primary" disabled={!ready} onClick={() => { setReopenErr(null); void connectWithSlack(); }}>슬랙으로 연결</button>
      {err && <p role="alert" className="dash-err">{err}</p>}
    </>
  );
}

/** 슬랙 계정 연결: 버튼으로 연결 · (고급) Client ID·토큰 직접 넣기 · 연결 끊기 */
function SlackAccount() {
  const status = useSlack((s) => s.status);
  const statusErr = useSlack((s) => s.err);
  const [config, setConfig] = useState<SlackOAuthConfig | null>(null);
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => void refreshSlack(), []);
  useEffect(() => {
    dashboardApi.slackOAuthConfig().then(setConfig, (e) => setErr(errText(e)));
  }, []);

  const saveClientId = async (value: string) => {
    setErr(null);
    try {
      setConfig(await dashboardApi.slackClientIdSet(value));
      setClientId("");
      useOAuth.setState({ err: null });
    } catch (e) {
      setErr(errText(e));
    }
  };

  const connect = async () => {
    const t = token.trim();
    setToken(""); // 입력한 토큰은 바로 화면 상태에서 지운다
    if (!t) return setErr("슬랙 토큰을 붙여 넣어 주세요");
    setBusy(true);
    setErr(null);
    try {
      await dashboardApi.slackTokenSet(t);
      stopWaiting();
      await refreshSlack();
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
      stopWaiting();
      await refreshSlack();
    } catch (e) {
      setErr(errText(e));
    }
  };

  const shownErr = err ?? statusErr;

  if (!status) {
    return statusErr ? <p role="alert" className="dash-err">{statusErr}</p> : <p className="dash-hint">슬랙 연결을 확인하는 중…</p>;
  }

  if (!status.connected) {
    const notReady = !!config && !config.clientId;
    return (
      <div className="dash-form">
        <p className="dash-hint">🔐 버튼을 누르면 브라우저에 슬랙 화면이 열려요. [허용]만 누르면 끝이에요. 메시지를 읽기만 하고 보내지는 않아요.</p>
        <SlackOAuthButton ready={!!config?.clientId} />
        {notReady && <p className="dash-hint">아직 버튼 연결이 준비되지 않았어요. 아래 <b>고급</b>에서 슬랙 앱의 Client ID를 넣으면 켜져요.</p>}
        {shownErr && <p role="alert" className="dash-err">{shownErr}</p>}
        <details className="dash-advanced">
          <summary>고급</summary>
          <div className="dash-form">
            <label className="dash-field">
              <span>직접 만든 슬랙 앱의 Client ID</span>
              <input autoComplete="off" spellCheck={false} placeholder={config?.clientId ?? "1234567890.1234567890"} value={clientId} onChange={(e) => setClientId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && clientId.trim() && void saveClientId(clientId)} />
            </label>
            <div className="dash-ask-row">
              <button className="dash-primary" disabled={!clientId.trim()} onClick={() => void saveClientId(clientId)}>Client ID 저장</button>
              {config?.custom && <button className="dash-link" onClick={() => void saveClientId("")}>넣은 값 지우기</button>}
            </div>
            <label className="dash-field">
              <span>또는 슬랙 사용자 토큰(xoxp-) 직접 붙여 넣기</span>
              <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void connect()} />
            </label>
            <button className="dash-primary" disabled={busy} onClick={() => void connect()}>{busy ? "연결하는 중…" : "토큰으로 연결"}</button>
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="dash-form">
      <p className="dash-hint">✅ {status.team ?? "슬랙"} 에 연결됨 · <button className="dash-link" onClick={() => void disconnect()}>연결 끊기</button></p>
      {shownErr && <p role="alert" className="dash-err">{shownErr}</p>}
    </div>
  );
}

function SlackForm({ widget, onConfig }: FormProps) {
  const connected = useSlack((s) => !!s.status?.connected);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    if (!connected) return setChannels([]);
    let alive = true;
    dashboardApi.slackChannels().then((c) => alive && setChannels(c)).catch((e) => alive && setErr(errText(e)));
    return () => { alive = false; };
  }, [connected]);

  return (
    <div className="dash-form">
      <SlackAccount />
      {connected && (
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
      )}
      {err && <p role="alert" className="dash-err">{err}</p>}
    </div>
  );
}

function SlackBody({ widget }: BodyProps) {
  const channelId = widget.config.channelId ?? "";
  const [msgs, setMsgs] = useState<{ ts: string; userName: string; time: string; text: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // 연결을 끊거나 다시 하면 1분을 기다리지 않고 바로 다시 읽는다
  const connected = useSlack((s) => s.status?.connected);
  useEffect(() => {
    if (!channelId) return;
    let alive = true;
    const load = () =>
      dashboardApi.slackHistory(channelId, 30).then((m) => { if (alive) { setMsgs(m); setErr(null); } }).catch((e) => alive && setErr(errText(e)));
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [channelId, connected]);
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
  account: { useStatus: useSlackLink, Panel: SlackAccount },
  Form: SlackForm,
  Body: SlackBody,
  getData: async (widget) => {
    const msgs = await dashboardApi.slackHistory(widget.config.channelId ?? "", 50);
    return msgs.map((m) => `[${m.time}] ${m.userName}: ${m.text}`).join("\n");
  },
  subtitle: (widget) => (widget.config.channelName ? `#${widget.config.channelName}` : "채널 고르기 전"),
};
