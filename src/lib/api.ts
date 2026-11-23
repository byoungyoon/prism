// Typed wrapper over the Rust backend (src-tauri). Field names mirror the serde camelCase structs.
import { Channel, invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { call, on } from "./transport";

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

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export interface Agent {
  id: string;
  name: string;
  role: Role;
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
  activity: { at: number; text: string }[];
  /** what it's thinking right now (tail of its streamed reasoning), while a turn runs */
  thought?: string | null;
  /** when it last showed any sign of life — tells "slow" from "stuck" */
  lastActive?: number;
  /** why it looks stuck (long silence, or its process ended unexpectedly): offer "멈추고 다시" */
  stuck?: string | null;
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
  kind: "me" | "lead" | "report" | "escalation" | "permission" | "system";
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

export const api = {
  remoteStatus: () => call<RemoteStatus>("remote_status"),
  setRemote: (on: boolean) => call<RemoteStatus>("remote_set", { on }),
  remoteNewKey: () => call<RemoteStatus>("remote_new_key"),
  prefs: () => call<Prefs>("prefs_get"),
  setPrefs: (providers: Provider[], onboarded: boolean) => call<Prefs>("prefs_set", { providers, onboarded }),

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

  usage: () => call<Usage[]>("usage_get"),
  refreshUsage: () => call<void>("usage_refresh"),
  onUsage: (fn: (u: Usage[]) => void): Promise<UnlistenFn> => on<Usage[]>("usage://update", fn),
  models: (provider: Provider, home?: string | null) => call<ModelInfo[]>("models_list", { provider, home: home ?? null }),
  attachFiles: (projectId: string, paths: string[]) => call<string[]>("attach_files", { projectId, paths }),
  attachBytes: (projectId: string, name: string, data: number[]) => call<string>("attach_bytes", { projectId, name, data }),

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
  /** more work for whoever did `taskId`, with their context intact */
  followUp: (projectId: string, taskId: string, text: string) => call<void>("task_follow_up", { projectId, taskId, text }),
  teamBranches: (projectId: string) => call<BranchList>("team_branches", { projectId }),
  /** put the team on another branch (`create`: a new one, cut from where the team started) */
  setTeamBranch: (projectId: string, branch: string, create: boolean) => call<void>("team_set_branch", { projectId, branch, create }),
  answerEscalation: (projectId: string, msgId: number, answer: string) =>
    call<void>("escalation_answer", { projectId, msgId, answer }),
  answerPermission: (projectId: string, msgId: number, answer: "allow" | "always" | "deny") =>
    call<void>("permission_answer", { projectId, msgId, answer }),
  taskFiles: (projectId: string, taskId: string) => call<FileStat[]>("task_files", { projectId, taskId }),
  taskDiff: (projectId: string, taskId: string, path: string) => call<string>("task_diff", { projectId, taskId, path }),
  taskFile: (projectId: string, taskId: string, path: string) => call<string>("task_file", { projectId, taskId, path }),
  messageAgent: (projectId: string, agentId: string, text: string) =>
    call<void>("agent_message", { projectId, agentId, text }),
  setAgentModel: (projectId: string, agentId: string, model: string) =>
    call<void>("agent_set_model", { projectId, agentId, model }),
  killAgent: (projectId: string, agentId: string) => call<void>("agent_kill", { projectId, agentId }),
  pauseAgent: (projectId: string, agentId: string) => call<void>("agent_pause", { projectId, agentId }),
  resumeAgent: (projectId: string, agentId: string) => call<void>("agent_resume", { projectId, agentId }),

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
