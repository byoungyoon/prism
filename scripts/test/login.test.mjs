// 연결 흐름 판단 (T-115): 성공·실패 알아채기, 실패 이유를 쉬운 말로, 코드가 필요한 주소는 열지 않기.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loginPhase, loginFailureReason, reopenUrl } from "../../src/lib/login.ts";

test("새 연결: 로그인되면 성공, 프로그램이 그냥 끝나면 실패", () => {
  assert.equal(loginPhase({ switching: false, loggedIn: false, exit: null }), "waiting");
  assert.equal(loginPhase({ switching: false, loggedIn: true, exit: null }), "success");
  assert.equal(loginPhase({ switching: false, loggedIn: false, exit: 1 }), "failed");
  assert.equal(loginPhase({ switching: false, loggedIn: false, exit: 0 }), "failed");
});

test("계정 바꾸기: 예전 로그인 때문에 바로 성공으로 보지 않는다", () => {
  assert.equal(loginPhase({ switching: true, loggedIn: true, exit: null }), "waiting");
  assert.equal(loginPhase({ switching: true, loggedIn: true, exit: 1 }), "failed");
  assert.equal(loginPhase({ switching: true, loggedIn: true, exit: 0 }), "success");
});

test("실패 이유는 쉬운 말로", () => {
  assert.match(loginFailureReason("Error logging in: Address already in use (os error 48)"), /다른 로그인/);
  assert.match(loginFailureReason("Error logging in: access_denied"), /취소/);
  assert.match(loginFailureReason("Couldn't log in: getaddrinfo ENOTFOUND platform.claude.com"), /인터넷/);
  assert.match(loginFailureReason("Couldn't log in: That code wasn't accepted. It may be expired"), /새로 열린 화면/);
  assert.match(loginFailureReason(""), /끝나지 않았어요/);
  assert.match(loginFailureReason("visit https://x.test/oauth?scope=offline_access"), /끝나지 않았어요/);
});

test("다시 열기는 자동으로 돌아오는 ChatGPT 주소만, Claude의 코드용 예비 주소는 안 연다", () => {
  const codex = "https://auth.openai.com/oauth/authorize?response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&state=a";
  assert.equal(reopenUrl(`navigate to this URL to authenticate:\r\n\r\n${codex}\r\n`), codex);
  assert.equal(reopenUrl("If the browser didn't open, visit:\r\nhttps://claude.ai/oauth/authorize?z-abc\r\nPaste code here if prompted > "), null);
});
