// 가짜 팀 데이터 시나리오. 실제 Prism 백엔드 없이 앱 화면을 채운다 (scripts/shot.mjs가 /api 응답으로 돌려준다).
// 형태는 src/lib/api.ts 의 Project · TeamSnapshot 을 따른다.

const CFG = {
  preset: "bal",
  lead: { agent: "claude", model: "opus", effort: "medium", max: 1 },
  managers: { agent: "claude", model: "sonnet", effort: "medium", max: 2 },
  workers: { agent: "claude", model: "haiku", effort: "medium", max: 4 },
  concurrent: 4,
  safe: true,
  isolate: true,
  permissionMode: "default",
};

/** 시나리오 하나: 팀 목록과 각 팀 스냅샷. now는 호출 시각 기준이라 "몇 분 전" 표시가 자연스럽다. */
export function buildScenario(name) {
  const now = Date.now();
  const builder = SCENARIOS[name];
  if (!builder) throw new Error(`알 수 없는 시나리오 "${name}" (사용 가능: ${Object.keys(SCENARIOS).join(", ")})`);
  return builder(now);
}

export const SCENARIO_NAMES = () => Object.keys(SCENARIOS);

// ── 조립 도우미 ─────────────────────────────────────────

const agent = (now, id, name, role, status, taskId, extra = {}) => ({
  id,
  name,
  role,
  kind: "claude",
  model: role === "lead" ? "opus" : role === "mgr" ? "sonnet" : "haiku",
  effort: "high",
  status,
  taskId,
  parentId: role === "lead" ? null : role === "mgr" ? "lead" : "m1",
  ptyId: null,
  cwd: "",
  branch: null,
  sessionId: "",
  costUsd: status === "off" ? 0.42 : 0.08,
  startedAt: now - 900_000,
  statusSince: now - 30_000,
  lastNote: null,
  structured: true,
  activity: status === "work" ? [{ at: now - 1500, text: "✏️ index.html 수정" }] : [],
  thought: null,
  lastActive: now,
  stuck: null,
  restSince: null,
  ...extra,
});

const task = (now, id, title, assignee, stage, requestedBy, extra = {}) => ({
  id,
  title,
  goal: "",
  files: [],
  doneWhen: [],
  requestedBy,
  assignee,
  role: "worker",
  model: null,
  stage,
  summary: stage === "review" || stage === "done" ? "끝냈어요. 결과를 확인해 주세요." : null,
  branch: null,
  base: null,
  createdAt: now - 600_000,
  updatedAt: now - 60_000,
  followOf: null,
  ...extra,
});

const msg = (id, kind, text, at, extra = {}) => ({ id, kind, text, taskIds: [], at, escalation: null, permission: null, ...extra });

const team = (now, projectId, projectName, agents, tasks, chat = []) => ({
  projectId,
  projectName,
  cwd: `/tmp/${projectId}`,
  branch: "main",
  home: "main",
  team: CFG,
  agents,
  tasks,
  chat,
  events: [
    { at: now - 60_000, text: "T-3 요금 데이터 정리를 끝냈다", tone: null },
    { at: now - 300_000, text: "팀이 출근했다", tone: null },
  ],
  costUsd: 0.58,
});

const project = (now, id, name) => ({
  path: `/tmp/${id}`,
  isGit: true,
  team: CFG,
  lastOpened: now,
  knowledge: "",
  id,
  name,
});

// ── 시나리오 ─────────────────────────────────────────────

