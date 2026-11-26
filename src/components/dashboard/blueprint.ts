// 대시보드 설계도(JSON). 저장 파일(dashboard_save/load)과 AI 초안이 이 모양을 따른다.
// 순수 함수만 둔다 (node --test 로 검사). 비밀값(토큰·비밀번호)은 설계도에 절대 넣지 않는다.
import type { AiView, Widget } from "../../lib/api";
import { arrange, clampBox } from "./grid.ts";
import { SPECS, specOf } from "./connectors/specs.ts";

export const BLUEPRINT_VERSION = 1;

export interface Blueprint {
  version: 1;
  widgets: Widget[];
}

export interface BlueprintCheck {
  ok: boolean;
  blueprint?: Blueprint;
  errors: string[];
}

/** 키 이름이 이런 말이면 비밀값으로 본다 */
const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|cookie|session|auth|토큰|비밀/i;
/** 값이 이런 모양이면 토큰·비밀키로 본다 (슬랙 토큰 xox…, Bearer 헤더, 개인 키) */
const SECRET_VALUE = /xox[abprs]-|Bearer\s+\S+|-----BEGIN /;

const KINDS = new Set<string>(SPECS.map((s) => s.kind));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** AI 초안이나 저장 파일을 검사한다. 문제가 하나라도 있으면 ok=false (쉬운 한국어 문장으로 알려 준다). */
export function validateBlueprint(json: unknown): BlueprintCheck {
  const errors: string[] = [];
  if (!isObj(json)) return { ok: false, errors: ["설계도가 올바른 형식(JSON 객체)이 아니에요"] };
  if (json.version !== BLUEPRINT_VERSION) errors.push(`설계도 버전이 ${BLUEPRINT_VERSION}이어야 해요`);
  if (!Array.isArray(json.widgets)) return { ok: false, errors: [...errors, "칸 목록(widgets)이 없어요"] };

  const widgets: Widget[] = [];
  json.widgets.forEach((raw, i) => {
    const at = `${i + 1}번째 칸`;
    if (!isObj(raw)) {
      errors.push(`${at}: 칸 정보가 올바르지 않아요`);
      return;
    }
    const before = errors.length;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
    if (!id) errors.push(`${at}: 칸 번호(id)가 없어요`);
    const kind = String(raw.kind ?? "");
    const spec = specOf(kind as Widget["kind"]);
    if (!KINDS.has(kind) || !spec) errors.push(`${at}: '${kind}'은(는) 아직 지원하지 않는 종류예요 (웹사이트·엑셀·슬랙 중에서 골라 주세요)`);
    if (!isNum(raw.x) || !isNum(raw.y) || !isNum(raw.w) || !isNum(raw.h)) errors.push(`${at}: 위치(x·y)나 크기(w·h) 숫자가 빠졌어요`);

    const config: Record<string, string> = {};
    if (raw.config !== undefined && !isObj(raw.config)) {
      errors.push(`${at}: 연결 설정(config)이 올바르지 않아요`);
    } else {
      for (const [k, v] of Object.entries(raw.config ?? {})) {
        if (typeof v !== "string") {
          errors.push(`${at}: 설정 '${k}' 값은 글자여야 해요`);
          continue;
        }
        if (SECRET_KEY.test(k) || SECRET_VALUE.test(v)) {
          errors.push(`${at}: 토큰·비밀번호 같은 값은 설계도에 넣을 수 없어요 (로그인은 칸에서 직접 해 주세요)`);
          continue;
        }
        config[k] = v;
      }
    }
    if (spec && errors.length === before) {
      const bad = spec.validateConfig(config);
      if (bad) errors.push(`${at}: ${bad}`);
    }

    let view: Widget["view"];
    if (raw.view !== undefined) {
      if (!isObj(raw.view) || typeof raw.view.prompt !== "string" || typeof raw.view.showOriginal !== "boolean") {
        errors.push(`${at}: 보기 설정(view)이 올바르지 않아요`);
      } else {
        view = { prompt: raw.view.prompt, showOriginal: raw.view.showOriginal };
        if (isObj(raw.view.result) && typeof raw.view.result.type === "string") view.result = raw.view.result as unknown as AiView;
      }
    }

    if (errors.length === before && spec) {
      widgets.push({
        id,
        kind: kind as Widget["kind"],
        title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : spec.name,
        x: raw.x as number,
        y: raw.y as number,
        w: raw.w as number,
        h: raw.h as number,
        config,
        ...(view ? { view } : {}),
      });
    }
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, blueprint: { version: 1, widgets }, errors: [] };
}

/**
 * 설계도를 화면에 넣을 칸 목록으로 바꾼다: 미등록 종류는 거부(목록에서 뺀다), 좌표는 12열 안으로 보정,
 * 같은 id는 번호를 붙여 나누고, 겹치는 칸은 밀어낸다.
 */
export function applyBlueprint(bp: Blueprint): { widgets: Widget[]; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  const items: Widget[] = [];
  bp.widgets.forEach((w, i) => {
    const spec = specOf(w.kind);
    if (!spec) {
      errors.push(`${i + 1}번째 칸 '${w.kind}'은(는) 지원하지 않아서 뺐어요`);
      return;
    }
    let id = w.id;
    for (let n = 2; seen.has(id); n++) id = `${w.id}-${n}`;
    seen.add(id);
    const box = clampBox({ x: w.x, y: w.y, w: w.w, h: w.h });
    items.push({ ...w, id, ...box, title: w.title || spec.name });
  });
  return { widgets: arrange(items, null), errors };
}

/** 지금 칸들을 저장 형식(설계도)으로 */
export function blueprintOf(widgets: Widget[]): Blueprint {
  return { version: 1, widgets };
}
