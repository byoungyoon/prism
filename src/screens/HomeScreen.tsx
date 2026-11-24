import { useState, type ReactNode, type SVGProps } from "react";
import { AnimatePresence, motion } from "motion/react";
import { open } from "@tauri-apps/plugin-dialog";
import { isRemote } from "../lib/transport";
import { modelLabel } from "../data/models";
import { api, type PresetName, type Project } from "../lib/api";
import { useApp } from "../store";

const spring = { type: "spring" as const, stiffness: 260, damping: 28 };

function Ic({ children, size = 16, ...rest }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}
const Plus = () => (
  <Ic>
    <path d="M12 5v14M5 12h14" />
  </Ic>
);
const Gear = () => (
  <Ic size={14}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
  </Ic>
);
const Play = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 4.5v15l12-7.5z" />
  </svg>
);

const PRESETS: { id: PresetName; label: string }[] = [
  { id: "save", label: "절약" },
  { id: "bal", label: "균형" },
  { id: "power", label: "파워" },
];
const PRESET_TITLE: Record<PresetName, string> = {
  save: "작고 알뜰한 팀",
  bal: "균형 잡힌 팀",
  power: "전력 투구 팀",
  custom: "맞춤 구성 팀",
};
const PRESET_NOTE: Record<PresetName, string> = {
  save: "판단까지 가벼운 AI가 맡아요. 작은 수정에 좋아요.",
  bal: "판단은 똑똑한 AI, 실행은 가벼운 AI가 맡아요.",
  power: "큰 작업이나 마감 직전에. 사용량이 빨리 줄어요.",
  custom: "설정에서 직접 구성한 팀이에요.",
};

