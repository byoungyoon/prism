// 재현 테스트: "ChatGPT로 로그인했는데 계정이 없는 것처럼 보인다" (T-114).
// 상단 버튼이 서비스를 안 보고 첫 번째 '사용 중' 계정(로그인 안 한 Claude)만 보여 줬다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { topAccount, topAccountName } from "../../src/lib/topAccount.ts";

const acct = (id, provider, loggedIn, extra = {}) => ({ id, provider, name: "기본", dir: null, active: true, status: { loggedIn }, ...extra });

test("ChatGPT만 로그인하면 ChatGPT 계정이 상단에 보인다", () => {
  const a = topAccount([acct("default", "claude", false), acct("codex-default", "codex", true), acct("antigravity-default", "antigravity", false)]);
  assert.equal(a.id, "codex-default");
  assert.equal(topAccountName(a), "ChatGPT");
});

test("여러 곳에 로그인했으면 저장 순서와 상관없이 Claude가 먼저", () => {
  assert.equal(topAccount([acct("codex-default", "codex", true), acct("default", "claude", true)]).id, "default");
});

test("아무 데도 로그인 안 했으면 Claude 자리, 목록이 비면 없음", () => {
  assert.equal(topAccount([acct("codex-default", "codex", false), acct("default", "claude", false)]).id, "default");
  assert.equal(topAccount([]), undefined);
});

test("사용 중이 아닌 계정은 고르지 않고, 직접 지은 이름은 그대로", () => {
  const a = topAccount([acct("x", "codex", true, { active: false }), acct("y", "codex", true, { name: "회사" })]);
  assert.equal(a.id, "y");
  assert.equal(topAccountName(a), "회사");
});
