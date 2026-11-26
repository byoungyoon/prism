// '일이 끝나면 알림'이 무엇을 알리는지 (T-94).  node --test scripts/test/*.test.mjs   (pnpm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { workNews } from "../../src/lib/workNews.ts";

const card = (stage, extra = {}) => ({ id: "T-12", title: "가격표 개편", stage, requestedBy: "lead", ...extra });
const team = (tasks = [], agents = [], chat = []) => ({ tasks, agents, chat });
const news = (a, b) => workNews(a, b, (x) => x.name);

test("보고가 오면 끝났다고, 합치면 마무리했다고 알린다", () => {
  assert.deepEqual(news(team([card("running")]), team([card("review")])), ["T-12 가격표 개편이 끝났어요"]);
  assert.deepEqual(news(team([card("review")]), team([card("done")])), ["T-12 가격표 개편 마무리까지 마쳤어요"]);
  assert.deepEqual(news(team([card("running")]), team([card("done")])), ["T-12 가격표 개편이 끝났어요"]);
});

test("같은 상태가 다시 오면 알리지 않는다", () => {
  assert.deepEqual(news(team([card("review")]), team([card("review")])), []);
});

test("실패를 알리고, 받침에 맞춰 말한다", () => {
  assert.deepEqual(news(team([card("running")]), team([card("failed")])), ["T-12 가격표 개편 일을 끝내지 못했어요"]);
  assert.deepEqual(news(team(), team([card("failed")])), ["T-12 가격표 개편 일을 끝내지 못했어요"]);
  assert.deepEqual(news(team([card("running", { title: "글꼴 교체" })]), team([card("review", { title: "글꼴 교체" })])), ["T-12 글꼴 교체가 끝났어요"]);
  assert.deepEqual(news(team([card("running", { title: "README" })]), team([card("review", { title: "README" })])), ["T-12 README 일이 끝났어요"]);
});

test("팀장 밑의 세부 카드는 알리지 않는다", () => {
  assert.deepEqual(news(team([card("running", { requestedBy: "m1" })]), team([card("review", { requestedBy: "m1" })])), []);
});

test("막힘: 새 질문과 새로 멈춘 팀원을 한 번만 알린다", () => {
  const agent = { id: "w1", name: "안개", stuck: null };
  const stopped = { ...agent, stuck: "3분째 응답이 없어요" };
  const q = { id: 5, text: "어느 색으로 할까요?", escalation: { agentId: "w1", answer: null } };
  const before = team([], [agent]);
  const after = team([], [stopped], [q]);
  assert.deepEqual(news(before, after), ["안개 · 막혀서 물어봐요: 어느 색으로 할까요?", "안개 · 일이 막혔어요: 3분째 응답이 없어요"]);
  assert.deepEqual(news(after, after), []);
});
