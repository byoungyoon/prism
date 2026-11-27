// Typed wrapper over the Rust backend (src-tauri). Field names mirror the serde camelCase structs.
import { Channel, invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { call, on, isRemote, uploadFile } from "./transport";

export type Role = "lead" | "mgr" | "worker";
export type AgentStatus = "work" | "wait" | "block" | "done" | "off";
export type Stage = "queued" | "running" | "review" | "done" | "failed";
export type PresetName = "save" | "bal" | "power" | "custom";

export type Effort = "" | "low" | "medium" | "high" | "xhigh" | "max";

export type Provider = "claude" | "codex" | "antigravity";

export interface RoleConfig {
  agent: Provider;
  /** alias ("opus") or full id ("claude-opus-5-5") */
  model: string;
  effort: Effort;
  max: number;
}

export interface TeamConfig {
  preset: PresetName;
  lead: RoleConfig;
  managers: RoleConfig;
  workers: RoleConfig;
  concurrent: number;
  permissionMode: "default" | "acceptEdits" | "bypassPermissions";
  isolate: boolean;
  /** work in a copy on a team branch; the original folder is never touched (results leave as a PR) */
  safe: boolean;
  /** the 총괄 merges finished work into the team branch itself (asks only on a clash or failing check) */
  autoMerge: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  isGit: boolean;
  team: TeamConfig;
  lastOpened: number;
  /** what every AI on this team should know, written by the user */
  knowledge: string;
  /** brought in from outside the workspace folder */
  linked?: boolean;
}

export interface StorageInfo {
  /** work folders on disk (the 총괄's included) */
  copies: number;
  copiesBytes: number;
  /** the shared build folder */
  buildBytes: number;
  /** folders the cleanup would delete now */
  reclaimable: number;
  reclaimableBytes: number;
}

export interface CleanupReport {
  removed: number;
  freedBytes: number;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

/** a call to an outside editor's MCP tool, with its small arguments (ids, slide numbers…);
 * an object argument comes as `{ keys: [...] }` (which properties it touches) */
export interface EngineCall {
  engine: "figcraft" | "deckcraft";
  tool: string;
  input: Record<string, unknown>;
}

export interface Activity {
  at: number;
  text: string;
  engine?: EngineCall;
}

export interface Agent {
  id: string;
  name: string;
  role: Role;
  /** 화면에서만: 이 팀원이 속한 프로젝트 id (스냅샷을 받을 때 붙인다. 고른 털색을 찾는 데 쓴다) */
  projectId?: string;
  kind: Provider;
  model: string;
  effort: Effort;
  status: AgentStatus;
  taskId: string | null;
  parentId: string | null;
  ptyId: number | null;
  cwd: string;
  branch: string | null;
  sessionId: string;
  costUsd: number;
  startedAt: number;
  statusSince: number;
  lastNote: string | null;
  /** runs without a terminal: show its conversation (agentTranscript) instead */
  structured: boolean;
  /** recent tool activity, newest last */
  activity: Activity[];
  /** what it's thinking right now (tail of its streamed reasoning), while a turn runs */
  thought?: string | null;
  /** when it last showed any sign of life — tells "slow" from "stuck" */
  lastActive?: number;
  /** why it looks stuck (long silence, or its process ended unexpectedly): offer "멈추고 다시" */
  stuck?: string | null;
  /** a 작업자 resting in the lounge between cards (session closed, takes the next card) — since when */
  restSince?: number | null;
}

export interface Task {
  id: string;
  title: string;
  goal: string;
  files: string[];
  doneWhen: string[];
  requestedBy: string;
  assignee: string | null;
  role: "mgr" | "worker";
  model: string | null;
  stage: Stage;
  summary: string | null;
  branch: string | null;
  base: string | null;
  createdAt: number;
  updatedAt: number;
  /** a follow-up ("이어서"): the card this one continues, by the same member */
  followOf: string | null;
  /** the assignee's name, kept after a finished member is cleared from the team */
  who?: string | null;
}

export interface Escalation {
  agentId: string;
  taskId: string | null;
  /** agent ids from the asker up to the lead */
  path: string[];
  options: string[];
  answer: string | null;
}

export interface Permission {
  agentId: string;
  tool: string;
  detail: string;
  answer: "allow" | "always" | "deny" | "timeout" | null;
  /** the boss deciding it first (팀장 / 총괄); null = it's waiting for the user */
  decider?: string | null;
  /** who answered ("사용자", "팀장 A"…) */
  decidedBy?: string | null;
}

export interface ChatMsg {
  id: number;
  /** "report": the 총괄's reply to a worker's report (taskIds[0] is that card) */
  kind: "me" | "lead" | "report" | "escalation" | "permission" | "system" | "divider";
  text: string;
  taskIds: string[];
  at: number;
  escalation: Escalation | null;
  permission: Permission | null;
}

export interface LogEvent {
  at: number;
  text: string;
  tone: "block" | null;
}

export interface TeamSnapshot {
  projectId: string;
  projectName: string;
  cwd: string;
  branch: string | null;
  /** safe mode: the original folder's branch the team branch was cut from ("main"…); null = works in place */
  home: string | null;
  team: TeamConfig;
  agents: Agent[];
  tasks: Task[];
  chat: ChatMsg[];
  events: LogEvent[];
  costUsd: number;
  /** tokens used: today's totals and per card. Missing in demo snapshots (screenshot tool) */
  usage?: TeamUsage;
}

/** Token counts: new input, output, cache reads and cache writes, as the CLIs report them. */
export interface Bucket {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** "opus" | "sonnet" | "haiku" | "fable", or the model's own name */
export interface ModelUse extends Bucket {
  model: string;
}

export interface MemberUse extends Bucket {
  agentId: string;
  name: string;
  models: ModelUse[];
}

/** a card's tokens so far (all days) */
export interface CardUse extends Bucket {
  taskId: string;
  models: ModelUse[];
}

/** "big": one turn re-sent a huge conversation (peakTokens); "rapid": many turns in a short time (turns) */
export interface UsageAlert {
  at: number;
  kind: "big" | "rapid";
  agentName: string;
  taskId: string | null;
  peakTokens: number | null;
  turns: number | null;
}

export interface TeamUsage {
  /** today, the whole team */
  today: Bucket;
  /** today, by model */
  models: ModelUse[];
  members: MemberUse[];
  cards: CardUse[];
  alerts: UsageAlert[];
}

/** Branches the team can be pointed at (not Prism's own work branches). */
export interface BranchList {
  /** the branch the team works on now */
  current: string;
  list: string[];
}

export interface FileStat {
  path: string;
  /** -1 for binary files */
  added: number;
  removed: number;
}

/** What merging a report's card would bring into the team's branch */
export interface MergeCheck {
  into: string | null;
  /** commits the team's branch doesn't have yet; 0 means nothing to merge */
  commits: number;
  files: number;
}

/** One card's outcome of 합치기 */
export interface MergeOutcome {
  taskId: string;
  result: "merged" | "nothing" | "conflict" | "failed";
  message: string;
}

export interface GitChange {
  path: string;
  /** porcelain XY code, trimmed: "M", "A", "D", "??" … */
  code: string;
}

export interface AuthStatus {
  loggedIn: boolean;
  /** "claude.ai" = subscription; "console"/"api_key" = API billing; "none"; "missing" = no claude CLI */
  authMethod: string;
  email: string | null;
  orgName: string | null;
  subscriptionType: string | null;
  configDirectory: string | null;
}

export interface Account {
  id: string;
  provider: Provider;
  name: string;
  dir: string | null;
  active: boolean;
  status: AuthStatus;
}

/** team_start error when the active account isn't signed in ("LOGIN_REQUIRED:<provider>") */
export const LOGIN_REQUIRED = "LOGIN_REQUIRED";

export interface UsageWindow {
  id: string;
  label: string;
  /** 0–100 */
  usedPercent: number;
  /** ISO string or epoch seconds */
  resetsAt: string | number | null;
}

export interface Usage {
  provider: Provider;
  windows: UsageWindow[];
  plan: string | null;
  /** why there's nothing to show (not signed in …) */
  note: string | null;
  updatedAt: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  note: string;
  efforts: string[];
}

export interface TranscriptEntry {
  at: number;
  /** "in" message to the agent · "text" agent said · "tool" agent did · "done" turn result · "error" */
  kind: "in" | "text" | "tool" | "done" | "error";
  text: string;
}

export interface CliStatus {
  /** "git" | "node" | "claude" | "codex" | "agy" */
  name: string;
  label: string;
  installed: boolean;
  version: string | null;
  /** last background update result */
  note: string | null;
}

export interface Prefs {
  providers: Provider[];
  onboarded: boolean;
  /** teams clocked in when the app last closed (project ids) */
  lastTeams: string[];
  /** clock them back in when the app starts */
  autoResume: boolean;
  /** the app closed with teams at work: "update" (they come back regardless of autoResume) | "quit" */
  restart?: "update" | "quit" | null;
  /** ask before closing the window or quitting while members are at work */
  confirmQuit: boolean;
  /** desktop notification when a request starts waiting for the user */
  askAlert: boolean;
  /** desktop notification when work finishes, fails or gets stuck */
  workAlert: boolean;
  /** 안전한 일(읽기·빌드·내 브랜치 커밋)은 묻지 않고 허락 */
  autoAllowSafe: boolean;
  /** 츄르 잔액 (상점에서 쓰는 돈) */
  churu: number;
  /** 산 물건 id: "cat:<털색 id>" · "item:<이름>" (기본 ["cat:white"]) */
  owned: string[];
  /** 사용자가 고른 팀원 털색: "<프로젝트 id>:<직책>:<팀원 이름>" → 털색 id (없으면 자동 배정) */
  coats?: Record<string, string>;
  /** 지어 준 고양이 이름 (키는 coats와 같다) */
  catNames?: Record<string, string>;
}

/** 토큰 말고 방금 받은 츄르 (Rust ChuruReward). streak는 출석일 때의 연속 일수 */
export interface ChuruReward {
  kind: "attend" | "card" | "pet" | "gift";
  amount: number;
  streak: number;
  /** 선물일 때만: 표시에 쓸 말과 안내 문구 (Rust Gift) */
  gift?: { id: string; amount: number; label: string; message: string } | null;
}

/** 고양이 뽑기 확률표 한 줄 (Rust gacha_info). tier는 흔함·레어·에픽·유니크·레전더리, percent는 소수 첫째 자리까지 */
export interface GachaCatInfo {
  id: string;
  tier: string;
  percent: number;
}

/** 고양이 뽑기 정보 (Rust gacha_info) */
export interface GachaInfo {
  price: number;
  cats: GachaCatInfo[];
}

/** 뽑기 1회 결과 (Rust gacha_pull). cat은 "cat:<털색 id>" */
export interface GachaPulled {
  cat: string;
  isNew: boolean;
  prefs: Prefs;
}

/** desktop alerts, switched separately: a permission request | work finished, failed or stuck */
export type AlertKind = "ask" | "work";

/** Why an old Prism is (or would be) what shows up; see src-tauri/src/install.rs. */
export type InstallKind = "replaced" | "newerRunning" | "oldRunning" | "openInstalled" | "move";
export interface InstallIssue {
  kind: InstallKind;
  /** the version running in this window */
  version: string;
  other: string | null;
  /** where this app was opened from, when outside Applications */
  place: string | null;
}

/** The backend holds back a window close or quit: "window" (Cmd+W, the red button) | "quit" (Cmd+Q). */
export type QuitKind = "window" | "quit";
/** Sent when a close or quit would stop `working` members. */
export interface QuitAsk {
  kind: QuitKind;
  working: number;
}

export interface RemoteStatus {
  enabled: boolean;
  running: boolean;
  key: string;
  /** pairing link (tailnet HTTPS + key) once published */
  url: string | null;
  tailscale: { installed: boolean; running: boolean; dnsName: string | null };
  note: string | null;
}

/** One order sent to several teams at once ("묶음 지시"). `summary` appears once every team has finished. */
export interface Batch {
  id: string;
  text: string;
  sentAt: number;
  teams: { projectId: string; state: "run" | "done" | "failed" }[];
  summary?: string;
  finishedAt?: number;
}

export interface PtyState {
  done: boolean;
  code: number | null;
  /** last output of a finished program, with terminal escapes */
  tail: string;
}

export const api = {
  remoteStatus: () => call<RemoteStatus>("remote_status"),
  setRemote: (on: boolean) => call<RemoteStatus>("remote_set", { on }),
  remoteNewKey: () => call<RemoteStatus>("remote_new_key"),
  prefs: () => call<Prefs>("prefs_get"),
  setAutoResume: (on: boolean) => call<Prefs>("prefs_set_auto_resume", { on }),
  setConfirmQuit: (on: boolean) => call<Prefs>("prefs_set_confirm_quit", { on }),
  setAlert: (kind: AlertKind, on: boolean) => call<Prefs>("prefs_set_alert", { kind, on }),
  /** desktop only: a clickable notification about a team (skipped when that kind is off, or when `watching` and the window is in front) */
  teamAlert: (projectId: string, kind: AlertKind, title: string, body: string, watching: boolean) => call<void>("team_alert", { projectId, kind, title, body, watching }),
  /** desktop only: the user clicked such a notification */
  onAlertOpen: (fn: (projectId: string) => void): Promise<UnlistenFn> => on<string>("alert-open", fn),
  setAutoAllowSafe: (on: boolean) => call<Prefs>("prefs_set_auto_allow_safe", { on }),
  /** let the held-back window close (or quit) go through after the user pressed 끄기 */
  quitConfirm: (kind: QuitKind) => call<void>("app_quit_confirm", { kind }),
  installCheck: () => call<InstallIssue | null>("install_check"),
  installFix: (kind: InstallKind) => call<void>("install_fix", { kind }),
  clearRestart: () => call<Prefs>("prefs_clear_restart"),
  /** save every team and member's session (marked "restarted") right before the app restarts itself */
  prepareRestart: (reason: "update" | "quit" = "update") => call<void>("app_prepare_restart", { reason }),
  setPrefs: (providers: Provider[], onboarded: boolean) => call<Prefs>("prefs_set", { providers, onboarded }),
  /** buy a shop item (소품 only; the price is Rust's): returns the updated prefs, or rejects with a plain Korean reason */
  buyItem: (id: string) => call<Prefs>("shop_buy", { id }),
  /** 팀원 털색 고르기 (coat null = 자동으로 되돌리기). 가진 털색이 아니면 Korean reason으로 reject */
  setCoat: (member: string, coat: string | null) => call<Prefs>("prefs_set_coat", { member, coat }),
  /** 고양이 이름 짓기 (name null = 원래 이름으로). 빈 이름·12자 넘는 이름은 Korean reason으로 reject */
  setCatName: (member: string, name: string | null) => call<Prefs>("prefs_set_cat_name", { member, name }),
  /** 고양이 뽑기 가격과 고양이별 등급·확률 (화면 확률표) */
  gachaInfo: () => call<GachaInfo>("gacha_info"),
  /** 고양이 뽑기 1회: 결과와 새 prefs. 잔액 부족·다 모음이면 Korean reason으로 reject (차감 없음) */
  gachaPull: () => call<GachaPulled>("gacha_pull"),
  onPrefs: (fn: (p: Prefs) => void): Promise<UnlistenFn> => on<Prefs>("prefs", fn),
  /** 그날 첫 접속 보상 (이미 받았으면 null) */
  rewardAttend: () => call<ChuruReward | null>("reward_attend"),
  /** 기념 선물 (받은 적 있으면 null) */
  rewardGift: () => call<ChuruReward | null>("reward_gift"),
  /** 고양이 쓰다듬기·들어 올리기 보상 (오늘 상한을 넘었으면 null) */
  rewardPet: () => call<ChuruReward | null>("reward_pet"),
  /** 작업 카드가 완료돼 츄르를 받았다 (출석·고양이 보상은 위 명령의 응답으로 온다) */
  onChuruReward: (fn: (r: ChuruReward) => void): Promise<UnlistenFn> => on<ChuruReward>("churu-reward", fn),

  // agent CLIs
  cliStatus: () => call<CliStatus[]>("cli_status"),
  cliAutoUpdate: () => call<boolean>("cli_auto_update"),
  setCliAutoUpdate: (on: boolean) => call<void>("cli_set_auto_update", { on }),
  cliInstall: (name: string, cols: number, rows: number) => call<number>("cli_install", { name, cols, rows }),
  cliUpdateNow: () => call<CliStatus[]>("cli_update_now"),
  onCliStatus: (fn: (s: CliStatus[]) => void): Promise<UnlistenFn> => on<CliStatus[]>("cli://status", fn),

  // accounts
  accounts: () => call<Account[]>("accounts_list"),
  addAccount: (provider: Provider, name: string) => call<string>("account_add", { provider, name }),
  removeAccount: (id: string) => call<void>("account_remove", { id }),
  setActiveAccount: (id: string) => call<void>("account_set_active", { id }),
  loginAccount: (id: string, cols: number, rows: number) => call<number>("account_login", { id, cols, rows }),
  logoutAccount: (id: string) => call<void>("account_logout", { id }),
  /** how a program is doing; still answers after it ended (null: unknown id) */
  ptyState: (id: number) => call<PtyState | null>("pty_state", { id }),

  usage: () => call<Usage[]>("usage_get"),
  refreshUsage: () => call<void>("usage_refresh"),
  onUsage: (fn: (u: Usage[]) => void): Promise<UnlistenFn> => on<Usage[]>("usage://update", fn),
  models: (provider: Provider, home?: string | null) => call<ModelInfo[]>("models_list", { provider, home: home ?? null }),
  attachFiles: (projectId: string, paths: string[]) => call<string[]>("attach_files", { projectId, paths }),
  /** Attach a file/Blob: remote uploads raw bytes; desktop passes bytes to the app. */
  attachBlob: async (projectId: string, name: string, blob: Blob) =>
    isRemote
      ? uploadFile(projectId, name, blob)
      : call<string>("attach_bytes", { projectId, name, data: Array.from(new Uint8Array(await blob.arrayBuffer())) }),

  // projects
  projects: () => call<Project[]>("projects_list"),
  workspaceRoot: () => call<string>("workspace_root"),
  setWorkspaceRoot: (path: string) => call<Project[]>("workspace_set_root", { path }),
  createProject: (name: string) => call<Project>("project_create", { name }),
  /** a folder from anywhere on this Mac becomes a project (nothing in it changes) */
  importProject: (path: string) => call<Project>("project_import", { path }),
  /** take a brought-in folder off the list; the folder stays as it is */
  forgetProject: (id: string) => call<void>("project_forget", { id }),
  touchProject: (id: string) => call<Project>("project_touch", { id }),
  setTeam: (id: string, team: TeamConfig) => call<Project>("project_set_team", { id, team }),
  setPreset: (id: string, preset: PresetName) => call<Project>("project_set_preset", { id, preset }),
  /** notes for every AI: one shared by all teams, and one per project */
  knowledge: () => call<string>("knowledge_get"),
  setKnowledge: (text: string) => call<void>("knowledge_set", { text }),
  setProjectKnowledge: (id: string, text: string) => call<Project>("project_set_knowledge", { id, text }),
  worktrees: (path: string) => call<WorktreeInfo[]>("worktrees_list", { path }),
  gitChanges: (cwd: string) => call<GitChange[]>("git_changes", { cwd }),
  gitDiff: (cwd: string, path: string) => call<string>("git_diff", { cwd, path }),

  // team
  startTeam: (projectId: string, cwd?: string) => call<TeamSnapshot>("team_start", { projectId, cwd: cwd ?? null }),
  stopTeam: (projectId: string) => call<void>("team_stop", { projectId }),
  getTeam: (projectId: string) => call<TeamSnapshot | null>("team_get", { projectId }),
  sendToLead: (projectId: string, text: string) => call<void>("lead_send", { projectId, text }),
  /** end the 총괄's conversation and start a fresh one: it writes a hand-over memo first (cards and workers stay) */
  renewLead: (projectId: string) => call<void>("lead_renew", { projectId }),
  /** one order to several teams: the batch keeps track of them and makes a summary when all are done */
  batchCreate: (projectIds: string[], text: string) => call<Batch>("batch_create", { projectIds, text }),
  batchList: () => call<Batch[]>("batch_list"),
  onBatch: (fn: (b: Batch) => void): Promise<UnlistenFn> => on<Batch>("batch-update", fn),
  /** more work for whoever did `taskId`, with their context intact */
  followUp: (projectId: string, taskId: string, text: string) => call<void>("task_follow_up", { projectId, taskId, text }),
  teamBranches: (projectId: string) => call<BranchList>("team_branches", { projectId }),
  /** put the team on another branch (`create`: a new one, cut from where the team started) */
  setTeamBranch: (projectId: string, branch: string, create: boolean) => call<void>("team_set_branch", { projectId, branch, create }),
  /** what merging this report's card would bring in (commits, files) */
  taskMergeCheck: (projectId: string, taskId: string) => call<MergeCheck>("task_merge_check", { projectId, taskId }),
  /** 합치기: each card's branch goes into the team's branch; a conflict is taken back and handed to the 총괄 */
  taskMerge: (projectId: string, taskIds: string[]) => call<MergeOutcome[]>("task_merge", { projectId, taskIds }),
  /** 완료 on a report with nothing to merge */
  taskComplete: (projectId: string, taskId: string) => call<void>("task_complete", { projectId, taskId }),
  /** disk used by the work folders and the shared build folder, and what the cleanup would remove */
  teamStorage: (projectId: string) => call<StorageInfo>("team_storage", { projectId }),
  /** delete the work folders that are merged (or unmerged and finished over a week ago); branches stay */
  teamCleanup: (projectId: string) => call<CleanupReport>("team_cleanup", { projectId }),
  answerEscalation: (projectId: string, msgId: number, answer: string) =>
    call<void>("escalation_answer", { projectId, msgId, answer }),
  answerPermission: (projectId: string, msgId: number, answer: "allow" | "always" | "deny") =>
    call<void>("permission_answer", { projectId, msgId, answer }),
  taskFiles: (projectId: string, taskId: string) => call<FileStat[]>("task_files", { projectId, taskId }),
  taskDiff: (projectId: string, taskId: string, path: string) => call<string>("task_diff", { projectId, taskId, path }),
  taskFile: (projectId: string, taskId: string, path: string) => call<string>("task_file", { projectId, taskId, path }),
  /** raw bytes (base64) + stamp; the work copy's version if it exists, else the branch's */
  taskFileBytes: (projectId: string, taskId: string, path: string) =>
    call<{ b64: string; stamp: string }>("task_file_bytes", { projectId, taskId, path }),
  /** "mtimeNs:size" | "git:<sha>" | "missing" */
  taskFileStamp: (projectId: string, taskId: string, path: string) => call<string>("task_file_stamp", { projectId, taskId, path }),
  /** writes into the task's work copy; returns the new stamp */
  taskFileSave: (projectId: string, taskId: string, path: string, b64: string) =>
    call<string>("task_file_save", { projectId, taskId, path, b64 }),
  /** files in the task's work copy (uncommitted too) whose name ends with one of `exts` (".figcraft", ".pptx"); paths relative to the copy */
  taskEngineFiles: (projectId: string, taskId: string, exts: string[]) =>
    call<{ path: string; size: number }[]>("task_engine_files", { projectId, taskId, exts }),
  messageAgent: (projectId: string, agentId: string, text: string) =>
    call<void>("agent_message", { projectId, agentId, text }),
  setAgentModel: (projectId: string, agentId: string, model: string) =>
    call<void>("agent_set_model", { projectId, agentId, model }),
  killAgent: (projectId: string, agentId: string) => call<void>("agent_kill", { projectId, agentId }),
  pauseAgent: (projectId: string, agentId: string) => call<void>("agent_pause", { projectId, agentId }),
  resumeAgent: (projectId: string, agentId: string) => call<void>("agent_resume", { projectId, agentId }),
  /** a broken member starts again on the same card */
  restartAgent: (projectId: string, agentId: string) => call<void>("agent_restart", { projectId, agentId }),

  transcript: (projectId: string, agentId: string) => call<TranscriptEntry[]>("agent_transcript", { projectId, agentId }),
  onEntry: (fn: (e: { projectId: string; agentId: string; entry: TranscriptEntry }) => void): Promise<UnlistenFn> =>
    on<{ projectId: string; agentId: string; entry: TranscriptEntry }>("agent://entry", fn),
  onSnapshot: (fn: (s: TeamSnapshot) => void): Promise<UnlistenFn> =>
    on<TeamSnapshot>("team://snapshot", fn),
};

// ── terminals ─────────────────────────────────────────

function toBytes(msg: ArrayBuffer | number[]): Uint8Array {
  return msg instanceof ArrayBuffer ? new Uint8Array(msg) : Uint8Array.from(msg);
}

export const pty = {
  spawnShell: (cols: number, rows: number, cwd?: string) =>
    invoke<number>("pty_spawn_shell", { cwd: cwd ?? null, cols, rows }),
  /** Replays scrollback, then streams live output. Returns a detach function. */
  async attach(id: number, onData: (bytes: Uint8Array) => void): Promise<() => void> {
    const ch = new Channel<ArrayBuffer | number[]>();
    ch.onmessage = (m) => onData(toBytes(m));
    const sub = await invoke<number>("pty_attach", { id, onData: ch });
    return () => void invoke("pty_detach", { id, sub });
  },
  write: (id: number, data: string) => invoke<void>("pty_write", { id, data }),
  resize: (id: number, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  kill: (id: number) => invoke<void>("pty_kill", { id }),
};

// ── dashboard (대시보드 탭) ─────────────────────────────
// 백엔드(src-tauri) 계약 그대로. 웹은 Tauri 자식 웹뷰라 칸 위치를 web_bounds로 계속 알려 준다.

export type WidgetKind = "web" | "sheet" | "slack";

/** AI가 바꾼 결과 한 장: 표 · 요약 · 막대/선 그래프 중 하나 */
export interface AiView {
  type: "table" | "summary" | "chart";
  title: string;
  columns?: string[];
  rows?: (string | number | null)[][];
  text?: string;
  chart?: {
    kind: "bar" | "line";
    labels: string[];
    series: { name: string; values: number[] }[];
  };
}

export interface Widget {
  id: string;
  kind: WidgetKind;
  title: string;
  /** 12열 격자 칸 위치와 크기 (x·w는 열, y·h는 줄) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 연결 설정 (web: url · sheet: path · slack: channelId, channelName) */
  config: Record<string, string>;
  view?: { prompt: string; result?: AiView; showOriginal: boolean };
}

/** 대시보드 설계도 (src/components/dashboard/blueprint.ts 와 같은 모양) */
export interface Dashboard {
  version: 1;
  widgets: Widget[];
}

export interface SheetData {
  headers: string[];
  rows: (string | number | boolean | null)[][];
  sheetName: string;
  truncated: boolean;
}

export interface SlackStatus {
  connected: boolean;
  team: string | null;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface SlackMessage {
  ts: string;
  user: string;
  userName: string;
  text: string;
  time: string;
}

export const dashboardApi = {
  load: () => call<Dashboard>("dashboard_load"),
  save: (dashboard: Dashboard) => call<void>("dashboard_save", { dashboard }),

  // web: 메인 창 기준 논리 px
  webOpen: (widgetId: string, url: string, x: number, y: number, w: number, h: number) =>
    call<void>("web_open", { widgetId, url, x, y, w, h }),
  webBounds: (widgetId: string, x: number, y: number, w: number, h: number) =>
    call<void>("web_bounds", { widgetId, x, y, w, h }),
  webShow: (widgetId: string) => call<void>("web_show", { widgetId }),
  webHide: (widgetId: string) => call<void>("web_hide", { widgetId }),
  webReload: (widgetId: string) => call<void>("web_reload", { widgetId }),
  webClose: (widgetId: string) => call<void>("web_close", { widgetId }),
  webHideAll: () => call<void>("web_hide_all"),
  webText: (widgetId: string) => call<string>("web_text", { widgetId }),

  // sheet: 바뀌면 "dashboard://sheet-changed" 이벤트로 알려 준다
  sheetRead: (path: string) => call<SheetData>("sheet_read", { path }),
  sheetWatch: (widgetId: string, path: string) => call<void>("sheet_watch", { widgetId, path }),
  sheetUnwatch: (widgetId: string) => call<void>("sheet_unwatch", { widgetId }),
  onSheetChanged: (fn: (p: { widgetId: string; path: string }) => void): Promise<UnlistenFn> =>
    on<{ widgetId: string; path: string }>("dashboard://sheet-changed", fn),

  // slack: 토큰은 백엔드에만 머문다 (프론트 상태·저장소에 넣지 않는다). 읽기 전용.
  slackTokenSet: (token: string) => call<{ team: string; user: string }>("slack_token_set", { token }),
  slackTokenStatus: () => call<SlackStatus>("slack_token_status"),
  slackTokenClear: () => call<void>("slack_token_clear"),
  slackChannels: () => call<SlackChannel[]>("slack_channels"),
  slackHistory: (channelId: string, limit: number) => call<SlackMessage[]>("slack_history", { channelId, limit }),

  aiTransform: (prompt: string, data: string, source: WidgetKind) => call<AiView>("ai_transform", { prompt, data, source }),
  /** 말로 설명한 대시보드 → 설계도 초안 (검사는 화면에서 한다) */
  aiDashboardDraft: (description: string) => call<unknown>("ai_dashboard_draft", { description }),
};