const SCENARIOS = {
  // 기본: 여러 팀이 한 화면에 — 총괄·팀장·작업자, 허락 요청, 휴게실 고양이, 끝난 세션
  demo: (now) => {
    const demoAgents = [
      agent(now, "lead", "총괄", "lead", "work", null),
      agent(now, "m1", "팀장 A", "mgr", "work", "T-1"),
      agent(now, "w1", "W1", "worker", "work", "T-2"),
      agent(now, "w2", "W2", "worker", "block", "T-4"),
      agent(now, "w3", "W3", "worker", "done", "T-3"),
      agent(now, "w4", "W4", "worker", "wait", null, { restSince: now - 120_000 }), // 휴게실에서 쉬는 중
      agent(now, "w5", "W5", "worker", "off", null), // 끝난 세션 (자리를 떠남)
    ];
    const demoTasks = [
      task(now, "T-1", "가격표 페이지 개편", "m1", "running", "lead"),
      task(now, "T-2", "표 컴포넌트 만들기", "w1", "running", "m1"),
      task(now, "T-3", "요금 데이터 정리", "w3", "review", "m1", { updatedAt: now - 20_000 }),
      task(now, "T-4", "결제 모듈 설치", "w2", "running", "m1"),
      task(now, "T-5", "약관 링크 고치기", "w5", "done", "m1"),
      task(now, "T-6", "로고 정리", "w4", "done", "m1"),
    ];
    const demoChat = [
      msg(1, "me", "가격표 페이지 새로 꾸며줘. 표도 예쁘게.", now - 900_000),
      msg(2, "lead", "네, 팀장 A에게 맡길게요. 표 부분과 데이터 정리는 나눠서 진행할게요.", now - 890_000),
      msg(3, "report", "요금 데이터 정리 끝났어요. 한 번 봐 주세요.", now - 60_000, { taskIds: ["T-3"] }),
      msg(4, "permission", "", now - 30_000, {
        permission: { agentId: "w2", tool: "Bash", detail: "npm install stripe", answer: null, decider: null },
      }),
    ];
    // 디자인팀: 총괄은 쉬는 중, 작업자 한 명이 일하는 중
    const designAgents = [
      agent(now, "dlead", "총괄", "lead", "wait", null),
      agent(now, "dw1", "W1", "worker", "work", "D-1"),
      agent(now, "dw2", "W2", "worker", "wait", null, { restSince: now - 600_000 }),
    ];
    const designTasks = [task(now, "D-1", "배너 그리기", "dw1", "running", "dlead"), task(now, "D-2", "아이콘 정리", "dw2", "done", "dlead")];
    return {
      projects: [project(now, "demo", "데모팀"), project(now, "design", "디자인팀"), project(now, "bank", "bank")],
      teams: {
        demo: team(now, "demo", "데모팀", demoAgents, demoTasks, demoChat),
        design: team(now, "design", "디자인팀", designAgents, designTasks, [msg(1, "lead", "배너 시안 먼저 잡아 볼게요.", now - 120_000)]),
        bank: team(now, "bank", "bank", [agent(now, "bank-l", "총괄", "lead", "wait", null)], []),
      },
      focus: "demo",
      // 편집 화면용: 엔진(figcraft 등)이 설치돼 있지 않으면 "설치 필요" 안내가 보인다
      edit: { projectId: "demo", taskId: "T-3", path: "가격표.figcraft" },
    };
  },

  // 팀이 많을 때: 팀 요약 탭이 가로로 넘치는 경우
  multi: (now) => {
    const names = ["데모팀", "디자인팀", "bank", "portfolio-site", "TeamSystem-UI", "re-qu-test"];
    const projects = names.map((n, i) => project(now, `p${i}`, n));
    const teams = {};
    projects.forEach((p, i) => {
      const agents = [
        agent(now, `p${i}-l`, "총괄", "lead", i % 2 ? "wait" : "work", null),
        agent(now, `p${i}-w1`, "W1", "worker", "work", `${i}-1`),
        agent(now, `p${i}-w2`, "W2", "worker", i % 3 === 0 ? "block" : "wait", null),
      ];
      const tasks = [
        task(now, `${i}-1`, `작업 ${i}-1 진행 중`, `p${i}-w1`, "running", `p${i}-l`),
        task(now, `${i}-2`, `작업 ${i}-2 검토 대기`, `p${i}-w2`, "review", `p${i}-l`),
        task(now, `${i}-3`, `작업 ${i}-3 완료`, `p${i}-w2`, "done", `p${i}-l`),
      ];
      teams[p.id] = team(now, p.id, p.name, agents, tasks);
    });
    return { projects, teams, focus: "p0", edit: null };
  },

  // 팀이 없을 때: 홈 화면(프로젝트 목록만)
  empty: (now) => ({
    projects: [project(now, "bank", "bank"), project(now, "portfolio-site", "portfolio-site")],
    teams: {},
    focus: null,
    edit: null,
  }),
};
