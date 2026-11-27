// 오래 켜 둔 앱 흉내 (scripts/shot.mjs --perf <횟수>).
// 가짜 백엔드가 실제 앱처럼 팀 스냅샷을 계속 보낸다 (WebSocket "team://snapshot", 실제 앱과 같은 경로):
// 대화·보고가 계속 쌓이고, 카드가 생기고 끝나고, 작업자가 들어오고 나간다. 중간중간 작업자 화면을
// 열었다 닫는다 (화면이 붙었다 떨어질 때 정리가 안 되는 것을 잡으려고).
// 일정 간격마다 메모리(가비지 정리 뒤)·화면 요소 수·이벤트 리스너 수·살아 있는 타이머 수와
// 스냅샷 하나를 그리는 데 든 시간을 잰다. 처음과 끝을 비교하면 무엇이 계속 늘어나는지 보인다.

/** 실제 백엔드가 UI에 보내는 개수 (src-tauri/src/team.rs SNAPSHOT_CHAT · SNAPSHOT_EVENTS · SNAPSHOT_DONE_TASKS) */
const CHAT_CAP = 100;
const EVENTS_CAP = 80;
const DONE_CAP = 30;

/** 페이지가 뜨기 전에: 살아 있는 타이머(setInterval·setTimeout)와 rAF 수를 세는 장치 */
export const PERF_INIT = () => {
  const live = new Set();
  const si = window.setInterval;
  const ci = window.clearInterval;
  window.setInterval = (...a) => {
    const id = si(...a);
    live.add(id);
    return id;
  };
  window.clearInterval = (id) => {
    live.delete(id);
    return ci(id);
  };
  window.__perfIntervals = () => live.size;
};

const LONG = (n) =>
  `## 결과 ${n}\n\n- 바꾼 파일: \`src/page${n % 7}.tsx\`, \`src/table${n % 5}.tsx\`\n- 확인: 화면을 열어 표가 잘 보이는지 봤어요.\n\n표 정렬과 색을 다듬었고, 좁은 화면에서도 줄이 넘치지 않게 했어요. **다음 단계**는 결제 모듈 연결이에요.`;

/** 스냅샷 하나를 시간에 따라 바꾸는 가짜 백엔드 */
function makeBackend(base, now0) {
  const snap = structuredClone(base);
  const lead = snap.agents.find((a) => a.role === "lead")?.id ?? "lead";
  const mgr = snap.agents.find((a) => a.role === "mgr")?.id ?? lead;
  let msgId = Math.max(0, ...snap.chat.map((m) => m.id));
  let taskNo = 100;
  let workerNo = 100;
  let total = snap.chat.length;
  const chatAll = [...snap.chat];
  return {
    get total() {
      return total;
    },
    tick(t) {
      const at = now0 + t * 400;
      // 대화: 매번 하나씩 (사람 지시 · 총괄 답 · 보고 번갈아)
      const kind = ["me", "lead", "report", "lead"][t % 4];
      const open = snap.tasks.filter((x) => x.stage !== "done");
      const ref = open[t % Math.max(1, open.length)]?.id;
      chatAll.push({ id: ++msgId, kind, text: kind === "me" ? `이것도 해 줘 ${t}` : LONG(t), taskIds: kind === "report" && ref ? [ref] : [], at, escalation: null, permission: null });
      total++;
      // 백엔드처럼 최근 100개만 (답을 기다리는 질문은 남는다)
      snap.chat = chatAll.slice(-CHAT_CAP);
      if (chatAll.length > CHAT_CAP * 2) chatAll.splice(0, chatAll.length - CHAT_CAP);
      // 기록
      snap.events = [{ at, text: `T-${taskNo} 진행 ${t}`, tone: null }, ...snap.events].slice(0, EVENTS_CAP);
      // 팀원 상태와 하는 일이 바뀐다
      for (const a of snap.agents) {
        if (a.status === "off" || a.status === "done") continue;
        if ((t + a.id.length) % 3 === 0) a.status = a.status === "work" ? "wait" : "work";
        a.statusSince = at;
        a.lastActive = at;
        a.activity = [{ at, text: `✏️ file${t % 9}.tsx 수정` }, ...(a.activity ?? [])].slice(0, 6);
        a.thought = `생각 중 ${t}`;
        a.costUsd += 0.001;
      }
      snap.costUsd += 0.003;
      // 카드: 3번에 하나 새로, 3번에 하나 끝남 (끝난 카드는 최근 30개만)
      if (t % 3 === 0) {
        const w = snap.agents.find((a) => a.role === "worker" && a.status !== "done" && a.status !== "off");
        snap.tasks.push({ ...structuredClone(base.tasks[0] ?? {}), id: `T-${++taskNo}`, title: `새 작업 ${taskNo}`, assignee: w?.id ?? mgr, stage: "running", requestedBy: mgr, createdAt: at, updatedAt: at, summary: null, followOf: null });
      }
      if (t % 3 === 1) {
        const o = snap.tasks.find((x) => x.stage === "running" && x.id.startsWith("T-1"));
        if (o) Object.assign(o, { stage: "done", updatedAt: at, summary: "끝냈어요." });
      }
      const done = snap.tasks.filter((x) => x.stage === "done").sort((a, b) => b.updatedAt - a.updatedAt);
      const keep = new Set(done.slice(0, DONE_CAP).map((x) => x.id));
      const refs = new Set(snap.chat.flatMap((m) => m.taskIds));
      snap.tasks = snap.tasks.filter((x) => x.stage !== "done" || keep.has(x.id) || refs.has(x.id));
      // 작업자: 20번마다 한 명이 끝나 나가고 새 작업자가 들어온다 (id가 계속 새로 생김)
      if (t % 20 === 0) {
        const old = snap.agents.find((a) => a.role === "worker" && a.id.startsWith("x"));
        if (old) snap.agents = snap.agents.filter((a) => a !== old);
        const tpl = snap.agents.find((a) => a.role === "worker") ?? snap.agents[0];
        snap.agents.push({ ...structuredClone(tpl), id: `x${++workerNo}`, name: `W${workerNo}`, status: "work", taskId: `T-${taskNo}`, parentId: mgr, restSince: null, stuck: null, startedAt: at, statusSince: at });
      }
      void lead;
      return snap;
    },
  };
}

