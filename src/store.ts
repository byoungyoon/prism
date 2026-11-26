import { useMemo } from "react";
import { create } from "zustand";
import { isRemote, onResync } from "./lib/transport";
import { notifyUser } from "./lib/notify";
import { useEngineEdit } from "./engines/editing";
import { plainAction } from "./lib/plainAction";
import { inOffice } from "./lib/crew";
import { workNews } from "./lib/workNews";
import { api, LOGIN_REQUIRED, type AlertKind, type Account, type Batch, type PresetName, type Project, type Provider, type TeamConfig, type TeamSnapshot, type Usage } from "./lib/api";
import { catName, setOwnedCoats } from "./components/critters/pixel/coats";
import { DEFAULT_OWNED } from "./lib/shop";
import type { GachaPulled, Prefs } from "./lib/api";

/**
 * 뽑기 연출 중에는 잔액·보유 물건·사무실 털색 반영을 미룬다 (결과가 연출보다 먼저 새지 않게).
 * 연출이 끝나면 `releaseGacha`가 밀린 값을 한 번에 반영한다.
 */
let holding = false;
let held: Prefs | null = null;

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
  /** 관제탑 화면 종류: 사무실(기본) 또는 대시보드 탭 */
  mainTab: "office" | "dashboard";
  setMainTab(mainTab: "office" | "dashboard"): void;

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
  /** teams that were clocked in when the app last closed (as of this launch) */
  lastTeams: string[];
  /** clock the last teams back in when the app starts */
  autoResume: boolean;
  /** teams that could not clock in during the last group clock-in, with a plain reason */
  startFailures: { id: string; name: string; reason: string }[];
  /** a group clock-in is running */
  clockingIn: boolean;
  /** 츄르 잔액 and the things bought so far ("cat:<id>" · "item:<이름>") */
  churu: number;
  owned: string[];
  /** the 상점 sheet is open */
  shopOpen: boolean;
  /** show the teammate characters (board, live work, walking about the app); kept on this device */
  critters: boolean;
  /** ask before closing the window or quitting while members are at work */
  confirmQuit: boolean;
  /** desktop notification when a request waits for the user */
  askAlert: boolean;
  /** desktop notification when work finishes, fails or gets stuck */
  workAlert: boolean;
  /** a notification was clicked: show this team (and its 허락 칸, if it has requests) */
  askFocus: { projectId: string; at: number } | null;
  /** let teammates do safe things without asking */
  autoAllowSafe: boolean;

  openShop(on: boolean): void;
  /** buy one shop item (소품); resolves to null on success, or a plain Korean reason to show */
  buyItem(id: string): Promise<string | null>;
  /**
   * 고양이 뽑기 1회 요청. 결과는 바로 돌아오지만 잔액·보유 반영은 `releaseGacha()` 전까지 미룬다.
   * 실패(잔액 부족 등)면 반영할 것이 없으니 바로 풀리고 이유를 돌려준다.
   */
  startGacha(): Promise<{ ok: true; res: GachaPulled } | { ok: false; reason: string }>;
  /** 뽑기 연출이 끝났을 때 (또는 상점을 닫았을 때) 미뤄 둔 잔액·보유 반영을 한 번에 한다 */
  releaseGacha(): void;
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
  /** clock several teams in; one failing never stops the others. Returns how many are in now. */
  startMany(ids: string[]): Promise<number>;
  /** every team that is not in yet */
  clockInAll(): Promise<number>;
  /** the teams from before the app closed that are not in yet */
  clockInLast(): Promise<number>;
  setAutoResume(on: boolean): Promise<void>;
  setConfirmQuit(on: boolean): Promise<void>;
  setAlert(kind: AlertKind, on: boolean): Promise<void>;
  /** open the team a clicked notification was about */
  showAlertTeam(projectId: string): void;
  setAutoAllowSafe(on: boolean): Promise<void>;
  dismissFailures(): void;
  setCritters(on: boolean): void;
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