function ago(ms: number) {
  if (!ms) return "";
  const d = Date.now() - (ms < 1e12 ? ms * 1000 : ms);
  const m = Math.floor(d / 60000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const days = Math.floor(h / 24);
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

export function HomeScreen() {
  const projects = useApp((s) => s.projects);
  const teams = useApp((s) => s.teams);
  const go = useApp((s) => s.go);
  const [selId, setSelId] = useState<string | null>(null);
  /** teams picked to clock in together (the check on each card) */
  const [picked, setPicked] = useState<string[]>([]);
  const root = useApp((s) => s.root);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [arriving, setArriving] = useState(-1); // 0 worker, 1 manager, 2 lead
  const [busy, setBusy] = useState(false);
  const lastTeams = useApp((s) => s.lastTeams);
  const clockingIn = useApp((s) => s.clockingIn);
  const failures = useApp((s) => s.startFailures);

  const cur: Project | undefined = projects.find((p) => p.id === selId) ?? projects[0];
  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const p = await useApp.getState().createProject(name);
    if (p) {
      setSelId(p.id);
      setNewName("");
      setNaming(false);
    }
  };

  /** a folder from anywhere on this Mac becomes a project */
  const importFolder = async () => {
    try {
      const dir = await open({ directory: true, title: "팀으로 만들 폴더 고르기" });
      if (typeof dir !== "string") return;
      const p = await api.importProject(dir);
      await useApp.getState().loadProjects();
      setSelId(p.id);
    } catch (e) {
      useApp.getState().setError(e);
    }
  };

  const forget = async (p: Project) => {
    try {
      await api.forgetProject(p.id);
      await useApp.getState().loadProjects();
      setSelId(null);
    } catch (e) {
      useApp.getState().setError(e);
    }
  };

  const importButton = isRemote ? null : (
    <button
      type="button"
      onClick={() => void importFolder()}
      title="이미 있는 폴더를 팀으로 만들어요. 폴더는 옮기지 않아요"
      className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-transparent text-[13px] text-ink-2"
      style={{ border: "1px dashed color-mix(in srgb, var(--text) 25%, transparent)" }}
    >
      다른 위치의 폴더 가져오기
    </button>
  );

  const changeRoot = async () => {
    try {
      const dir = await open({ directory: true, defaultPath: root || undefined });
      if (typeof dir === "string") await useApp.getState().setRoot(dir);
    } catch (e) {
      useApp.getState().setError(e);
    }
  };

  const empty = projects.length === 0;
  const newProject = naming || empty ? (
    <motion.form
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
      className={`${empty ? "glass-soft" : "glass"} flex items-center gap-2 rounded-xl p-2 pl-4`}
    >
      <label className="flex min-w-0 flex-auto items-center gap-2">
        <span className="sr-only">새 프로젝트 이름</span>
        <input
          autoFocus={naming}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setNaming(false)}
          placeholder="프로젝트 이름 (예: 우리 쇼핑몰)"
          className="min-h-10 min-w-0 flex-auto border-0 bg-transparent text-[14px] outline-none"
        />
      </label>
      {!empty && (
        <button type="button" onClick={() => setNaming(false)} className="min-h-10 shrink-0 rounded-lg border-0 bg-transparent px-3 text-[13px] whitespace-nowrap text-ink-2">
          취소
        </button>
      )}
      <button type="submit" disabled={!newName.trim()} className="min-h-10 shrink-0 rounded-lg border-0 px-4 text-[13px] font-semibold whitespace-nowrap disabled:opacity-50" style={{ background: "var(--amber)", color: "#2b2520" }}>
        만들기
      </button>
    </motion.form>
  ) : (
    <button type="button" onClick={() => setNaming(true)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-transparent text-[13.5px] text-ink-2" style={{ border: "1px dashed color-mix(in srgb, var(--text) 25%, transparent)" }}>
      <Plus />
      새 프로젝트
    </button>
  );

  const pickPreset = async (preset: PresetName) => {
    if (!cur || cur.team.preset === preset) return;
    try {
      await api.setPreset(cur.id, preset);
      await useApp.getState().loadProjects();
    } catch (e) {
      useApp.getState().setError(e);
    }
  };

  const snap = cur ? teams[cur.id] : undefined;
  const live = !!snap && snap.agents.some((a) => a.status !== "off");

  const isLiveId = (id: string) => !!teams[id]?.agents.some((a) => a.status !== "off");
  const crew = picked.filter((id) => !isLiveId(id));
  const lastToStart = lastTeams.filter((id) => !isLiveId(id) && projects.some((p) => p.id === id));
  const offCount = projects.filter((p) => !isLiveId(p.id)).length;

  const depart = async () => {
    if (!cur || busy) return;
    const st = useApp.getState();
    if (crew.length > 1) {
      // several teams at once: each 총괄 joins the 관제탑 on the left
      setBusy(true);
      for (let i = 0; i < 3; i++) {
        setArriving(i);
        await new Promise((r) => setTimeout(r, 140));
      }
      for (const id of crew) await st.startTeam(id);
      setPicked([]);
      setBusy(false);
      setArriving(-1);
      return;
    }
    if (live) {
      await st.openProject(cur.id);
      st.go({ name: "main" });
      return;
    }
    setBusy(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      for (let i = 0; i < 3; i++) {
        setArriving(i);
        await new Promise((r) => setTimeout(r, 180));
      }
    }
    await st.startTeam(cur.id);
    setBusy(false);
    setArriving(-1);
  };

  const openSettings = async () => {
    if (!cur) return;
    await useApp.getState().openProject(cur.id);
    go({ name: "settings" });
  };

  const t = cur?.team;
  const rows = t
    ? [
        { role: "총괄", count: "1명", model: t.lead.model },
        { role: "팀장", count: `최대 ${t.managers.max}명`, model: t.managers.model },
        { role: "작업자", count: `최대 ${t.workers.max}명`, model: t.workers.model },
      ]
    : [];
  const planes = t
    ? [
        { z: 0, n: t.workers.max, lvl: 0 },
        { z: 50, n: t.managers.max, lvl: 1 },
        { z: 100, n: 1, lvl: 2 },
      ]
    : [];

  return (
    <div className="relative flex min-h-0 flex-auto flex-col overflow-y-auto overflow-x-hidden" style={{ color: "var(--text)" }}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute rounded-full" style={{ width: 560, height: 560, right: "8%", top: "10%", background: "radial-gradient(closest-side, var(--blob1), transparent)" }} />
        <div className="absolute rounded-full" style={{ width: 420, height: 420, left: -120, bottom: -160, background: "radial-gradient(closest-side, var(--blob2), transparent)" }} />
      </div>

      <div
        className={
          empty
            ? "relative mx-auto my-auto flex w-full max-w-[440px] flex-col px-8 py-10"
            : "relative mx-auto flex w-full max-w-[1180px] flex-wrap items-start gap-10 px-8 pt-10 pb-10"
        }
      >
        <section aria-labelledby="h-projects" className="flex min-w-0 flex-[1_1_340px] flex-col gap-[18px]">
          <div className={empty ? "flex flex-col items-center gap-1.5 text-center" : "flex flex-col gap-1.5"}>
            <span className="text-[13px] font-semibold tracking-[0.04em] text-ink-2">Prism</span>
            <h1 id="h-projects" className="m-0 text-[28px] leading-[1.3] font-semibold">
              {projects.length ? "오늘은 어느 팀을 출근시킬까요?" : "첫 팀을 꾸려볼까요?"}
            </h1>
            <span className="flex items-center gap-1.5 text-xs text-ink-2">
              <span className="font-mono">{root.replace(/^\/Users\/[^/]+/, "~")}</span>
              {!isRemote && (
                <button type="button" onClick={() => void changeRoot()} className="border-0 bg-transparent p-0 text-xs text-ink-2 underline underline-offset-2">
                  위치 변경
                </button>
              )}
            </span>
          </div>

          {projects.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="glass flex flex-col items-center gap-3 rounded-2xl px-6 pt-9 pb-6 text-center">
              <span className="glass-soft flex size-14 items-center justify-center rounded-2xl" style={{ color: "var(--amber)" }}>
                <Ic size={26}>
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </Ic>
              </span>
              <p className="m-0 text-[15px] font-semibold">첫 프로젝트를 만들어보세요</p>
              <p className="m-0 text-[13px] leading-[1.55] text-ink-2">
                이름만 정하면 작업 폴더는 알아서 준비하고,
                <br />
                총괄, 팀장, 작업자로 이뤄진 AI 팀이 출근해요.
              </p>
              <div className="mt-2 flex w-full flex-col gap-2 text-left">
                {newProject}
                {importButton}
              </div>
            </motion.div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={clockingIn || lastToStart.length === 0}
                  onClick={() => void useApp.getState().clockInLast()}
                  title={lastToStart.length ? "앱을 끄기 직전에 출근해 있던 팀을 한 번에 출근시켜요" : "다시 출근시킬 지난번 팀이 없어요"}
                  className="glass min-h-10 rounded-full border-0 px-4 text-[13px] font-medium disabled:opacity-50"
                >
                  지난번 팀 다시 출근{lastToStart.length ? ` (${lastToStart.length})` : ""}
                </button>
                <button
                  type="button"
                  disabled={clockingIn || offCount === 0}
                  onClick={() => void useApp.getState().clockInAll()}
                  title={offCount ? "아직 출근하지 않은 팀을 모두 출근시켜요" : "모든 팀이 이미 출근해 있어요"}
                  className="min-h-10 rounded-full border-0 px-4 text-[13px] font-semibold disabled:opacity-50"
                  style={{ background: "var(--amber)", color: "#2b2520" }}
                >
                  {clockingIn ? "출근시키는 중…" : "모두 출근"}
                </button>
              </div>
              {failures.length > 0 && (
                <div role="alert" className="glass-soft flex flex-col gap-1 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ border: "1px solid var(--block)" }}>
                  <span className="font-semibold">출근하지 못한 팀이 있어요</span>
                  {failures.map((f) => (
                    <span key={f.id}>
                      {f.name}: {f.reason}
                    </span>
                  ))}
                  <button type="button" onClick={() => useApp.getState().dismissFailures()} className="w-fit border-0 bg-transparent p-0 text-xs text-ink-2 underline underline-offset-2">
                    닫기
                  </button>
                </div>
              )}
              <AnimatePresence initial={false}>
                {projects.map((p) => {
                  const on = p.id === cur?.id;
                  return (
                    <motion.div key={p.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={spring} className="group relative">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSelId(p.id)}
                        className="glass flex w-full items-center gap-3.5 rounded-xl py-3.5 pr-14 pl-4 text-left"
                        style={{ outline: on ? "1.5px solid var(--navy)" : "none", outlineOffset: -1 }}
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl font-semibold" style={{ background: "var(--tile)" }}>
                          {p.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="flex min-w-0 flex-auto flex-col gap-0.5">
                          <span className="flex items-center gap-2 text-[15px] font-semibold">
                            {p.name}
                            {teams[p.id]?.agents.some((a) => a.status !== "off") && (
                              <span className="flex items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-medium" style={{ background: "var(--chip)", color: "var(--work-ink)" }}>
                                <span className="s-work size-1.5 rounded-full" style={{ background: "var(--work)" }} />
                                출근 중
                              </span>
                            )}
                          </span>
                          <span className="overflow-hidden font-mono text-xs text-ellipsis whitespace-nowrap text-ink-2">{p.path.replace(/^\/Users\/[^/]+/, "~")}</span>
                        </span>
                        <span className="shrink-0 text-xs text-ink-2">{ago(p.lastOpened)}</span>
                      </button>
                      {!isLiveId(p.id) && (
                        <button
                          type="button"
                          aria-pressed={picked.includes(p.id)}
                          aria-label={`${p.name} 함께 출근시키기`}
                          title="여러 팀을 골라 한 번에 출근시킬 수 있어요"
                          onClick={() => {
                            setSelId(p.id);
                            setPicked((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]));
                          }}
                          className="absolute top-1/2 right-3.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[13px] font-bold transition-colors"
                          style={
                            picked.includes(p.id)
                              ? { background: "var(--amber)", color: "#2b2520", border: "1.5px solid var(--amber)" }
                              : { background: "transparent", color: "transparent", border: "1.5px solid color-mix(in srgb, var(--text) 30%, transparent)" }
                          }
                        >
                          ✓
                        </button>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {projects.length > 1 && <span className="px-1 text-[12px] text-ink-2">오른쪽 동그라미를 눌러 여러 팀을 골라두면 한 번에 출근시킬 수 있어요.</span>}
              {newProject}
              {importButton}
            </div>
          )}
        </section>

        {cur && t && (
          <section aria-labelledby="h-team" className="glass flex min-w-0 flex-[1_1_460px] flex-col gap-[22px] rounded-[20px] p-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[12.5px] text-ink-2">{cur.name} · 팀 구성 미리보기</span>
                <h2 id="h-team" className="m-0 text-xl font-semibold">
                  {PRESET_TITLE[t.preset]}
                </h2>
              </div>
              <div role="group" aria-label="추천 설정" className="flex gap-0.5 rounded-full p-[3px]" style={{ background: "var(--glass2)", border: "1px solid var(--glass-border)" }}>
                {PRESETS.map((s) => {
                  const on = t.preset === s.id;
                  return (
                    <button key={s.id} type="button" aria-pressed={on} onClick={() => void pickPreset(s.id)} className="min-h-8 rounded-full border-0 px-3.5 text-[13px] font-medium" style={{ background: on ? "var(--amber)" : "transparent", color: on ? "#2b2520" : "var(--text)" }}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div aria-hidden="true" className="flex h-[200px] items-center justify-center" style={{ perspective: 1400 }}>
              <div className="relative size-[170px]" style={{ transformStyle: "preserve-3d", transform: "rotateX(55deg) rotateZ(-45deg) translateZ(-50px)" }}>
                {planes.map((pl) => (
                  <div key={pl.z} className="absolute inset-0 box-border flex flex-wrap content-center justify-center gap-1.5 rounded-xl p-4" style={{ background: "var(--plane)", border: "1px solid var(--plane-border)", boxShadow: "var(--plane-shadow)", transform: `translateZ(${pl.z}px)` }}>
                    {Array.from({ length: Math.max(1, pl.n) }, (_, i) => (
                      <motion.span
                        key={i}
                        className="size-[22px] rounded-md"
                        animate={arriving >= pl.lvl ? { scale: [1, 1.25, 1], backgroundColor: "rgba(232,161,90,0.95)" } : { scale: 1, backgroundColor: "rgba(255,255,255,0.85)" }}
                        transition={{ ...spring, delay: i * 0.02 }}
                        style={{ border: "1px solid var(--plane-border)", boxShadow: "0 3px 6px rgba(120,90,50,0.12)" }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {rows.map((r) => (
                <li key={r.role} className="flex items-center gap-3 rounded-xl px-3.5 py-2.5" style={{ background: "var(--glass2)" }}>
                  <span className="flex-auto font-medium">{r.role}</span>
                  <span className="text-[13px] text-ink-2">{r.count}</span>
                  <span className="min-w-16 rounded-full px-2.5 py-[3px] text-center font-mono text-xs" style={{ background: "var(--chip)" }}>
                    {modelLabel(r.model)}
                  </span>
                </li>
              ))}
            </ul>


            <div className="flex flex-wrap items-center gap-4">
              <div className="flex min-w-[200px] flex-[1_1_200px] flex-col gap-1.5 text-[13px] leading-[1.55] text-ink-2">
                {crew.length > 1 && (
                  <span className="font-semibold" style={{ color: "var(--text)" }}>
                    {crew.map((id) => projects.find((x) => x.id === id)?.name).join(", ")} 함께 출근
                  </span>
                )}
                <span>
                  {PRESET_NOTE[t.preset]}
                  <br />
                  동시에 최대 {t.concurrent}명까지 일해요
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void openSettings()} className="flex w-fit items-center gap-1 border-0 bg-transparent p-0 text-[12.5px] text-ink-2 underline underline-offset-2">
                    <Gear />팀 설정
                  </button>
                  {cur.linked && !live && (
                    <button type="button" onClick={() => void forget(cur)} title="목록에서만 빠져요. 폴더는 그대로예요" className="w-fit border-0 bg-transparent p-0 text-[12.5px] text-ink-2 underline underline-offset-2">
                      목록에서 빼기
                    </button>
                  )}
                </span>
                {cur.linked && !cur.isGit && (
                  <span className="text-[11.5px] leading-relaxed">처음 출근할 때 이 폴더에 변경 기록(git)을 만들어요. 그 뒤로 팀은 복사본에서 일해서 폴더 안 파일은 그대로예요.</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void depart()}
                disabled={busy}
                className="flex min-h-14 items-center gap-2.5 rounded-full border-0 px-7 text-[17px] font-semibold disabled:opacity-80"
                style={{ background: "var(--amber)", color: "#2b2520", boxShadow: "0 14px 30px rgba(232,161,90,0.45), inset 0 1px 0 rgba(255,255,255,0.5)" }}
              >
                <Play />
                {crew.length > 1 ? `${crew.length}팀 출근` : live ? "관제탑으로" : "팀 출근"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
