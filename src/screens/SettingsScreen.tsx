import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { isLive, useApp, useCurrent } from "../store";
import { api, type ModelInfo, type PresetName, type Provider, type RoleConfig, type StorageInfo, type TeamConfig } from "../lib/api";
import { EffortPicker, ModelPicker } from "../components/ModelPicker";
import { Bot, Briefcase, ChevronLeft, Tower } from "../components/icons";
import { useShallow } from "zustand/react/shallow";

const spring = { type: "spring" as const, stiffness: 300, damping: 30 };

const PRESETS: { id: Exclude<PresetName, "custom">; label: string; note: string; roles: [string, RoleConfig["effort"]][] }[] = [
  { id: "save", label: "절약", note: "가볍게 굴려요", roles: [["sonnet", "medium"], ["haiku", "low"], ["haiku", "low"]] },
  { id: "bal", label: "균형", note: "판단은 똑똑한 AI, 실행은 가벼운 AI", roles: [["opus", "high"], ["sonnet", "medium"], ["haiku", "medium"]] },
  { id: "power", label: "파워", note: "품질 최우선", roles: [["opus", "xhigh"], ["opus", "high"], ["sonnet", "high"]] },
];

type RoleKey = "lead" | "managers" | "workers";
const ROLES: { key: RoleKey; name: string; desc: string; Icon: typeof Tower }[] = [
  { key: "lead", name: "총괄", desc: "나와 대화하고 일을 나눠요", Icon: Tower },
  { key: "managers", name: "팀장", desc: "작업을 나누고 결과를 검토해 합쳐요", Icon: Briefcase },
  { key: "workers", name: "작업자", desc: "실제 작업을 하고 결과를 저장해요", Icon: Bot },
];

const PERMISSIONS: { id: TeamConfig["permissionMode"]; label: string; note: string; danger?: boolean }[] = [
  { id: "default", label: "매번 허락받기", note: "파일 수정도 허락받아요" },
  { id: "acceptEdits", label: "파일 수정은 알아서", note: "프로그램 실행만 허락받아요" },
  { id: "bypassPermissions", label: "전부 알아서", note: "허락 없이 다 실행해요 · 위험", danger: true },
];

const same = (a: TeamConfig, b: TeamConfig) => JSON.stringify(a) === JSON.stringify(b);

const AGENTS: { id: Provider; label: string; sub: string }[] = [
  { id: "claude", label: "Claude", sub: "Claude Code" },
  { id: "codex", label: "Codex", sub: "ChatGPT" },
  { id: "antigravity", label: "Gemini", sub: "Google" },
];
const DEFAULT_MODEL: Record<Provider, string> = { claude: "sonnet", codex: "", antigravity: "" };

