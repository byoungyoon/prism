// 대시보드 설계도 검사: 모양·종류·좌표·토큰 금지, 적용 시 경계 보정·id 중복 정리·겹침 해소.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBlueprint, applyBlueprint, blueprintOf } from "../../src/components/dashboard/blueprint.ts";
import { SPECS, specOf } from "../../src/components/dashboard/connectors/specs.ts";
import { overlaps, COLS } from "../../src/components/dashboard/grid.ts";

const w = (over) => ({ id: "w1", kind: "web", title: "웹", x: 0, y: 0, w: 6, h: 7, config: { url: "https://example.com" }, ...over });
const bp = (widgets) => ({ version: 1, widgets });

test("정상 설계도는 통과한다", () => {
  const r = validateBlueprint(bp([w(), w({ id: "s1", kind: "sheet", x: 6, config: { path: "/tmp/문의.xlsx" } })]));
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.blueprint.widgets.length, 2);
});

test("모양이 틀리면 쉬운 한국어로 알려 준다", () => {
  assert.equal(validateBlueprint(null).ok, false);
  assert.match(validateBlueprint(null).errors[0], /올바른 형식/);
  const v = validateBlueprint({ version: 2, widgets: "x" });
  assert.match(v.errors.join("|"), /버전이 1/);
  assert.match(v.errors.join("|"), /칸 목록/);
});

test("지원하지 않는 종류는 거부한다", () => {
  const r = validateBlueprint(bp([w({ kind: "youtube" })]));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /'youtube'은\(는\) 아직 지원하지 않는/);
});

test("좌표가 숫자가 아니면 거부한다", () => {
  const r = validateBlueprint(bp([w({ x: "3" })]));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /위치\(x·y\)나 크기/);
});

test("토큰·비밀번호는 설계도에 들어가면 거부한다 (키 이름과 값 모두)", () => {
  const byKey = validateBlueprint(bp([w({ kind: "slack", config: { channelId: "C123", token: "abc" } })]));
  assert.equal(byKey.ok, false);
  assert.match(byKey.errors.join("|"), /토큰·비밀번호/);
  const byValue = validateBlueprint(bp([w({ kind: "slack", config: { channelId: "C123", note: "xoxp-1234-abcd" } })]));
  assert.equal(byValue.ok, false);
  assert.match(byValue.errors.join("|"), /토큰·비밀번호/);
});

test("연결 설정 형식 검사는 칸 종류별 규칙을 따른다", () => {
  assert.equal(validateBlueprint(bp([w({ config: { url: "ftp://x.com" } })])).ok, false);
  assert.equal(validateBlueprint(bp([w({ config: { url: "not a url" } })])).ok, false);
  assert.equal(validateBlueprint(bp([w({ kind: "sheet", config: { path: "/tmp/a.txt" } })])).ok, false);
  assert.equal(validateBlueprint(bp([w({ kind: "slack", config: { channelId: "bad id" } })])).ok, false);
});

test("설정이 비어 있는 칸(로그인·연결 대기)은 통과한다", () => {
  const r = validateBlueprint(bp([w({ kind: "slack", config: {} }), w({ id: "w2", config: {} })]));
  assert.equal(r.ok, true);
});

test("보기(view) 형식 검사", () => {
  assert.equal(validateBlueprint(bp([w({ view: { prompt: "표로", showOriginal: false } })])).ok, true);
  assert.equal(validateBlueprint(bp([w({ view: { prompt: 3 } })])).ok, false);
});

test("적용: 미등록 종류는 빼고 알려 준다", () => {
  const r = applyBlueprint({ version: 1, widgets: [w(), w({ id: "z", kind: "zzz" })] });
  assert.equal(r.widgets.length, 1);
  assert.match(r.errors[0], /'zzz'은\(는\) 지원하지 않아서 뺐어요/);
});

test("적용: 좌표를 12열 안으로 보정한다", () => {
  const r = applyBlueprint({ version: 1, widgets: [w({ x: 10, w: 6, y: -4, h: 1 })] });
  const a = r.widgets[0];
  assert.equal(a.x + a.w <= COLS, true);
  assert.equal(a.y, 0);
  assert.equal(a.h >= 4, true);
});

test("적용: 같은 id는 번호를 붙여 나눈다", () => {
  const r = applyBlueprint({ version: 1, widgets: [w(), w({ x: 6 })] });
  assert.deepEqual(r.widgets.map((x) => x.id), ["w1", "w1-2"]);
});

test("적용: 겹치는 칸은 밀려서 겹치지 않는다", () => {
  const r = applyBlueprint({ version: 1, widgets: [w({ id: "a" }), w({ id: "b", x: 3 })] });
  assert.equal(overlaps(r.widgets[0], r.widgets[1]), false);
});

test("적용 결과에 빈 제목이면 종류 이름을 쓴다, 저장 형식은 version 1", () => {
  const r = applyBlueprint({ version: 1, widgets: [w({ title: "" })] });
  assert.equal(r.widgets[0].title, specOf("web").name);
  assert.equal(blueprintOf(r.widgets).version, 1);
});

test("연결 종류 목록: 웹·엑셀·슬랙 모두 설명서가 있고 로그인 여부를 알려 준다", () => {
  assert.deepEqual(SPECS.map((s) => s.kind).sort(), ["sheet", "slack", "web"]);
  assert.equal(specOf("slack").needsLogin({}), true);
  assert.equal(specOf("sheet").needsLogin({}), false);
  assert.equal(specOf("web").needsLogin({ login: "1" }), true);
});
