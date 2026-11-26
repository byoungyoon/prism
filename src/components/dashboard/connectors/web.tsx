// 웹사이트 칸: 자식 웹뷰를 칸 자리에 겹쳐 띄운다. 칸이 움직이면 web_bounds로 따라가고,
// 끌기·설정 창·다른 화면으로 가면 web_hide로 숨긴다.
import { useEffect, useRef, useState } from "react";
import { dashboardApi } from "../../../lib/api";
import { useApp } from "../../../store";
import { errText, useDash } from "../state.ts";
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

function WebBody({ widget }: BodyProps) {
  const slot = useRef<HTMLDivElement>(null);
  const dragging = useDash((s) => s.dragging);
  const overlay = useApp((s) => s.accountSheet != null || s.shopOpen);
  const holding = dragging || overlay;
  const [err, setErr] = useState<string | null>(null);
  const { id, x, y, w, h } = widget;
  const url = widget.config.url ?? "";
  const rect = () => {
    const r = slot.current?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  };

  // 주소가 정해지면 웹뷰를 열고, 칸을 떠나면 숨긴다
  useEffect(() => {
    const r = rect();
    if (!r || !url) return;
    dashboardApi.webOpen(id, url, r.x, r.y, r.w, r.h).then(() => setErr(null)).catch((e) => setErr(errText(e)));
    return () => {
      void dashboardApi.webHide(id).catch(() => {});
    };
  }, [id, url]);

  // 칸이 움직이거나 가려질 때: 가려야 하면 숨기고, 아니면 자리를 맞추고 보여 준다
  useEffect(() => {
    if (holding) {
      void dashboardApi.webHide(id).catch(() => {});
      return;
    }
    const r = rect();
    if (!r) return;
    void dashboardApi.webBounds(id, r.x, r.y, r.w, r.h).then(() => dashboardApi.webShow(id)).catch(() => {});
  }, [id, holding, x, y, w, h]);

  // 스크롤·창 크기·칸 크기가 바뀌면 자리를 다시 맞춘다
  useEffect(() => {
    const follow = () => {
      if (holding) return;
      const r = rect();
      if (r) void dashboardApi.webBounds(id, r.x, r.y, r.w, r.h).catch(() => {});
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    const ro = new ResizeObserver(follow);
    if (slot.current) ro.observe(slot.current);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      ro.disconnect();
    };
  }, [id, holding]);

  return (
    <div className="dash-web">
      {/* 웹뷰가 이 자리 위에 떠 있다. 아래 글자는 웹뷰가 없을 때만 보인다 */}
      <div ref={slot} className="dash-web-slot" aria-label={`${host(url)} 웹 화면`}>
        <span className="dash-web-ph">🌐 {host(url)}</span>
        {holding && <span className="dash-web-ph">움직이는 중이라 잠시 가려 뒀어요</span>}
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
