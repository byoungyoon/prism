// 연결(로그인) 흐름의 판단. 화면은 components/ConnectPanel.tsx.

export type LoginPhase = "waiting" | "success" | "failed";

/** `exit` is the sign-in program's exit code (null while it still runs). When switching accounts
 *  the old one stays signed in until the new sign-in ends, so only a clean exit counts. */
export function loginPhase({ switching, loggedIn, exit }: { switching: boolean; loggedIn: boolean; exit: number | null }): LoginPhase {
  if (loggedIn && (!switching || exit === 0)) return "success";
  return exit === null ? "waiting" : "failed";
}

const REASONS: [RegExp, string][] = [
  [/address already in use|port \S* ?is already in use|eaddrinuse/i, "다른 로그인 창이 아직 열려 있어요. 다른 로그인을 닫고 다시 시도해 주세요."],
  [/access[_ ]denied|denied|cancell?ed/i, "브라우저에서 로그인을 취소했거나 허용하지 않았어요."],
  [/timed? ?out|etimedout/i, "시간이 너무 오래 지났어요."],
  [/enotfound|econnrefused|econnreset|network|error sending request|fetch failed|offline/i, "인터넷에 연결하지 못했어요. 연결을 확인해 주세요."],
  [/expired|wasn't accepted|invalid.{0,20}(code|grant|state)/i, "로그인 시간이 지났거나 예전 로그인 화면을 썼어요. 새로 열린 화면에서 해주세요."],
];

/** Plain words for why a sign-in didn't finish, from what the sign-in program printed. */
export function loginFailureReason(output: string): string {
  // the URL's own words (scope, redirect…) must not look like an error
  const text = output.replace(/https?:\/\/\S+/g, "");
  return REASONS.find(([re]) => re.test(text))?.[1] ?? "로그인이 끝나지 않았어요. 브라우저에서 로그인을 마쳤는지 확인해 주세요.";
}

/** The page Prism may reopen: only one that returns to this computer by itself. Claude prints a
 *  fallback address that ends in a code to copy, so that one is never offered. */
export function reopenUrl(output: string): string | null {
  return output.match(/https:\/\/auth\.openai\.com\/oauth\/\S+redirect_uri=http%3A%2F%2F(?:127\.0\.0\.1|localhost)[^\s\x1b\x07]+/)?.[0] ?? null;
}
