import { create } from "zustand";
import { api, LOGIN_REQUIRED, type Account, type PresetName, type Project, type Provider, type TeamConfig, type TeamSnapshot, type Usage } from "./lib/api";

export type View =
  | { name: "home" }
  | { name: "main" }
  | { name: "focus"; layer: "lead" | "mgr" | "worker" }
  | { name: "agent"; id: string }
  | { name: "settings" };

const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

interface AppState {
  // ui
  dark: boolean;
  left: boolean;
  right: boolean;
  /** center of the control tower: report feed or layer stack */
  center: "feed" | "stack";
  view: View;
  selectedNode: string;
  selectedCard: string | null;
  error: string | null;

  // accounts
  accounts: Account[];
  /** account sheet open; `reason` explains why it popped up */
  accountSheet: { reason?: string; provider?: Provider } | null;
  /** subscription usage per provider */
  usage: Usage[];

  // data
  projects: Project[];
  /** workspace folder; each subfolder is a project */
  root: string;
  projectId: string | null;
  /** latest snapshot per project id */
  teams: Record<string, TeamSnapshot>;

  toggleDark(): void;
  toggleLeft(): void;
  toggleRight(): void;
  setCenter(c: "feed" | "stack"): void;
  go(view: View): void;
  selectNode(id: string): void;
  selectCard(id: string | null): void;
  setError(e: unknown): void;

  init(): Promise<void>;
  loadAccounts(): Promise<void>;
  openAccounts(reason?: string, provider?: Provider): void;
  closeAccounts(): void;
  loadProjects(): Promise<void>;
  createProject(name: string): Promise<Project | undefined>;
  setRoot(path: string): Promise<void>;
  openProject(id: string): Promise<void>;
  startTeam(projectId: string, cwd?: string): Promise<void>;
  stopTeam(): Promise<void>;
  setPreset(preset: PresetName): Promise<void>;
  saveTeam(team: TeamConfig): Promise<void>;
  sendToLead(text: string): Promise<void>;
  answerEscalation(msgId: number, answer: string): Promise<void>;
  answerPermission(msgId: number, answer: "allow" | "always" | "deny"): Promise<void>;
  messageAgent(agentId: string, text: string): Promise<void>;
  setAgentModel(agentId: string, model: string): Promise<void>;
  killAgent(agentId: string): Promise<void>;
  pauseAgent(agentId: string): Promise<void>;
  resumeAgent(agentId: string): Promise<void>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useApp = create<AppState>((set, get) => {
  const pid = () => {
    const id = get().projectId;
    if (!id) throw new Error("프로젝트를 먼저 열어주세요");
    return id;
  };
  const guard =
    <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
    async (...a: A) => {
      try {
        await fn(...a);
      } catch (e) {
        set({ error: msg(e) });
      }
    };
  const replaceProject = (p: Project) => set((s) => ({ projects: s.projects.map((x) => (x.id === p.id ? p : x)) }));

  return {
    dark: prefersDark(),
    left: true,
    right: true,
    center: "feed",
    view: { name: "home" },
    selectedNode: "lead",
    selectedCard: null,
    error: null,
    accounts: [],
    accountSheet: null,
    usage: [],
    projects: [],
    root: "",
    projectId: null,
    teams: {},

    toggleDark: () => set((s) => ({ dark: !s.dark })),
    toggleLeft: () => set((s) => ({ left: !s.left })),
    toggleRight: () => set((s) => ({ right: !s.right })),
    setCenter: (center) => set({ center }),
    go: (view) => set({ view }),
    selectNode: (selectedNode) => set({ selectedNode }),
    selectCard: (selectedCard) => set({ selectedCard }),
    setError: (e) => set({ error: e == null ? null : msg(e) }),

    init: async () => {
      await api.onSnapshot((snap) => set((s) => ({ teams: { ...s.teams, [snap.projectId]: snap } })));
      await api.onUsage((usage) => set({ usage }));
      void api.usage().then((usage) => set({ usage })).catch(() => {});
      await get().loadProjects();
      void get().loadAccounts();
    },

    loadAccounts: guard(async () => set({ accounts: await api.accounts() })),
    openAccounts: (reason, provider) => {
      set({ accountSheet: { reason, provider } });
      void get().loadAccounts();
    },
    closeAccounts: () => set({ accountSheet: null }),

    loadProjects: guard(async () => {
      const [projects, root] = await Promise.all([api.projects(), api.workspaceRoot()]);
      set({ projects, root });
    }),

    createProject: async (name) => {
      try {
        const p = await api.createProject(name);
        await get().loadProjects();
        return p;
      } catch (e) {
        set({ error: msg(e) });
      }
    },

    setRoot: guard(async (path: string) => {
      const projects = await api.setWorkspaceRoot(path);
      set({ projects, root: path });
    }),

    openProject: guard(async (id: string) => {
      const p = await api.touchProject(id);
      replaceProject(p);
      const snap = await api.getTeam(id);
      set((s) => ({
        projectId: id,
        teams: snap ? { ...s.teams, [id]: snap } : s.teams,
        view: snap && snap.agents.some((a) => a.status !== "off") ? { name: "main" } : s.view,
      }));
    }),

    startTeam: async (projectId: string, cwd?: string) => {
      try {
        const snap = await api.startTeam(projectId, cwd);
        set((s) => ({ projectId, teams: { ...s.teams, [projectId]: snap }, view: { name: "main" }, selectedNode: "lead" }));
      } catch (e) {
        const m = msg(e);
        if (m.includes(LOGIN_REQUIRED)) {
          const provider = (m.split(":")[1] as Provider) || "claude";
          const name = { claude: "Claude", codex: "Codex(ChatGPT)", antigravity: "Google Gemini(Antigravity)" }[provider];
          get().openAccounts(`팀 설정에서 ${name}를 쓰고 있어요. 출근하려면 먼저 ${name} 계정에 로그인해 주세요.`, provider);
        }
        else set({ error: msg(e) });
      }
    },

    stopTeam: guard(async () => {
      await api.stopTeam(pid());
      set({ view: { name: "home" } });
    }),

    setPreset: guard(async (preset: PresetName) => replaceProject(await api.setPreset(pid(), preset))),
    saveTeam: guard(async (team: TeamConfig) => replaceProject(await api.setTeam(pid(), team))),
    sendToLead: guard(async (text: string) => api.sendToLead(pid(), text)),
    answerEscalation: guard(async (msgId: number, answer: string) => api.answerEscalation(pid(), msgId, answer)),
    answerPermission: guard(async (msgId: number, answer: "allow" | "always" | "deny") => api.answerPermission(pid(), msgId, answer)),
    messageAgent: guard(async (agentId: string, text: string) => api.messageAgent(pid(), agentId, text)),
    setAgentModel: guard(async (agentId: string, model: string) => api.setAgentModel(pid(), agentId, model)),
    killAgent: guard(async (agentId: string) => api.killAgent(pid(), agentId)),
    pauseAgent: guard(async (agentId: string) => api.pauseAgent(pid(), agentId)),
    resumeAgent: guard(async (agentId: string) => api.resumeAgent(pid(), agentId)),
  };
});

/** Current project + its live team snapshot. */
export const useCurrent = () => {
  const projectId = useApp((s) => s.projectId);
  const project = useApp((s) => s.projects.find((p) => p.id === s.projectId));
  const team = useApp((s) => (projectId ? s.teams[projectId] : undefined));
  return { projectId, project, team };
};