/** Codex models come from the backend (Codex reads its own model cache). */
function useModels(provider: Provider) {
  const [list, setList] = useState<ModelInfo[]>([]);
  useEffect(() => {
    if (provider === "claude") return setList([]);
    let alive = true;
    api
      .models(provider)
      .then((m) => alive && setList(provider === "antigravity" ? [{ id: "", label: "기본", note: "Antigravity가 알아서 골라요", efforts: [] }, ...m] : m))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [provider]);
  return list;
}

function RoleAgent({ uid, role, onChange }: { uid: string; role: RoleConfig; onChange: (p: Partial<RoleConfig>) => void }) {
  const accounts = useApp((s) => s.accounts);
  const openAccounts = useApp((s) => s.openAccounts);
  const models = useModels(role.agent);
  const account = accounts.find((a) => a.provider === role.agent && a.active);
  const current = models.find((m) => m.id === role.model);

  const pick = (agent: Provider) => {
    if (agent === role.agent) return;
    onChange({ agent, model: DEFAULT_MODEL[agent], effort: agent === "antigravity" ? "" : role.effort || "medium" });
  };
  // Codex: once its list loads, make sure a real model is selected
  useEffect(() => {
    if (role.agent === "codex" && models.length && !models.some((m) => m.id === role.model)) onChange({ model: models[0].id });
  }, [role.agent, role.model, models, onChange]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="flex items-center justify-between text-[12px] font-medium text-ink-2">
          AI 프로그램
          {account && !account.status.loggedIn && (
            <button onClick={() => openAccounts(undefined, role.agent)} className="text-[11.5px] font-semibold underline" style={{ color: "var(--block-ink)" }}>
              로그인 필요
            </button>
          )}
        </span>
        <div role="radiogroup" aria-label="AI 프로그램" className="grid grid-cols-3 gap-0.5 rounded-xl p-[3px]" style={{ background: "var(--chip)" }}>
          {AGENTS.map((a) => {
            const on = a.id === role.agent;
            return (
              <button key={a.id} role="radio" aria-checked={on} onClick={() => pick(a.id)} className="relative flex min-h-10 flex-col items-center justify-center rounded-[9px] border-0 bg-transparent leading-tight" style={{ color: on ? "var(--text)" : "var(--text2)" }}>
                {on && <motion.span layoutId={`${uid}-agent`} transition={spring} className="absolute inset-0 rounded-[9px]" style={{ background: "var(--tile)", boxShadow: "0 2px 8px rgba(120,90,50,0.14), inset 0 1px 0 var(--glass-border)" }} />}
                <span className="relative text-[12.5px] font-semibold">{a.label}</span>
                <span className="relative text-[10.5px] opacity-70">{a.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-medium text-ink-2">AI 모델</span>
        {role.agent === "claude" ? (
          <ModelPicker uid={uid} value={role.model} onChange={(model) => onChange({ model })} />
        ) : (
          <div role="radiogroup" aria-label="AI 모델" className="flex max-h-[148px] flex-col gap-1 overflow-y-auto pr-1">
            {models.length === 0 && <span className="text-[12px] text-ink-2">AI 모델 목록을 불러오는 중… ({role.agent}가 이 컴퓨터에 설치돼 있어야 해요)</span>}
            {models.map((m) => {
              const on = m.id === role.model;
              return (
                <button key={m.id} role="radio" aria-checked={on} onClick={() => onChange({ model: m.id })} className="relative flex min-h-9 items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left" style={{ color: "var(--text)" }}>
                  {on && <motion.span layoutId={`${uid}-model`} transition={spring} className="absolute inset-0 rounded-lg" style={{ background: "var(--chip)", boxShadow: "inset 0 0 0 1.5px var(--amber)" }} />}
                  <span className="relative font-mono text-[12px] font-medium whitespace-nowrap">{m.label || m.id}</span>
                  <span className="relative min-w-0 truncate text-[11px] text-ink-2">{m.note}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {role.agent !== "antigravity" && (
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-ink-2">생각 깊이</span>
          <EffortPicker uid={uid} value={role.effort} onChange={(effort) => onChange({ effort })} />
          {role.agent === "codex" && current && current.efforts.length > 0 && !current.efforts.includes(role.effort) && role.effort && (
            <span className="text-[11px]" style={{ color: "var(--wait-ink)" }}>이 AI는 생각 깊이 {current.efforts.join(", ")}만 지원해요</span>
          )}
        </div>
      )}
    </>
  );
}

function Card({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`glass flex flex-col gap-3.5 rounded-2xl p-5 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-[13.5px] font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function fmtBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** how much disk the members' work folders take, and a button to clear the ones nobody needs */
function WorkCopies({ projectId }: { projectId: string }) {
  const [info, setInfo] = useState<StorageInfo | "error" | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setInfo(null);
    setNote(null);
    api.teamStorage(projectId).then(
      (s) => alive && setInfo(s),
      () => alive && setInfo("error"),
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  const clean = async () => {
    setBusy(true);
    try {
      const r = await api.teamCleanup(projectId);
      setNote(r.removed ? `${r.removed}개 지웠어요. ${fmtBytes(r.freedBytes)} 비웠어요.` : "지울 작업 폴더가 없어요.");
      setInfo(await api.teamStorage(projectId));
    } catch (e) {
      setNote(`정리하지 못했어요: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="작업 폴더 용량">
      {info === null && <span className="text-[12px] text-ink-2">용량을 재는 중…</span>}
      {info === "error" && <span className="text-[12px] text-ink-2">용량을 재지 못했어요.</span>}
      {info && info !== "error" && (
        <>
          <span className="text-[13.5px]">
            작업 폴더 {info.copies}개 · <b className="font-semibold">{fmtBytes(info.copiesBytes)}</b> · 공용 빌드 폴더 {fmtBytes(info.buildBytes)}
          </span>
          <span className="text-[12px] leading-relaxed text-ink-2">
            합쳐진 작업 폴더는 자동으로 지워요. 쉬는 작업자가 이어서 쓸 폴더는 남겨둬요. 합쳐지지 않은 건 끝난 뒤 7일이 지나면 정리 대상이 돼요. 브랜치는 지우지 않아요.
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[12.5px] text-ink-2">
              정리 대상 {info.reclaimable}개 · {fmtBytes(info.reclaimableBytes)}
            </span>
            <div className="flex-auto" />
            <button
              disabled={busy || info.reclaimable === 0}
              onClick={() => void clean()}
              className="glass-soft min-h-9 rounded-full px-4 text-[13px] disabled:opacity-40"
            >
              {busy ? "정리 중…" : "작업 폴더 정리"}
            </button>
          </div>
          {note && <span className="text-[12px] text-ink-2">{note}</span>}
        </>
      )}
    </Card>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  const btn = "flex size-8 items-center justify-center rounded-[10px] border-0 text-[15px] disabled:opacity-35";
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1 rounded-xl p-[3px]" style={{ background: "var(--chip)" }}>
      <button aria-label={`${label} 줄이기`} disabled={value <= min} onClick={() => onChange(value - 1)} className={btn} style={{ background: "var(--tile)" }}>
        −
      </button>
      <motion.span key={value} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="w-7 text-center font-mono text-[14px] font-medium">
        {value}
      </motion.span>
      <button aria-label={`${label} 늘리기`} disabled={value >= max} onClick={() => onChange(value + 1)} className={btn} style={{ background: "var(--tile)" }}>
        +
      </button>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative h-7 w-12 shrink-0 rounded-full border-0 p-0 transition-colors duration-200"
      style={{ background: on ? "var(--amber)" : "var(--chip)", boxShadow: "inset 0 0 0 1px var(--line)" }}
    >
      <motion.span
        layout
        transition={spring}
        className="absolute top-1 size-5 rounded-full"
        style={{ left: on ? 24 : 4, background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.18)" }}
      />
    </button>
  );
}

export function SettingsScreen() {
  const { project, team } = useCurrent();
  const { go, saveTeam } = useApp(useShallow((s) => ({ go: s.go, saveTeam: s.saveTeam })));
  const autoResume = useApp((s) => s.autoResume);
  const setAutoResume = useApp((s) => s.setAutoResume);
  const confirmQuit = useApp((s) => s.confirmQuit);
  const setConfirmQuit = useApp((s) => s.setConfirmQuit);
  const critters = useApp((s) => s.critters);
  const setCritters = useApp((s) => s.setCritters);
  const saved = project?.team;
  const [draft, setDraft] = useState<TeamConfig | undefined>(saved);

  useEffect(() => setDraft(saved), [saved]);

  if (!project || !draft || !saved) {
    return (
      <div className="m-auto flex flex-col items-center gap-3 text-ink-2">
        <span>열린 프로젝트가 없어요.</span>
        <button onClick={() => go({ name: "home" })} className="glass-soft min-h-9 rounded-full px-4 text-[13px]">
          홈으로
        </button>
      </div>
    );
  }

  const running = isLive(team);
  const dirty = !same(draft, saved);
  const setRole = (key: RoleKey, patch: Partial<RoleConfig>) =>
    setDraft((d) => d && { ...d, preset: "custom", [key]: { ...d[key], ...patch } });
  const applyPreset = (id: Exclude<PresetName, "custom">) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, preset: id };
      ROLES.forEach((r, i) => (next[r.key] = { ...d[r.key], agent: "claude", model: p.roles[i][0], effort: p.roles[i][1] }));
      return next;
    });
  };


  return (
    <div className="relative flex min-h-0 flex-auto flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-6 pt-5 pb-28">
        {/* header */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => go({ name: running ? "main" : "home" })}
            className="glass-soft flex min-h-9 items-center gap-1 rounded-full pr-3.5 pl-2.5 text-[13px]"
          >
            <ChevronLeft size={15} />
            {running ? "관제탑" : "홈"}
          </button>
          <div className="flex flex-col">
            <h1 className="m-0 text-[22px] leading-tight font-semibold">팀 설정</h1>
            <span className="text-[12.5px] text-ink-2">{project.name} · 저장하면 이후에 출근하는 AI부터 적용돼요</span>
          </div>
          <div className="flex-auto" />
          <div role="radiogroup" aria-label="추천 설정" className="glass flex gap-0.5 rounded-full p-1">
            {PRESETS.map((p) => {
              const on = draft.preset === p.id;
              return (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={on}
                  title={p.note}
                  onClick={() => applyPreset(p.id)}
                  className="relative min-h-9 rounded-full border-0 bg-transparent px-4 text-[13px] font-medium"
                  style={{ color: on ? "#2B2520" : "var(--text)" }}
                >
                  {on && <motion.span layoutId="preset-pill" transition={spring} className="absolute inset-0 rounded-full" style={{ background: "var(--amber)" }} />}
                  <span className="relative">{p.label}</span>
                </button>
              );
            })}
            <span className="relative flex min-h-9 items-center rounded-full px-3 text-[12px]" style={{ color: draft.preset === "custom" ? "var(--text)" : "var(--text2)", opacity: draft.preset === "custom" ? 1 : 0.5 }}>
              {draft.preset === "custom" && <motion.span layoutId="preset-pill" transition={spring} className="absolute inset-0 rounded-full" style={{ background: "var(--chip)" }} />}
              <span className="relative">직접 설정</span>
            </span>
          </div>
        </div>

        {/* role cards */}
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {ROLES.map(({ key, name, desc, Icon }, i) => {
            const r = draft[key];
            return (
              <motion.section
                key={key}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: i * 0.05 }}
                className="glass flex flex-col gap-4 rounded-2xl p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="glass-soft flex size-11 items-center justify-center rounded-[14px]">
                    <Icon size={20} />
                  </span>
                  <div className="flex flex-auto flex-col">
                    <span className="text-[15px] font-semibold">{name}</span>
                    <span className="text-[12px] text-ink-2">{desc}</span>
                  </div>
                  {key === "lead" ? (
                    <span className="rounded-full px-2.5 py-1 text-[12px] text-ink-2" style={{ background: "var(--chip)" }}>
                      1명
                    </span>
                  ) : (
                    <Stepper label={`${name} 최대 인원`} value={r.max} min={key === "managers" ? 0 : 1} max={12} onChange={(max) => setRole(key, { max })} />
                  )}
                </div>

                <RoleAgent uid={`set-${key}`} role={r} onChange={(patch) => setRole(key, patch)} />
              </motion.section>
            );
          })}
        </div>

        {/* limits & policy */}
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <Card title="동시에 일하는 인원" aside={<span className="font-mono text-[15px] font-semibold">{draft.concurrent}</span>}>
            <input
              type="range"
              min={1}
              max={16}
              value={draft.concurrent}
              onChange={(e) => setDraft({ ...draft, concurrent: Number(e.target.value) })}
              aria-label="동시에 일하는 인원 상한"
              className="w-full"
              style={{ accentColor: "var(--amber)" }}
            />
            <span className="text-[12px] leading-relaxed text-ink-2">팀장·작업자가 한 번에 이만큼까지 돌아요. 넘치면 순서를 기다려요.</span>
          </Card>


          <Card title="원래 폴더 지키기" aside={<Switch on={draft.safe} onChange={(safe) => setDraft({ ...draft, safe })} label="원래 폴더 지키기" />}>
            <span className="text-[12px] leading-relaxed text-ink-2">
              {draft.safe
                ? "팀은 프로젝트를 복사한 작업 공간에서 팀 전용 브랜치로 일해요. 원래 폴더는 그대로고, 결과는 총괄에게 \"PR 올려줘\"라고 하면 PR로 보내요. 기존 프로젝트를 가져왔다면 켜두세요."
                : "팀이 원래 폴더에서 바로 일하고, 결과도 바로 합쳐져요. 처음부터 Prism으로 만든 프로젝트처럼 부담 없는 경우에만 꺼두세요."}
            </span>
          </Card>

          <Card title="작업 공간 분리" aside={<Switch on={draft.isolate} onChange={(isolate) => setDraft({ ...draft, isolate })} label="작업 공간 분리" />}>
            <span className="text-[12px] leading-relaxed text-ink-2">
              팀장과 작업자가 각자 따로 복사한 작업 공간에서 일하고, 끝나면 윗선이 검토해서 합쳐요. 끄면 같은 폴더를 함께 써서 서로 덮어쓸 수 있어요.
            </span>
          </Card>
        </div>

        <Card title="앱을 켜면 지난번 팀 자동 출근" aside={<Switch on={autoResume} onChange={(on) => void setAutoResume(on)} label="앱을 켜면 지난번에 일하던 팀 자동 출근" />}>
          <span className="text-[12px] leading-relaxed text-ink-2">
            앱을 끌 때 출근해 있던 팀들이 앱을 켜면 알아서 다시 출근해요. 모든 팀에 적용되는 설정이고, 팀은 하던 일을 이어서 해요.
          </span>
        </Card>

        <Card title="창을 닫거나 앱을 끌 때 한 번 물어보기" aside={<Switch on={confirmQuit} onChange={(on) => void setConfirmQuit(on)} label="창을 닫거나 앱을 끌 때 한 번 물어보기" />}>
          <span className="text-[12px] leading-relaxed text-ink-2">
            팀원이 일하는 중에 창을 닫거나(Cmd+W) 앱을 끄면(Cmd+Q) 먼저 물어봐요. 끄면 묻지 않고 바로 꺼요. 일하는 팀원이 없을 때와 업데이트로 다시 켤 때는 묻지 않아요.
          </span>
        </Card>

        <WorkCopies projectId={project.id} />

        <Card title="캐릭터 보기" aside={<Switch on={critters} onChange={setCritters} label="팀원 캐릭터 보기" />}>
          <span className="text-[12px] leading-relaxed text-ink-2">
            팀원들을 동글동글한 캐릭터로 보여줘요. 앱 화면 곳곳을 돌아다니며 자기 일이 있는 곳(작업 보드, 보고, 허락 요청, 편집 화면)으로 걸어가요. 이 기기에만 적용되고, 기기에서 &lsquo;동작 줄이기&rsquo;를 켜두면 움직임은 멈춰요.
          </span>
        </Card>

        <Card title="허락 방식">
          <div role="radiogroup" aria-label="허락 방식" className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            {PERMISSIONS.map((p) => {
              const on = draft.permissionMode === p.id;
              const tint = p.danger ? "var(--block)" : "var(--navy)";
              return (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={on}
                  onClick={() => setDraft({ ...draft, permissionMode: p.id })}
                  className="relative flex flex-col items-start gap-0.5 rounded-xl px-4 py-3 text-left transition-colors"
                  style={{
                    background: on ? (p.danger ? "var(--block-bg)" : "var(--glass2)") : "transparent",
                    border: `1.5px solid ${on ? tint : "var(--line)"}`,
                  }}
                >
                  <span className="text-[13.5px] font-semibold" style={{ color: on && p.danger ? "var(--block-ink)" : "var(--text)" }}>
                    {p.label}
                  </span>
                  <span className="text-[12px] text-ink-2">{p.note}</span>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      {/* floating save bar */}
      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={spring}
            className="glass fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100%-24px)] -translate-x-1/2 max-[820px]:bottom-[max(0.75rem,env(safe-area-inset-bottom))] items-center gap-3 rounded-full py-2 pr-2 pl-5"
          >
            <span className="size-2 rounded-full" style={{ background: "var(--amber)" }} />
            <span className="text-[13px] whitespace-nowrap">저장하지 않은 변경이 있어요</span>
            <button onClick={() => setDraft(saved)} className="min-h-9 rounded-full border-0 bg-transparent px-3.5 text-[13px] whitespace-nowrap text-ink-2">
              되돌리기
            </button>
            <button
              onClick={() => void saveTeam(draft)}
              className="min-h-9 rounded-full border-0 px-5 text-[13px] font-semibold whitespace-nowrap"
              style={{ background: "var(--amber)", color: "#2B2520", boxShadow: "0 8px 20px rgba(232,161,90,0.4)" }}
            >
              저장
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
