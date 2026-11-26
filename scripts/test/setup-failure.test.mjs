// 설치·로그인 실패 이유 (T-119): 권한·정책 같은 진짜 이유를 찾고, 터미널 기호와 로그인 코드는 지운다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFailureReason, notDetectedReason, plainOutput, blockedReason } from "../../src/lib/setupFailure.ts";
import { loginFailureReason } from "../../src/lib/login.ts";

test("윈도우 권한·정책 오류는 각각의 이유로 (영어·한국어)", () => {
  assert.match(installFailureReason("Access to the path 'C:\\Users\\a\\.local' is denied.", 1), /권한 문제/);
  assert.match(installFailureReason("액세스가 거부되었습니다. (os error 5)", null), /권한 문제/);
  assert.match(installFailureReason("This program is blocked by group policy. (os error 1260)", null), /보안 정책/);
  assert.match(installFailureReason("The requested operation requires elevation. (os error 740)", null), /관리자 권한이 필요/);
  assert.match(installFailureReason('CreateProcessW `"winget install"` failed: (os error 2)', null), /앱 설치 관리자/);
  assert.match(installFailureReason('CreateProcessW `"npm install"` failed: (os error 2)', null), /Node\.js/);
  assert.match(installFailureReason("Could not create SSL/TLS secure channel.", 1), /보안 연결/);
  assert.match(installFailureReason("curl: (6) Could not resolve host", 6), /인터넷/);
  assert.match(installFailureReason("something odd", 3), /오류 번호 3/);
  assert.match(notDetectedReason("Done!"), /껐다가 다시/);
});

test("권한 거부는 '로그인을 취소했다'로 보지 않는다", () => {
  assert.match(loginFailureReason("Error: EACCES: permission denied, open 'auth.json'"), /권한 문제/);
  assert.match(loginFailureReason("OAuth error: access_denied"), /취소했거나/);
  assert.equal(blockedReason("OAuth error: access_denied"), null);
});

test("자세한 내용은 읽을 수 있는 글로, 주소의 코드는 가려서", () => {
  const raw = "\x1b]0;title\x07\x1b[2J\x1b[1;1HError:\x1b[1Cnope\r\n\x1b[31m10%\r90%\x1b[0m\r\nopen https://x.test/cb?code=secret now";
  assert.equal(plainOutput(raw), "Error: nope\n90%\nopen https://x.test/cb?… now");
});
