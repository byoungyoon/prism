// 재현 테스트: "총괄이 사라지면 휴게실도 다 사라진다" (T-61).
// 총괄이 빠지면(세션 종료, 새 대화로 넘어가는 중, 팀 퇴근, 앱 재시작) 팀에 '켜져 있는' 사람이 없어져서
// 사무실이 그 팀을 통째로 빼 버렸다 — 쉬는 작업자와 보고한 작업자까지 휴게실에서 사라졌다.
//   node --test scripts/test/   (pnpm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { inOffice, liveCrew, loungeOnlyCrew } from "../../src/lib/crew.ts";

const now = 1_000_000;
const agent = (id, name, role, status, taskId = null, extra = {}) => ({ id, name, role, status, taskId, statusSince: now, restSince: null, ...extra });
const task = (id, stage, assignee) => ({ id, stage, assignee });
const team = (agents, tasks) => ({ agents, tasks, chat: [] });

/** the rule the office used before: someone on the team is in */
const oldRule = (t) => t.agents.some((a) => a.status !== "off" && a.status !== "done");

test("총괄 세션이 끝나도 보고한 작업자는 휴게실에 남는다", () => {
  const t = team([agent("lead", "총괄", "lead", "off"), agent("w1", "W1", "worker", "done", "T-1")], [task("T-1", "review", "w1")]);
  assert.equal(oldRule(t), false, "재현: 예전 규칙으로는 팀이 사무실에서 빠졌다");
  assert.equal(inOffice(t), true);
  assert.deepEqual(loungeOnlyCrew(t).map((m) => [m.agent.name, m.reported]), [["W1", true]]);
});

test("총괄이 빠져도 쉬는 작업자는 휴게실에 남는다", () => {
  const t = team([agent("lead", "총괄", "lead", "off"), agent("w2", "W2", "worker", "wait", "T-2", { restSince: now - 5000 })], [task("T-2", "done", "w2")]);
  assert.equal(inOffice(t), true);
  assert.deepEqual(liveCrew(t).map((a) => a.name), ["W2"]);
});

test("팀이 퇴근하거나 앱이 다시 켜져서 모두 꺼져도 쉬는 작업자와 보고한 작업자는 남는다", () => {
  const t = team(
    [
      agent("lead", "총괄", "lead", "off"),
      agent("w2", "W2", "worker", "off", "T-2", { restSince: now - 5000 }),
      agent("w3", "W3", "worker", "off", "T-3"),
    ],
    [task("T-2", "done", "w2"), task("T-3", "review", "w3")],
  );
  assert.equal(oldRule(t), false, "재현: 예전 규칙으로는 휴게실이 통째로 사라졌다");
  assert.equal(inOffice(t), true);
  assert.deepEqual(loungeOnlyCrew(t).map((m) => [m.agent.name, m.reported]), [["W2", false], ["W3", true]]);
});

test("다시 출근해 쉬는 작업자가 살아나면 두 번 나오지 않는다", () => {
  const t = team(
    [agent("lead", "총괄", "lead", "wait"), agent("w2", "W2", "worker", "wait", "T-2", { restSince: now }), agent("w2old", "W2", "worker", "off", "T-1", { restSince: now - 9000 })],
    [task("T-1", "done", "w2old"), task("T-2", "done", "w2")],
  );
  assert.deepEqual(loungeOnlyCrew(t), []);
});

test("아무도 없고 휴게실에 남을 고양이도 없으면 사무실에서 빠진다", () => {
  const t = team([agent("lead", "총괄", "lead", "off"), agent("w4", "W4", "worker", "done", "T-4")], [task("T-4", "done", "w4")]);
  assert.equal(inOffice(t), false);
  assert.deepEqual(loungeOnlyCrew(t), []);
});
