// 설치·로그인이 안 됐을 때 프로그램이 남긴 글에서 진짜 이유를 쉬운 말로 찾는다.

/** 컴퓨터가 막은 경우들. 위에서부터 먼저 맞는 것을 쓴다 (영어·한국어 윈도우 둘 다). */
const BLOCKED: [RegExp, string][] = [
  [/os error 1260|group policy|그룹 정책|blocked by .{0,40}policy|disabled by .{0,40}(administrator|policy)|applocker|running scripts is disabled|스크립트를 실행할 수 없|constrained ?language|0x800704ec|0x8a15003a/i, "컴퓨터의 보안 정책(회사·학교 설정)이 설치나 실행을 막았어요. 컴퓨터 관리자에게 허용해 달라고 해 주세요."],
  [/os error 225\b|contains a virus|바이러스|virus or potentially unwanted/i, "백신(보안 프로그램)이 파일을 막았어요. 백신의 차단 기록에서 허용한 뒤 다시 시도해 주세요."],
  [/os error 1223\b|0x800704c7|operation was cancell?ed by the user|exit code:? ?(1602|1223)\b|사용자가 .{0,20}취소/i, "설치 중에 뜬 허용 창에서 취소됐어요. 다시 시도하고, 창이 뜨면 '예'를 눌러 주세요."],
  [/os error 740\b|requires elevation|elevation required|administrator privileges|run as administrator|관리자 권한|권한 상승|error 1925\b/i, "관리자 권한이 필요해요. Prism을 닫고, Prism 아이콘을 오른쪽 클릭해 '관리자 권한으로 실행'한 뒤 다시 시도해 주세요."],
  [/os error 5\b|access is denied|access to the path .{0,200}is denied|액세스가 거부|permission denied|\beacces\b|\beperm\b|unauthorizedaccess/i, "컴퓨터가 파일 접근을 거부했어요(권한 문제). 백신이나 회사 보안 설정이 막고 있을 수 있어요. 그래도 안 되면 Prism을 '관리자 권한으로 실행'해 주세요."],
  [/winget[\s\S]{0,400}(os error 2\b|not recognized|인식되지|no viable candidates)/i, "윈도우의 '앱 설치 관리자'(winget)가 없어요. Microsoft Store에서 '앱 설치 관리자'를 설치하거나 업데이트한 뒤 다시 시도해 주세요."],
  [/\bnpm\b[\s\S]{0,400}(os error 2\b|not recognized|인식되지|no viable candidates)/i, "Node.js가 먼저 필요해요. Node.js를 설치한 뒤 Prism을 다시 켜고 시도해 주세요."],
  [/git[- ]bash|requires git|CLAUDE_CODE_GIT_BASH_PATH/i, "Git이 먼저 필요해요. Git을 설치한 뒤 다시 시도해 주세요."],
  [/ssl\/tls|secure channel|보안 채널|certificate|인증서|self[_ ]signed|\bcert_/i, "보안 연결(인증서)에 실패했어요. 회사 네트워크나 백신이 가로챌 때 생겨요. 다른 네트워크에서 해보거나 윈도우를 업데이트해 주세요."],
  [/os error 112\b|enospc|not enough (disk )?space|no space left|공간이 부족/i, "저장 공간이 부족해요. 공간을 비운 뒤 다시 시도해 주세요."],
];

const OFFLINE = /enotfound|econnrefused|econnreset|could not resolve|unable to connect|원격 이름|원격 서버에 연결|network (error|is unreachable)|connection (timed out|refused|reset)|etimedout|offline/i;

export function blockedReason(text: string): string | null {
  return BLOCKED.find(([re]) => re.test(text))?.[1] ?? null;
}

/** 터미널 출력에서 색·커서 기호를 없애고 마지막 줄들만. 주소의 ? 뒤(로그인 코드)는 가린다. */
export function plainOutput(raw: string, lines = 30): string {
  return raw
    .replace(/\x1b\][\s\S]*?(\x07|\x1b\\)/g, "")
    .replace(/\x1b\[(\d*)C/g, (_, n) => " ".repeat(Math.min(Number(n) || 1, 80)))
    .replace(/\x1b\[[\d;]*[Hf]/g, "\n")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b./g, "")
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f]/g, "")
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']+/g, "$1?…")
    .split(/\r?\n/)
    // 진행 막대처럼 줄 안에서 덮어쓴 것은 마지막 것만
    .map((l) => l.replace(/\r+$/, "").split("\r").pop()!.trimEnd())
    .filter(Boolean)
    .slice(-lines)
    .join("\n");
}

/** 설치 프로그램이 오류로 끝났거나 시작도 못 했을 때. */
export function installFailureReason(output: string, code: number | null): string {
  const text = output.replace(/https?:\/\/\S+/g, "");
  return (
    blockedReason(text) ??
    (OFFLINE.test(text) ? "인터넷에 연결하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요." : null) ??
    `설치 프로그램이 오류로 끝났어요${code === null ? "" : ` (오류 번호 ${code})`}. 아래 '자세한 내용'을 복사해 보내 주세요.`
  );
}

/** 설치 프로그램은 정상으로 끝났는데 Prism이 프로그램을 못 찾을 때. */
export function notDetectedReason(output: string): string {
  return blockedReason(output.replace(/https?:\/\/\S+/g, "")) ?? "설치는 끝났다고 하는데 프로그램이 확인되지 않아요. Prism을 완전히 껐다가 다시 켜 주세요. 그래도 같으면 아래 '자세한 내용'을 복사해 보내 주세요.";
}
