// Dev-only sample teams for looking at the 관제탑 without running real AI. They live only in the UI
// store (nothing is saved, no agent runs); actions on them just fail. Never shipped in releases:
// the toggle that loads this is behind `import.meta.env.DEV`.
import type { Agent, AgentStatus, ChatMsg, LogEvent, Project, Role, Stage, Task, TeamConfig, TeamSnapshot } from "../lib/api";

export const DEMO_PREFIX = "demo-";

const role = (model: string, max = 3) => ({ agent: "claude" as const, model, effort: "medium" as const, max });
const cfg: TeamConfig = { preset: "bal", lead: role("opus", 1), managers: role("sonnet"), workers: role("haiku", 6), concurrent: 8, permissionMode: "default", isolate: true };

export function makeDemo(): { projects: Project[]; teams: Record<string, TeamSnapshot> } {
  const now = Date.now();
  const min = (m: number) => now - m * 60_000;

  const agent = (id: string, name: string, r: Role, status: AgentStatus, extra: Partial<Agent> = {}): Agent => ({
    id,
    name,
    role: r,
    kind: "claude",
    model: r === "lead" ? "opus" : r === "mgr" ? "sonnet" : "haiku",
    effort: "medium",
    status,
    taskId: null,
    parentId: r === "lead" ? null : "lead",
    ptyId: null,
    cwd: "",
    branch: null,
    sessionId: id,
    costUsd: 0.12,
    startedAt: min(40),
    statusSince: min(3),
    lastNote: null,
    structured: true,
    activity: [],
    ...extra,
  });
  const task = (id: string, title: string, r: "mgr" | "worker", stage: Stage, by: string, to: string | null, extra: Partial<Task> = {}): Task => ({
    id,
    title,
    goal: `${title} — 요구사항대로 만들고 확인까지 해주세요.`,
    files: [],
    doneWhen: [],
    requestedBy: by,
    assignee: to,
    role: r,
    model: null,
    stage,
    summary: null,
    branch: null,
    base: null,
    createdAt: min(30),
    updatedAt: min(stage === "done" ? 20 : 2),
    ...extra,
  });
  let n = 0;
  const msg = (kind: ChatMsg["kind"], text: string, ago: number, extra: Partial<ChatMsg> = {}): ChatMsg => ({ id: ++n, kind, text, taskIds: [], at: min(ago), escalation: null, permission: null, ...extra });
  const ev = (ago: number, text: string, tone: LogEvent["tone"] = null): LogEvent => ({ at: min(ago), text, tone });
  const snap = (p: Project, agents: Agent[], tasks: Task[], chat: ChatMsg[], events: LogEvent[]): TeamSnapshot => ({
    projectId: p.id,
    projectName: p.name,
    cwd: p.path,
    branch: "main",
    team: cfg,
    agents,
    tasks,
    chat,
    events,
    costUsd: 1.84,
  });
  const project = (id: string, name: string): Project => ({ id: DEMO_PREFIX + id, name, path: `/Users/me/Prism/${name}`, isGit: true, team: cfg, lastOpened: now });

  // 쇼핑몰: busy — two 팀장, workers under them, one stuck, one waiting for permission
  const shop = project("shop", "쇼핑몰 (데모)");
  const shopTeam = snap(
    shop,
    [
      agent("lead", "총괄", "lead", "work"),
      agent("m1", "팀장 A", "mgr", "work", { taskId: "T-1" }),
      agent("m2", "팀장 B", "mgr", "block", { taskId: "T-2" }),
      agent("w1", "작업자 1", "worker", "work", { taskId: "T-3", parentId: "m1", activity: [{ at: min(1), text: "src/cart.ts 수정" }] }),
      agent("w2", "작업자 2", "worker", "wait", { taskId: "T-4", parentId: "m1" }),
      agent("w3", "작업자 3", "worker", "block", { taskId: "T-5", parentId: "m2" }),
    ],
    [
      task("T-1", "장바구니 기능", "mgr", "running", "lead", "m1"),
      task("T-2", "결제 연동", "mgr", "running", "lead", "m2"),
      task("T-3", "장바구니 화면", "worker", "running", "m1", "w1"),
      task("T-4", "수량 변경 버튼", "worker", "review", "m1", "w2", { summary: "수량 +/- 버튼과 합계 계산을 붙였어요." }),
      task("T-5", "카드 결제 모듈", "worker", "running", "m2", "w3"),
      task("T-6", "주문 내역 페이지", "mgr", "queued", "lead", null),
      task("T-7", "상품 목록", "mgr", "done", "lead", "m1", { summary: "상품 목록과 검색을 만들었어요." }),
    ],
    [
      msg("me", "장바구니랑 결제 붙여줘", 32),
      msg("lead", "접수했어요. 장바구니는 팀장 A, 결제는 팀장 B에게 맡겼어요.", 31, { taskIds: ["T-1", "T-2"] }),
      msg("escalation", "카드 결제만 할까요, 계좌이체도 넣을까요?", 4, {
        escalation: { agentId: "m2", taskId: "T-2", path: ["m2", "lead"], options: ["카드만", "둘 다"], answer: null },
      }),
      msg("permission", "작업자 3이(가) 실행하려고 해요", 2, { permission: { agentId: "w3", tool: "Bash", detail: "npm install stripe", answer: null } }),
    ],
    [ev(2, "작업자 3이(가) 허락을 기다린다: Bash npm install stripe", "block"), ev(4, "팀장 B가 막혔다: 카드 결제만 할까요", "block"), ev(12, "작업자 2가 T-4를 끝냈다."), ev(30, "팀이 출근했다. 총괄이 지시를 기다린다.")],
  );

  // 블로그: calm — one 팀장 with one worker, a finished card
  const blog = project("blog", "블로그 (데모)");
  const blogTeam = snap(
    blog,
    [agent("lead", "총괄", "lead", "wait"), agent("m1", "팀장 A", "mgr", "work", { taskId: "T-2" }), agent("w1", "작업자 1", "worker", "work", { taskId: "T-3", parentId: "m1" })],
    [
      task("T-1", "글 목록 페이지", "mgr", "done", "lead", "m1", { summary: "글 목록과 페이지 넘김을 만들었어요." }),
      task("T-2", "댓글 기능", "mgr", "running", "lead", "m1"),
      task("T-3", "댓글 입력창", "worker", "running", "m1", "w1"),
      task("T-4", "글 검색", "worker", "failed", "m1", null, { summary: "검색 라이브러리 설치에 실패했어요." }),
    ],
    [msg("me", "댓글 기능 추가해줘", 15), msg("lead", "접수! 팀장 A가 댓글 기능을 맡았어요.", 14, { taskIds: ["T-2"] })],
    [ev(6, "작업자 1이 T-3을 시작했다."), ev(15, "팀이 출근했다. 총괄이 지시를 기다린다.")],
  );

  // 문서: just clocked in — only the 총괄
  const docs = project("docs", "문서 (데모)");
  const docsTeam = snap(docs, [agent("lead", "총괄", "lead", "wait")], [], [msg("lead", "무엇을 도와드릴까요?", 1)], [ev(1, "팀이 출근했다. 총괄이 지시를 기다린다.")]);

  return { projects: [shop, blog, docs], teams: { [shop.id]: shopTeam, [blog.id]: blogTeam, [docs.id]: docsTeam } };
}
