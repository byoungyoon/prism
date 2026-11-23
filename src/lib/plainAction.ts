// Turns a permission request (tool + raw command/path) into one plain line a non-developer can read.
// Simple keyword rules, checked in order: the first match wins. Unknown commands fall back to a
// generic line, so the raw text is always still available under the card's "원문 보기".

// Order matters: destructive and commit/push commands come first, so a commit message that
// mentions "test" or "build" still reads as a save, not a check.
const RULES: { test: RegExp; line: string }[] = [
  { test: /(^|[\s;&|(])(rm|rmdir|unlink)\b/, line: "파일을 지우려고 해요" },
  { test: /\bgit\s+commit\b/, line: "작업 내용을 저장하려고 해요" },
  { test: /\bgit\s+push\b/, line: "작업 내용을 올리려고 해요" },
  { test: /\binstall\b|설치|\b(npm|pnpm|yarn|bun|pip3?|brew|cargo)\s+(i|add)\b/, line: "필요한 부품을 설치하려고 해요" },
  { test: /\b(build|check|tsc|typecheck|lint|test|vitest|jest|pytest)\b/, line: "잘 만들어지는지 확인하려고 해요" },
  { test: /(^|[\s;&|(])(mv)\s/, line: "파일을 옮기거나 이름을 바꾸려고 해요" },
  { test: /(^|[\s;&|(])(cp)\s/, line: "파일을 복사하려고 해요" },
  { test: /(^|[\s;&|(])(mkdir)\s/, line: "폴더를 만들려고 해요" },
];

const TOOLS: Record<string, string> = {
  Write: "파일을 새로 만들거나 덮어쓰려고 해요",
  Edit: "파일을 고치려고 해요",
  MultiEdit: "파일을 고치려고 해요",
  NotebookEdit: "파일을 고치려고 해요",
  Read: "파일을 읽으려고 해요",
  WebFetch: "인터넷에서 정보를 가져오려고 해요",
  WebSearch: "인터넷에서 검색하려고 해요",
};

/** "tool" is the tool name (Bash, Write…); "detail" is the raw command or path. */
export function plainAction(tool: string, detail: string): string {
  if (tool === "Bash") {
    const hit = RULES.find((r) => r.test.test(detail));
    return hit ? hit.line : "명령을 실행하려고 해요";
  }
  return TOOLS[tool] ?? `${tool} 작업을 하려고 해요`;
}
