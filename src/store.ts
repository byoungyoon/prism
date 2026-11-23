import { useMemo } from "react";
import { create } from "zustand";
import { isRemote } from "./lib/transport";
import { notifyUser } from "./lib/notify";
import { plainAction } from "./lib/plainAction";
import { api, LOGIN_REQUIRED, type Account, type Batch, type PresetName, type Project, type Provider, type TeamConfig, type TeamSnapshot, type Usage } from "./lib/api";

export type View =
  | { name: "home" }
  | { name: "main" }
  | { name: "agent"; id: string }
  | { name: "settings" };

const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

interface AppState {
  // ui
  dark: boolean;
  left: boolean;
  right: boolean;
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
  /** 묶음 지시 (one order to several teams), newest last */
  batches: Batch[];

  toggleDark(): void;
  toggleLeft(): void;
  toggleRight(): void;
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
  /** jump to another working team's 관제탑 */
  switchTeam(id: string): void;
  /** open a screen (agent detail, focus view) of a given team */
  openIn(id: string, view: View): void;
  startTeam(projectId: string, cwd?: string): Promise<void>;
  /** `projectId` targets a given team; defaults to the current one */
  stopTeam(projectId?: string): Promise<void>;
  setPreset(preset: PresetName, projectId?: string): Promise<void>;
  saveTeam(team: TeamConfig): Promise<void>;
  /** `projectId` targets another team (multi view); defaults to the current one */
  sendToLead(text: string, projectId?: string): Promise<void>;
  /** one order to several teams: makes the batch first, the caller then sends to each team */
  startBatch(projectIds: string[], text: string): Promise<void>;
  answerEscalation(msgId: number, answer: string, projectId?: string): Promise<void>;
  answerPermission(msgId: number, answer: "allow" | "always" | "deny", projectId?: string): Promise<void>;
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

  // set once the saved batches are loaded: a batch that finished before this start is not announced
  let batchesListed = false;
  const upsertBatch = (b: Batch) => set((s) => ({ batches: [...s.batches.filter((x) => x.id !== b.id), b] }));

  return {
    dark: prefersDark(),
    left: true,
    right: true,
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
    batches: [],

    toggleDark: () => set((s) => ({ dark: !s.dark })),
    toggleLeft: () => set((s) => ({ left: !s.left })),
    toggleRight: () => set((s) => ({ right: !s.right })),
    go: (view) => set({ view }),
    selectNode: (selectedNode) => set({ selectedNode }),
    selectCard: (selectedCard) => set({ selectedCard }),
    setError: (e) => set({ error: e == null ? null : msg(e) }),

    init: async () => {
      await api.onSnapshot((snap) => {
        announceAsks(snap, get().projects.find((p) => p.id === snap.projectId)?.name ?? "팀");
        set((s) => ({ teams: { ...s.teams, [snap.projectId]: snap } }));
      });
      await api.onBatch((b) => {
        const prev = get().batches.find((x) => x.id === b.id);
        const wasDone = !!(prev?.finishedAt && prev.summary);
        const nowDone = !!(b.finishedAt && b.summary);
        // a batch that just finished: tell the user (only when we know it, or it's new since the list loaded)
        if (nowDone && !wasDone && (prev || batchesListed)) void notifyUser("종합 결과가 나왔어요", b.text.slice(0, 60));
        upsertBatch(b);
      });
      await api.onUsage((usage) => set({ usage }));
      void api.usage().then((usage) => set({ usage })).catch(() => {});
      await get().loadProjects();
      void get().loadAccounts();
      void api
        .batchList()
        .then((list) => {
          batchesListed = true;
          set((s) => ({ batches: [...list, ...s.batches.filter((b) => !list.some((x) => x.id === b.id))] }));
        })
        .catch(() => {});
      // every team's current state up front, so teams at work show without waiting for their next update
      const projects = get().projects;
      const snaps = await Promise.all(projects.map((p) => api.getTeam(p.id).catch(() => null)));
      set((s) => ({ teams: { ...s.teams, ...Object.fromEntries(snaps.filter((x) => x != null).map((x) => [x.projectId, x])) } }));
      // opened on a phone (remote): go straight to the 관제탑 when teams are at work
      if (isRemote && get().view.name === "home") {
        const { teams } = get();
        const first = projects.find((p) => isLive(teams[p.id]));
        if (first) set({ projectId: first.id, view: { name: "main" } });
      }
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

    openIn: (id, view) => set({ projectId: id, view }),
    switchTeam: (id) => set({ projectId: id, view: { name: "main" }, selectedNode: "lead", selectedCard: null }),

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

    stopTeam: guard(async (id?: string) => {
      const target = id ?? pid();
      await api.stopTeam(target);
      // other teams keep working: stay in the 관제탑 on one of them
      const next = get().projects.find((p) => p.id !== target && isLive(get().teams[p.id]));
      if (next) set({ projectId: next.id, view: { name: "main" }, selectedCard: null });
      else set({ view: { name: "home" } });
    }),

    setPreset: guard(async (preset: PresetName, id?: string) => replaceProject(await api.setPreset(id ?? pid(), preset))),
    saveTeam: guard(async (team: TeamConfig) => replaceProject(await api.setTeam(pid(), team))),
    sendToLead: guard(async (text: string, id?: string) => api.sendToLead(id ?? pid(), text)),
    startBatch: async (projectIds, text) => {
      try {
        upsertBatch(await api.batchCreate(projectIds, text));
      } catch (e) {
        // the teams still get the order (sent one by one, without the summary card)
        set({ error: msg(e) });
      }
    },
    answerEscalation: guard(async (msgId: number, answer: string, id?: string) => api.answerEscalation(id ?? pid(), msgId, answer)),
    answerPermission: guard(async (msgId: number, answer: "allow" | "always" | "deny", id?: string) => api.answerPermission(id ?? pid(), msgId, answer)),
    messageAgent: guard(async (agentId: string, text: string) => api.messageAgent(pid(), agentId, text)),
    setAgentModel: guard(async (agentId: string, model: string) => api.setAgentModel(pid(), agentId, model)),
    killAgent: guard(async (agentId: string) => api.killAgent(pid(), agentId)),
    pauseAgent: guard(async (agentId: string) => api.pauseAgent(pid(), agentId)),
    resumeAgent: guard(async (agentId: string) => api.resumeAgent(pid(), agentId)),
  };
});

