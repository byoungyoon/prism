// 웹사이트 칸: 자식 웹뷰를 칸 자리에 겹쳐 띄운다. 칸이 움직이면 web_bounds로 따라가고(스크롤로 잘리면 보이는 만큼만),
// 끌기·팝업·화면 밖·설정 창·다른 화면이면 web_hide로 숨긴다.
import { useEffect, useRef, useState } from "react";
import { dashboardApi } from "../../../lib/api";
import { errText, useDash } from "../state.ts";
import { clipsOf, isCovered, visibleRect } from "../webCover.ts";
import { specOf } from "./specs.ts";
import type { BodyProps, ConnectorUI, FormProps } from "./types";

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function WebForm({ widget, onConfig }: FormProps) {
  const [url, setUrl] = useState(widget.config.url ?? "");
  const [login, setLogin] = useState(widget.config.login === "1");
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    let v = url.trim();
    if (!v) return setErr("웹 주소를 넣어 주세요");
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    const bad = specOf("web")!.validateConfig({ url: v });
    if (bad) return setErr(bad);
    setErr(null);
    onConfig(login ? { url: v, login: "1" } : { url: v });
  };
  return (
    <div className="dash-form">
      <label className="dash-field">
        <span>웹 주소</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="https://example.com" />
      </label>
      <label className="dash-check">
        <input type="checkbox" checked={login} onChange={(e) => setLogin(e.target.checked)} /> 로그인이 필요한 사이트예요
      </label>
      {login && <p className="dash-hint">칸이 열리면 그 칸 안에서 직접 로그인해 주세요. 로그인 정보는 화면에 남기지 않아요.</p>}
      {err && <p role="alert" className="dash-err">{err}</p>}
      <button className="dash-primary" onClick={submit}>칸에 띄우기</button>
    </div>
  );
}

type Hold = "drag" | "cover" | "offscreen" | null;

const HOLD_TEXT = {
  drag: "움직이는 중이라 잠시 가려 뒀어요",
  cover: "창이 열려 있는 동안 잠시 가려 뒀어요",
  offscreen: "칸이 다 보이면 웹 화면이 다시 나와요",
};

function WebBody({ widget }: BodyProps) {
  const slot = useRef<HTMLDivElement>(null);
  const [hold, setHold] = useState<Hold>(null);
  const [err, setErr] = useState<string | null>(null);
  const { id } = widget;
  const url = widget.config.url ?? "";

  // 웹뷰를 열고, 매 화면마다 자리를 확인해서 바뀐 때만 알려 준다.
  // 스크롤·크기 바꾸기·화면 전환 효과·팝업을 한곳에서 따라간다. 칸을 떠나면 숨긴다.
  useEffect(() => {
    if (!url) return;
    let frame = 0;
    let opened = false;
    /** 마지막으로 보낸 상태: 보이는 자리, "hidden", 아직 안 보냄(null) */
    let sent: string | null = null;
    let alive = true;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = slot.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const rect = visibleRect(box, clipsOf(el));
      const reason: Hold = useDash.getState().dragging ? "drag" : isCovered(box) ? "cover" : rect ? null : "offscreen";
      setHold(reason);
      const next = reason || !rect ? "hidden" : [rect.x, rect.y, rect.w, rect.h].map(Math.round).join(",");
      if (next === sent) return;
      const wasShown = sent !== null && sent !== "hidden";
      sent = next;
      if (next === "hidden") {
        if (opened) void dashboardApi.webHide(id).catch(() => {});
        return;
      }
      const { x, y, w, h } = rect!;
      // 가려진 동안에는 열지 않는다 (열면 바로 위에 떠 버린다)
      if (!opened) {
        opened = true;
        dashboardApi
          .webOpen(id, url, x, y, w, h)
          .then(() => alive && setErr(null))
          .catch((e) => alive && setErr(errText(e)));
        return;
      }
      // 명령은 보낸 순서대로 처리되므로, 뒤이은 숨기기가 보이기에 덮이지 않게 바로 이어 보낸다
      void dashboardApi.webBounds(id, x, y, w, h).catch(() => {});
      if (!wasShown) void dashboardApi.webShow(id).catch(() => {});
    };
    tick();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      void dashboardApi.webHide(id).catch(() => {});
    };
  }, [id, url]);

  return (
    <div className="dash-web">
      {/* 웹뷰가 이 자리 위에 떠 있다. 아래 글자는 웹뷰가 없을 때만 보인다 */}
      <div ref={slot} className="dash-web-slot" aria-label={`${host(url)} 웹 화면`}>
        <span className="dash-web-ph">🌐 {host(url)}</span>
        {hold && <span className="dash-web-ph">{HOLD_TEXT[hold]}</span>}
        {err && <span role="alert" className="dash-err">웹 화면을 열지 못했어요: {err}</span>}
      </div>
    </div>
  );
}

export const webUi: ConnectorUI = {
  Form: WebForm,
  Body: WebBody,
  getData: (widget) => dashboardApi.webText(widget.id),
  subtitle: (widget) => host(widget.config.url ?? ""),
  onRemove: (widget) => {
    void dashboardApi.webClose(widget.id).catch(() => {});
  },
};
