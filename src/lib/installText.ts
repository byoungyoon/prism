// The words of the "old version" notice (see InstallNotice).
import type { InstallIssue } from "./api";

export function installText({ kind, version, other, place }: InstallIssue): { title: string; lines: string[]; action: string } {
  const old = other ? `예전 Prism(${other})` : "예전 Prism";
  switch (kind) {
    case "replaced":
      return {
        title: "새 버전이 설치됐어요",
        lines: [`지금 보이는 창은 아직 예전 Prism ${version}이에요. 다시 켜면 ${other} 버전이 나와요.`, "팀은 하던 대화 그대로 이어져요."],
        action: "새 버전으로 다시 켜기",
      };
    case "oldRunning":
      return {
        title: "예전 Prism이 아직 켜져 있어요",
        lines: [`지금 연 건 ${version} 버전인데 ${old}도 함께 켜져 있어요. 그대로 두면 예전 화면이 또 나올 수 있어요.`, "예전 Prism에서 하던 일은 멈춰요."],
        action: "예전 Prism 닫고 새로 켜기",
      };
    case "newerRunning":
      return {
        title: "지금 연 건 예전 Prism이에요",
        lines: [`이 창은 ${version} 버전이고, 새 버전 ${other}이 이미 켜져 있어요.`, "버튼을 누르면 이 예전 창은 닫혀요."],
        action: "새 버전으로 가기",
      };
    case "openInstalled": {
      const same = other === version;
      return {
        title: same ? "설치된 Prism이 아닌 걸 열었어요" : "예전 Prism을 열었어요",
        lines: [
          `지금 연 건 ${place ?? "다른 곳"}의 Prism ${version}이에요.`,
          same ? "응용 프로그램 폴더에 같은 버전이 설치돼 있어요. 그걸 써야 업데이트가 제대로 돼요." : `응용 프로그램 폴더에는 새 버전 ${other}이 있어요.`,
        ],
        action: same ? "설치된 Prism 열기" : "새 버전 열기",
      };
    }
    case "move":
      return {
        title: "Prism을 응용 프로그램 폴더로 옮겨 주세요",
        lines: [
          `지금은 ${place ?? "다른 곳"}에서 켜졌어요. 이대로 쓰면 업데이트가 안 되거나, 다음에 예전 버전이 열릴 수 있어요.`,
          ...(other ? [`응용 프로그램 폴더에 있던 예전 버전 ${other}은 휴지통으로 가고, 지금 버전 ${version}으로 바뀌어요.`] : []),
        ],
        action: "응용 프로그램 폴더로 옮기기",
      };
  }
}
