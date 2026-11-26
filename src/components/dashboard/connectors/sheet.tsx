// 엑셀·CSV 칸: 파일을 고르면 읽고, 파일이 바뀌면 백엔드 알림을 받아 다시 읽는다.
import { useCallback, useEffect, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { dashboardApi, type SheetData } from "../../../lib/api";
import { errText } from "../state.ts";
import { specOf } from "./specs.ts";
import type { BodyProps, ConnectorUI, FormProps } from "./types";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
/** 화면에 그릴 줄 수 (많으면 앞부분만; 전체는 AI 보기가 본다) */
const SHOW_ROWS = 200;

function SheetForm({ widget, onConfig }: FormProps) {
  const [err, setErr] = useState<string | null>(null);
  const pick = async () => {
    try {
      const f = await open({ multiple: false, filters: [{ name: "표 파일", extensions: ["csv", "tsv", "xlsx", "xls"] }] });
      if (typeof f !== "string") return;
      const bad = specOf("sheet")!.validateConfig({ path: f });
      if (bad) return setErr(bad);
      setErr(null);
      onConfig({ path: f });
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <div className="dash-form">
      <p className="dash-hint">엑셀(xlsx·xls)이나 CSV·TSV 파일을 고르세요. 파일이 바뀌면 칸도 자동으로 다시 읽어요.</p>
      {widget.config.path && <p className="dash-hint">지금 파일: {fileName(widget.config.path)}</p>}
      {err && <p role="alert" className="dash-err">{err}</p>}
      <button className="dash-primary" onClick={() => void pick()}>파일 고르기</button>
    </div>
  );
}

function SheetBody({ widget }: BodyProps) {
  const path = widget.config.path ?? "";
  const [data, setData] = useState<SheetData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(
    () => dashboardApi.sheetRead(path).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(errText(e))),
    [path],
  );

  useEffect(() => {
    if (!path) return;
    void load();
    void dashboardApi.sheetWatch(widget.id, path).catch(() => {});
    let off: UnlistenFn | undefined;
    let alive = true;
    void dashboardApi.onSheetChanged((p) => { if (p.widgetId === widget.id) void load(); }).then((u) => {
      if (alive) off = u;
      else u();
    }).catch(() => {});
    return () => {
      alive = false;
      off?.();
      void dashboardApi.sheetUnwatch(widget.id).catch(() => {});
    };
  }, [widget.id, path, load]);

  if (err) return <p role="alert" className="dash-err">파일을 읽지 못했어요: {err}</p>;
  if (!data) return <p className="dash-hint">파일을 읽는 중…</p>;
  const shown = data.rows.slice(0, SHOW_ROWS);
  return (
    <div className="dash-sheet">
      <p className="dash-hint">{data.sheetName} · {data.rows.length}줄{data.truncated ? " (앞부분만 읽었어요)" : ""}</p>
      <div className="dash-scroll">
        <table className="dash-table">
          <thead><tr>{data.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>{data.headers.map((_, j) => <td key={j}>{r[j] == null ? "" : String(r[j])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const sheetUi: ConnectorUI = {
  Form: SheetForm,
  Body: SheetBody,
  getData: async (widget) => {
    const d = await dashboardApi.sheetRead(widget.config.path ?? "");
    const lines = d.rows.map((r) => r.map((c) => (c == null ? "" : String(c))).join("\t"));
    return [d.headers.join("\t"), ...lines].join("\n") + (d.truncated ? "\n(일부만 읽었어요)" : "");
  },
  subtitle: (widget) => (widget.config.path ? fileName(widget.config.path) : "파일 고르기 전"),
};