async function measure(page, cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(50);
  const { metrics } = await cdp.send("Performance.getMetrics");
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const intervals = await page.evaluate(() => window.__perfIntervals?.() ?? -1);
  return { heapMB: m.JSHeapUsedSize / 1048576, nodes: m.Nodes, listeners: m.JSEventListeners, intervals, busy: (m.ScriptDuration + m.LayoutDuration + m.RecalcStyleDuration) * 1000 };
}

/**
 * ws: routeWebSocket으로 잡아 둔 앱 쪽 소켓. ticks번 스냅샷을 보내며 잰다.
 */
export async function runPerf(page, ws, o, data, log) {
  const pid = data.focus ?? Object.keys(data.teams)[0];
  const be = makeBackend(data.teams[pid], Date.now());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const send = (event, payload) => ws.send(JSON.stringify({ event, payload }));
  const rows = [];
  const every = Math.max(1, Math.floor(o.perf / 10));
  let mark = await measure(page, cdp);
  rows.push({ tick: 0, history: be.total, ...mark, msPerSnap: 0 });
  // PRISM_PERF_PROFILE=1: 마지막 구간에서 시간을 많이 쓴 함수 (자기 시간 기준) 상위 15개
  const profiling = !!process.env.PRISM_PERF_PROFILE;
  if (profiling) await cdp.send("Profiler.enable");
  const workerId = () => page.evaluate((pid) => window.__app.getState().teams[pid]?.agents.find((a) => a.role === "worker")?.id, pid);
  for (let t = 1; t <= o.perf; t++) {
    if (profiling && t === o.perf - every + 1) await cdp.send("Profiler.start");
    send("team://snapshot", be.tick(t));
    // 25번마다 작업자 화면을 열었다가 다음 번에 돌아온다
    if (t % 25 === 0) {
      const id = await workerId();
      if (id) await page.evaluate(({ pid, id }) => window.__app.setState({ projectId: pid, view: { name: "agent", id } }), { pid, id });
    } else if (t % 25 === 1 && t > 1) await page.evaluate(() => window.__app.setState({ view: { name: "main" } }));
    await page.waitForTimeout(o.perfGap);
    if (t % every === 0 || t === o.perf) {
      await page.evaluate(() => window.__app.setState({ view: { name: "main" } }));
      await page.waitForTimeout(200);
      const now = await measure(page, cdp);
      const span = t - rows[rows.length - 1].tick;
      rows.push({ tick: t, history: be.total, ...now, msPerSnap: (now.busy - mark.busy) / span });
      mark = now;
      log(`  ${String(t).padStart(5)}번째 · 대화 ${be.total}개 · 메모리 ${now.heapMB.toFixed(1)}MB · 화면 요소 ${now.nodes} · 리스너 ${now.listeners} · 타이머 ${now.intervals} · 스냅샷당 ${rows[rows.length - 1].msPerSnap.toFixed(1)}ms`);
    }
  }
  if (profiling) {
    const { profile } = await cdp.send("Profiler.stop");
    const dt = profile.timeDeltas;
    const self = new Map();
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => {
      const f = byId.get(id).callFrame;
      const k = `${f.functionName || "(익명)"} ${f.url.split("/").slice(-2).join("/").split("?")[0]}:${f.lineNumber + 1}`;
      self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000);
    });
    log("\n  시간을 많이 쓴 함수 (마지막 구간, ms):");
    for (const [k, ms] of [...self].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 15)) log(`    ${ms.toFixed(0).padStart(6)}  ${k}`);
  }
  const a = rows[1] ?? rows[0];
  const z = rows[rows.length - 1];
  const pct = (x, y) => (x ? `${(((y - x) / x) * 100).toFixed(0)}%` : "-");
  log(`\n  처음(${a.tick}번) → 끝(${z.tick}번): 메모리 ${a.heapMB.toFixed(1)} → ${z.heapMB.toFixed(1)}MB (${pct(a.heapMB, z.heapMB)}) · 화면 요소 ${a.nodes} → ${z.nodes} · 리스너 ${a.listeners} → ${z.listeners} · 타이머 ${a.intervals} → ${z.intervals} · 스냅샷당 ${a.msPerSnap.toFixed(1)} → ${z.msPerSnap.toFixed(1)}ms`);
  return rows;
}
