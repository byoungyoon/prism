// 놀이방의 규칙 (T-128): 쉬는 고양이 일부가 놀이방에서 놀다가 휴게실로 돌아간다.
//   node --test scripts/test/   (pnpm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { actsFor, emptyPlay, dropRoom, leavePlay, placeInPlay, PLAY_MAX, quota, SCRIPTS, tickPlay } from "../../src/components/office/playRules.ts";

const now = 1_000_000;
const keys = ["a", "b", "c", "d", "e"];
const acts = actsFor(() => false);
const first = () => 0.5;
const inPlay = (s) => Object.keys(s.cats);

test("놀이방에는 쉬는 고양이의 절반쯤, 많아야 4마리만 간다", () => {
  assert.deepEqual([0, 1, 2, 5, 20].map(quota), [0, 1, 1, 3, PLAY_MAX]);
});

test("처음 그릴 때는 정원만큼 서로 다른 놀이를 하고, 평소에는 한 마리씩 간다", () => {
  const filled = tickPlay(emptyPlay(), { keys, acts, now, fill: true, random: first });
  assert.equal(inPlay(filled).length, 3);
  assert.equal(new Set(Object.values(filled.cats).map((c) => c.act)).size, 3);
  assert.equal(inPlay(tickPlay(emptyPlay(), { keys, acts, now, random: first })).length, 1);
});

test("사지 않은 놀이는 하지 않는다", () => {
  assert.ok(!acts.includes("wheel") && !acts.includes("tunnel"));
  assert.deepEqual(actsFor(() => true).slice(acts.length), ["wheel", "tunnel"]);
});

test("바뀐 것이 없으면 같은 상태를 돌려준다", () => {
  const s = tickPlay(emptyPlay(), { keys: ["a"], acts, now, random: first });
  assert.equal(tickPlay(s, { keys: ["a"], acts, now: now + 1, random: first }), s);
});

test("시간이 지나면 다음 단계로 가고, 놀이가 끝나면 휴게실로 돌아가 한동안 쉰다", () => {
  const start = { ...emptyPlay(), cats: { a: { act: "rod", step: 0, until: now } } };
  const next = tickPlay(start, { keys: ["a"], acts, now, random: first });
  assert.deepEqual(next.cats.a, { act: "rod", step: 1, until: now + SCRIPTS.rod[1].ms });
  const last = { ...emptyPlay(), cats: { a: { act: "rod", step: SCRIPTS.rod.length - 1, until: now } } };
  const home = tickPlay(last, { keys: ["a"], acts, now, random: first });
  assert.equal(home.cats.a, undefined);
  assert.ok(home.rest.a > now);
});

test("공을 굴리는 단계가 되면 공이 길 안에서 움직인다", () => {
  let s = { ...emptyPlay(), cats: { a: { act: "ball", step: 0, until: now } } };
  const before = s.ball;
  s = tickPlay(s, { keys: ["a"], acts, now, random: first });
  assert.notEqual(s.ball, before);
  assert.ok(s.ball >= 0 && s.ball <= 1);
});

test("일하러 간 고양이는 놀이방에서 빠지고, 만지는 중인 고양이는 단계를 넘기지 않는다", () => {
  const s = { ...emptyPlay(), cats: { a: { act: "rod", step: 0, until: now } } };
  assert.equal(tickPlay(s, { keys: [], acts, now }).cats.a, undefined);
  assert.equal(tickPlay(s, { keys: ["a"], acts, now, busy: () => true }), s);
});

test("들어 올린 고양이는 놀이를 그만두고 바로 다시 불려 가지 않는다", () => {
  const s = leavePlay({ ...emptyPlay(), cats: { a: { act: "rod", step: 0, until: now + 5000 } } }, "a", now);
  assert.equal(s.cats.a, undefined);
  assert.equal(tickPlay(s, { keys: ["a"], acts, now: now + 1000 }).cats.a, undefined);
});

test("사람이 놀이방에 놓은 고양이는 그 자리에 남고, 시간이 지나면 다시 놀이 규칙을 따른다", () => {
  const spot = { x: 100, y: 200 };
  const s = placeInPlay(leavePlay(emptyPlay(), "a", now), "a", spot, now);
  assert.deepEqual(s.cats.a.spot, spot);
  assert.equal(s.rest.a, undefined);
  assert.equal(tickPlay(s, { keys: ["a"], acts, now: now + 1000, random: first }), s);
  assert.equal(tickPlay(s, { keys: ["a"], acts, now: now + SCRIPTS.stay[0].ms, random: first }).cats.a, undefined);
  assert.ok(!actsFor(() => true).includes("stay"));
});

test("놓은 곳의 방을 고른다: 방 밖이면 가까운 방", () => {
  const lounge = { x: 0, y: 0, w: 400, h: 400 };
  const play = { x: 0, y: 422, w: 400, h: 390 };
  assert.equal(dropRoom({ x: 200, y: 200 }, lounge, play), "lounge");
  assert.equal(dropRoom({ x: 200, y: 600 }, lounge, play), "play");
  assert.equal(dropRoom({ x: 200, y: 405 }, lounge, play), "lounge");
  assert.equal(dropRoom({ x: 200, y: 418 }, lounge, play), "play");
  assert.equal(dropRoom({ x: -300, y: 700 }, lounge, play), "play");
});