export const isLive = (t?: TeamSnapshot) => !!t && t.agents.some((a) => a.status !== "off");


/** Waiting for the user: an open question, or a permission request no boss is deciding. */
export const waitsForMe = (m: { escalation: { answer: string | null } | null; permission: { answer: string | null; decider?: string | null } | null }) =>
  (!!m.escalation && !m.escalation.answer) || (!!m.permission && !m.permission.answer && !m.permission.decider);

/** permission requests already announced by a system notification, as "projectId:msgId" */
const announced = new Set<string>();

/** Notify once per new request that starts waiting for the user (only when the window is in the background). */
const announceAsks = (snap: TeamSnapshot, projectName: string) => {
  const asks = snap.chat.filter((m) => m.permission && waitsForMe(m));
  const keyOf = (id: number) => `${snap.projectId}:${id}`;
  const waiting = new Set(asks.map((m) => keyOf(m.id)));
  for (const k of [...announced]) if (k.startsWith(`${snap.projectId}:`) && !waiting.has(k)) announced.delete(k);
  const fresh = asks.filter((m) => !announced.has(keyOf(m.id)));
  if (!fresh.length) return;
  fresh.forEach((m) => announced.add(keyOf(m.id)));
  const first = fresh[0].permission!;
  const who = snap.agents.find((a) => a.id === first.agentId)?.name ?? "팀원";
  const body = fresh.length > 1 ? `허락이 필요한 일 ${fresh.length}건` : `${who} · ${plainAction(first.tool, first.detail)}`;
  void notifyUser(`${projectName} · 허락이 필요해요`, body);
};

/** Teams the 관제탑 shows together: every team at work, plus the open one. */
export const useShownTeams = () => {
  const projects = useApp((s) => s.projects);
  const teams = useApp((s) => s.teams);
  const current = useApp((s) => s.projectId);
  return useMemo(
    () => projects.flatMap((project) => (teams[project.id] && (isLive(teams[project.id]) || project.id === current) ? [{ project, team: teams[project.id] }] : [])),
    [projects, teams, current],
  );
};

/** Current project + its live team snapshot. */
export const useCurrent = () => {
  const projectId = useApp((s) => s.projectId);
  const project = useApp((s) => s.projects.find((p) => p.id === s.projectId));
  const team = useApp((s) => (projectId ? s.teams[projectId] : undefined));
  return { projectId, project, team };
};