/** Why a team could not clock in, in plain words. */
const plainReason = (m: string) => {
  if (m.includes(LOGIN_REQUIRED)) {
    const provider = (m.split(":")[1] as Provider) || "claude";
    const name = { claude: "Claude", codex: "Codex(ChatGPT)", antigravity: "Google Gemini(Antigravity)" }[provider] ?? "AI";
    return `${name} 로그인이 필요해요`;
  }
  if (m.includes("no such project")) return "프로젝트를 찾을 수 없어요";
  if (m.includes("git 준비 실패")) return "폴더를 준비하지 못했어요";
  return m;
};

const CRITTERS_KEY = "prism.critters";
const savedCritters = () => {
  try {
    return localStorage.getItem(CRITTERS_KEY) !== "off";
  } catch {
    return true;
  }
};

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
  // the automatic clock-in happens once per launch
  let autoResumed = false;
  /** the shop's money and purchases, from prefs (read at start, then on every change) */
  const applyPrefs = (p: Prefs) => {
    if (holding) {
      held = p;
      return;
    }
    const owned = p.owned ?? DEFAULT_OWNED;
    setOwnedCoats(owned);
    // a new coat renames and repaints teammates: every screen showing them draws again
    set((s) => ({ churu: p.churu ?? 0, owned, ...(owned.join() === s.owned.join() ? {} : { teams: { ...s.teams } }) }));
  };
  const releaseGacha = () => {
    holding = false;
    const p = held;
    held = null;
    if (p) applyPrefs(p);
  };
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
    lastTeams: [],
    autoResume: true,
    startFailures: [],
    clockingIn: false,
    critters: savedCritters(),
    confirmQuit: true,
    askAlert: true,
    workAlert: true,
    askFocus: null,
    autoAllowSafe: true,
    churu: 0,
    owned: [...DEFAULT_OWNED],
    shopOpen: false,

    openShop: (shopOpen) => set({ shopOpen }),
    mainTab: "office",
    setMainTab: (mainTab) => set({ mainTab }),
    startGacha: async () => {
      holding = true;
      try {
        const res = await api.gachaPull();
        // 연출 중이면 미룬다. 이미 풀렸다면(상점을 닫은 뒤 도착) 바로 반영한다
        if (holding) held = res.prefs;
        else applyPrefs(res.prefs);
        return { ok: true, res };
      } catch (e) {
        releaseGacha();
        return { ok: false, reason: msg(e) };
      }
    },
    releaseGacha,
    buyItem: async (id) => {
      try {
        applyPrefs(await api.buyItem(id));
        return null;
      } catch (e) {
        return msg(e);
      }
    },

    toggleDark: () => set((s) => ({ dark: !s.dark })),
    toggleLeft: () => set((s) => ({ left: !s.left })),
    toggleRight: () => set((s) => ({ right: !s.right })),
    go: (view) => set({ view }),
    selectNode: (selectedNode) => set({ selectedNode }),
    selectCard: (selectedCard) => set({ selectedCard }),
    setError: (e) => set({ error: e == null ? null : msg(e) }),

    init: async () => {
      await api.onSnapshot((snap) => {
        const prev = get().teams[snap.projectId];
        set((s) => ({ teams: { ...s.teams, [snap.projectId]: snap } }));
        const name = get().projects.find((p) => p.id === snap.projectId)?.name ?? "팀";
        const watching = isWatching(get(), snap.projectId);
        announceAsks(snap, name, watching);
        // a team seen for the first time has nothing "new": its past isn't announced
        if (prev) announceWork(prev, snap, name, watching);
      });
      await api.onBatch((b) => {
        const prev = get().batches.find((x) => x.id === b.id);
        const wasDone = !!(prev?.finishedAt && prev.summary);
        const nowDone = !!(b.finishedAt && b.summary);
        // a batch that just finished: tell the user (only when we know it, or it's new since the list loaded)
        if (nowDone && !wasDone && (prev || batchesListed)) void notifyUser("종합 결과가 나왔어요", b.text.slice(0, 60));
        upsertBatch(b);
      });
      await api.onPrefs(applyPrefs);
      if (!isRemote) await api.onAlertOpen((id) => get().showAlertTeam(id));
      void api.prefs().then(applyPrefs).catch(() => {});
      await api.onUsage((usage) => set({ usage }));
      void api.usage().then((usage) => set({ usage })).catch(() => {});
      const reload = async () => {
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
      };
      await reload();
      // remote: after a reconnect (or dropped updates) fetch everything again
      if (isRemote) onResync(() => void reload());
      const projects = get().projects;
      // teams from the last session: remember them, and clock them in again if the user wants that
      if (!isRemote) {
        const prefs = await api.prefs().catch(() => null);
        if (prefs) {
          const known = prefs.lastTeams.filter((id) => projects.some((p) => p.id === id));
          set({ lastTeams: known, autoResume: prefs.autoResume, confirmQuit: prefs.confirmQuit, askAlert: prefs.askAlert, workAlert: prefs.workAlert, autoAllowSafe: prefs.autoAllowSafe });
          // restarted for an update: everyone comes back, whatever the setting says
          const updated = prefs.restart === "update";
          if ((prefs.autoResume || updated) && !autoResumed) {
            autoResumed = true;
            const todo = known.filter((id) => !isLive(get().teams[id]));
            if (todo.length) {
              await get().startMany(todo);
              const failed = get().startFailures;
              if (failed.length) set({ error: failed.map((f) => `${f.name}: ${f.reason}`).join(" / ") });
            }
          }
          if (prefs.restart) void api.clearRestart().catch(() => {});
        }
      }
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
        view: isLive(snap ?? undefined) ? { name: "main" } : s.view,
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

    startMany: async (ids) => {
      const failures: { id: string; name: string; reason: string }[] = [];
      set({ clockingIn: true, startFailures: [] });
      for (const id of ids) {
        const name = get().projects.find((p) => p.id === id)?.name ?? "팀";
        try {
          const snap = await api.startTeam(id);
          set((s) => ({ teams: { ...s.teams, [id]: snap } }));
        } catch (e) {
          failures.push({ id, name, reason: plainReason(msg(e)) });
        }
      }
      const { projects, teams } = get();
      const live = projects.filter((p) => isLive(teams[p.id]));
      set({ clockingIn: false, startFailures: failures });
      if (live.length > 1) set({ projectId: live[0].id, view: { name: "main" }, selectedNode: "lead" });
      else if (live.length === 1 && ids.includes(live[0].id)) get().switchTeam(live[0].id);
      return live.length;
    },
    clockInAll: async () => {
      const { projects, teams } = get();
      return get().startMany(projects.filter((p) => !isLive(teams[p.id])).map((p) => p.id));
    },
    clockInLast: async () => {
      const { lastTeams, teams } = get();
      return get().startMany(lastTeams.filter((id) => !isLive(teams[id])));
    },
    setAutoResume: async (on) => {
      set({ autoResume: on });
      try {
        await api.setAutoResume(on);
      } catch (e) {
        set({ autoResume: !on, error: msg(e) });
      }
    },
    setConfirmQuit: async (on) => {
      set({ confirmQuit: on });
      try {
        await api.setConfirmQuit(on);
      } catch (e) {
        set({ confirmQuit: !on, error: msg(e) });
      }
    },
    setAlert: async (kind, on) => {
      const patch = (v: boolean) => (kind === "ask" ? { askAlert: v } : { workAlert: v });
      set(patch(on));
      try {
        await api.setAlert(kind, on);
      } catch (e) {
        set({ ...patch(!on), error: msg(e) });
      }
    },
    showAlertTeam: (projectId) => {
      if (!get().projects.some((p) => p.id === projectId)) return;
      // an open editor is only tucked away: closing it would lose unsaved edits
      useEngineEdit.getState().tuck();
      if (get().projectId !== projectId) get().switchTeam(projectId);
      set({ view: { name: "main" }, left: true, shopOpen: false, accountSheet: null, askFocus: { projectId, at: Date.now() } });
    },
    setAutoAllowSafe: async (on) => {
      set({ autoAllowSafe: on });
      try {
        await api.setAutoAllowSafe(on);
      } catch (e) {
        set({ autoAllowSafe: !on, error: msg(e) });
      }
    },
    dismissFailures: () => set({ startFailures: [] }),
    setCritters: (on) => {
      set({ critters: on });
      try {
        localStorage.setItem(CRITTERS_KEY, on ? "on" : "off");
      } catch {
        // private mode: the choice lasts for this session only
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

/** Someone still on the clock: finished ("done") members don't keep a stopped team clocked in. */
export const isActive = (status: string) => status !== "off" && status !== "done";
export const isLive = (t?: TeamSnapshot) => !!t && t.agents.some((a) => isActive(a.status));
/** someone on the team is in the middle of a turn */
export const isBusy = (t?: TeamSnapshot) => !!t && t.agents.some((a) => a.status === "work");


/** Waiting for the user: an open question, or a permission request no boss is deciding. */
export const waitsForMe = (m: { escalation: { answer: string | null } | null; permission: { answer: string | null; decider?: string | null } | null }) =>
  (!!m.escalation && !m.escalation.answer) || (!!m.permission && !m.permission.answer && !m.permission.decider);

/** permission requests already announced by a system notification, as "projectId:msgId" */
const announced = new Set<string>();

/** Is this team on screen? (Whether the window is in front is checked where the alert is sent.) */
const isWatching = (s: AppState, projectId: string) => {
  if (s.view.name !== "main" || useEngineEdit.getState().covering()) return false;
  // several teams share one chat, which lists all of their requests
  return s.projectId === projectId || isLive(s.teams[projectId]);
};

/**
 * One alert about a team: the desktop app sends a clickable system notification, a phone browser
 * its own (in the background only). Alerts are sent from here and nowhere else.
 */
const alertTeam = (projectId: string, kind: AlertKind, title: string, body: string, watching: boolean) => {
  if (isRemote) void notifyUser(title, body);
  else void api.teamAlert(projectId, kind, title, body, watching).catch(() => {});
};

const andMore = (n: number) => (n > 1 ? ` 외 ${n - 1}건` : "");

/** Notify when cards reporting to the 총괄 finish, are wrapped up or fail, and when someone gets stuck. */
const announceWork = (prev: TeamSnapshot, snap: TeamSnapshot, projectName: string, watching: boolean) => {
  const news = workNews(prev, snap, catName);
  if (news.length) alertTeam(snap.projectId, "work", "팀 소식", `${projectName} · ${news[0]}${andMore(news.length)}`, watching);
};

/** Notify once per new request that starts waiting for the user. */
const announceAsks = (snap: TeamSnapshot, projectName: string, watching: boolean) => {
  const asks = snap.chat.filter((m) => m.permission && waitsForMe(m));
  const keyOf = (id: number) => `${snap.projectId}:${id}`;
  const waiting = new Set(asks.map((m) => keyOf(m.id)));
  for (const k of [...announced]) if (k.startsWith(`${snap.projectId}:`) && !waiting.has(k)) announced.delete(k);
  const fresh = asks.filter((m) => !announced.has(keyOf(m.id)));
  if (!fresh.length) return;
  fresh.forEach((m) => announced.add(keyOf(m.id)));
  const first = fresh[0].permission!;
  const ag = snap.agents.find((a) => a.id === first.agentId);
  const who = ag ? catName(ag) : "팀원";
  alertTeam(snap.projectId, "ask", "허락이 필요해요", `${projectName} · ${who} · ${plainAction(first.tool, first.detail)}${andMore(fresh.length)}`, watching);
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

/**
 * The teams the office shows: the shown ones, plus teams nobody is in that still have cats in the
 * lounge (resting or reported 작업자 stay when the 총괄 leaves — see `inOffice`).
 */
export const useOfficeTeams = () => {
  const projects = useApp((s) => s.projects);
  const teams = useApp((s) => s.teams);
  const current = useApp((s) => s.projectId);
  return useMemo(
    () => projects.flatMap((project) => (teams[project.id] && (inOffice(teams[project.id]) || project.id === current) ? [{ project, team: teams[project.id] }] : [])),
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
