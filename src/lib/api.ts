// Typed wrapper over the Rust backend (src-tauri). Field names mirror the serde camelCase structs.
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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
}

export interface Project {
  id: string;
  name: string;
  path: string;
  isGit: boolean;
  team: TeamConfig;
  lastOpened: number;
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
}

export interface ChatMsg {
  id: number;
  kind: "me" | "lead" | "escalation" | "permission" | "system";
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
  team: TeamConfig;
  agents: Agent[];
  tasks: Task[];
  chat: ChatMsg[];
  events: LogEvent[];
  costUsd: number;
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

export const api = {
  prefs: () => invoke<Prefs>("prefs_get"),
  setPrefs: (providers: Provider[], onboarded: boolean) => invoke<Prefs>("prefs_set", { providers, onboarded }),

  // agent CLIs
  cliStatus: () => invoke<CliStatus[]>("cli_status"),
  cliAutoUpdate: () => invoke<boolean>("cli_auto_update"),
  setCliAutoUpdate: (on: boolean) => invoke<void>("cli_set_auto_update", { on }),
  cliInstall: (name: string, cols: number, rows: number) => invoke<number>("cli_install", { name, cols, rows }),
  cliUpdateNow: () => invoke<CliStatus[]>("cli_update_now"),
  onCliStatus: (fn: (s: CliStatus[]) => void): Promise<UnlistenFn> => listen<CliStatus[]>("cli://status", (e) => fn(e.payload)),

  // accounts
  accounts: () => invoke<Account[]>("accounts_list"),
  addAccount: (provider: Provider, name: string) => invoke<string>("account_add", { provider, name }),
  removeAccount: (id: string) => invoke<void>("account_remove", { id }),
  setActiveAccount: (id: string) => invoke<void>("account_set_active", { id }),
  loginAccount: (id: string, cols: number, rows: number) => invoke<number>("account_login", { id, cols, rows }),
  logoutAccount: (id: string) => invoke<void>("account_logout", { id }),

  usage: () => invoke<Usage[]>("usage_get"),
  refreshUsage: () => invoke<void>("usage_refresh"),
  onUsage: (fn: (u: Usage[]) => void): Promise<UnlistenFn> => listen<Usage[]>("usage://update", (e) => fn(e.payload)),
  models: (provider: Provider, home?: string | null) => invoke<ModelInfo[]>("models_list", { provider, home: home ?? null }),
  attachFiles: (projectId: string, paths: string[]) => invoke<string[]>("attach_files", { projectId, paths }),
  attachBytes: (projectId: string, name: string, data: number[]) => invoke<string>("attach_bytes", { projectId, name, data }),

  // projects
  projects: () => invoke<Project[]>("projects_list"),
  workspaceRoot: () => invoke<string>("workspace_root"),
  setWorkspaceRoot: (path: string) => invoke<Project[]>("workspace_set_root", { path }),
  createProject: (name: string) => invoke<Project>("project_create", { name }),
  touchProject: (id: string) => invoke<Project>("project_touch", { id }),
  setTeam: (id: string, team: TeamConfig) => invoke<Project>("project_set_team", { id, team }),
  setPreset: (id: string, preset: PresetName) => invoke<Project>("project_set_preset", { id, preset }),
  worktrees: (path: string) => invoke<WorktreeInfo[]>("worktrees_list", { path }),
  gitChanges: (cwd: string) => invoke<GitChange[]>("git_changes", { cwd }),
  gitDiff: (cwd: string, path: string) => invoke<string>("git_diff", { cwd, path }),

  // team
  startTeam: (projectId: string, cwd?: string) => invoke<TeamSnapshot>("team_start", { projectId, cwd: cwd ?? null }),
  stopTeam: (projectId: string) => invoke<void>("team_stop", { projectId }),
  getTeam: (projectId: string) => invoke<TeamSnapshot | null>("team_get", { projectId }),
  sendToLead: (projectId: string, text: string) => invoke<void>("lead_send", { projectId, text }),
  answerEscalation: (projectId: string, msgId: number, answer: string) =>
    invoke<void>("escalation_answer", { projectId, msgId, answer }),
  answerPermission: (projectId: string, msgId: number, answer: "allow" | "always" | "deny") =>
    invoke<void>("permission_answer", { projectId, msgId, answer }),
  taskFiles: (projectId: string, taskId: string) => invoke<FileStat[]>("task_files", { projectId, taskId }),
  taskDiff: (projectId: string, taskId: string, path: string) => invoke<string>("task_diff", { projectId, taskId, path }),
  taskFile: (projectId: string, taskId: string, path: string) => invoke<string>("task_file", { projectId, taskId, path }),
  messageAgent: (projectId: string, agentId: string, text: string) =>
    invoke<void>("agent_message", { projectId, agentId, text }),
  setAgentModel: (projectId: string, agentId: string, model: string) =>
    invoke<void>("agent_set_model", { projectId, agentId, model }),
  killAgent: (projectId: string, agentId: string) => invoke<void>("agent_kill", { projectId, agentId }),
  pauseAgent: (projectId: string, agentId: string) => invoke<void>("agent_pause", { projectId, agentId }),
  resumeAgent: (projectId: string, agentId: string) => invoke<void>("agent_resume", { projectId, agentId }),

  transcript: (projectId: string, agentId: string) => invoke<TranscriptEntry[]>("agent_transcript", { projectId, agentId }),
  onEntry: (fn: (e: { projectId: string; agentId: string; entry: TranscriptEntry }) => void): Promise<UnlistenFn> =>
    listen<{ projectId: string; agentId: string; entry: TranscriptEntry }>("agent://entry", (e) => fn(e.payload)),
  onSnapshot: (fn: (s: TeamSnapshot) => void): Promise<UnlistenFn> =>
    listen<TeamSnapshot>("team://snapshot", (e) => fn(e.payload)),
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
