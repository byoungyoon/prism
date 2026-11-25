#!/usr/bin/env node
// 화면 캡처 도구 (팀원용). 실제 앱 스타일(Tailwind 포함)로 vite 개발 서버를 띄우고, 가짜 팀 데이터를
// 넣어 화면을 PNG로 찍는다. 끝나면 서버와 브라우저를 모두 닫는다.
//
//   pnpm shot                                  기본: 데모 시나리오 · 사무실 · 1440폭 · 밝은 테마
//   pnpm shot -- -s demo --screen office,board --width 390 --theme dark
//   pnpm shot -- --screen office --frames 6 --interval 300      연속 캡처 (애니메이션 확인)
//   pnpm shot -- --list                        시나리오와 화면 목록
//
// 브라우저는 Playwright 전용 Chromium을 쓴다 (시스템 크롬 미사용 → 사용자 크롬과 충돌·복사본 없음).
// 처음 한 번만 Chromium을 내려받는다.

import { createServer } from "vite";
import { chromium } from "playwright-core";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScenario, SCENARIO_NAMES } from "./shot/scenarios.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 화면 이름 → 앱을 그 화면으로 여는 방법. narrow = 폭 820 이하(휴대폰 탭 구조). */
const SCREENS = {
  office: "사무실 (관제탑 가운데: 팀 요약 탭 + 사무실)",
  team: "팀 탭 (팀 하나의 보고 목록)",
  board: "작업 보드 (오른쪽 카드 칸)",
  chat: "총괄 채팅 (왼쪽)",
  edit: "편집 (파일 편집 화면, 엔진이 없으면 설치 안내)",
  home: "홈 (프로젝트 목록)",
  settings: "팀 설정",
};

const HELP = `사용법: pnpm shot -- [옵션]

  -s, --scenario <이름>   시나리오 (기본 demo). --list 로 목록 확인
  --screen <목록>         화면, 쉼표로 여러 개 가능 (기본 office). ${Object.keys(SCREENS).join(" | ")}
  -w, --width <px>        창 폭 (기본 1440). 1440 · 1100 · 390 등
  --height <px>           창 높이 (기본 900)
  --theme <light|dark>    테마 (기본 light)
  --frames <n>            연속 캡처 장수 (기본 1)
  --interval <ms>         연속 캡처 간격 (기본 350)
  --wait <ms>             화면이 뜬 뒤 기다리는 시간 (기본 1000)
  --scale <n>             화면 배율 (기본 2 = 레티나)
  --out <폴더>            저장 폴더 (기본 shots/, 저장소에 안 올라감)
  --name <이름>           파일 이름 앞부분 (기본 시나리오-화면-폭-테마)
  --list                  시나리오·화면 목록을 보여주고 끝냄
  -h, --help              이 도움말`;

function parseArgs(argv) {
  const o = {
    scenario: "demo",
    screen: "office",
    width: 1440,
    height: 900,
    theme: "light",
    frames: 1,
    interval: 350,
    wait: 1000,
    scale: 2,
    out: path.join(ROOT, "shots"),
    name: "",
    list: false,
    help: false,
  };
  const map = { "-s": "scenario", "--scenario": "scenario", "-w": "width", "--width": "width", "--height": "height", "--theme": "theme", "--frames": "frames", "--interval": "interval", "--wait": "wait", "--scale": "scale", "--out": "out", "--screen": "screen", "--name": "name" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--list") o.list = true;
    else if (a === "--") continue;
    else if (map[a]) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} 뒤에 값이 필요해요`);
      o[map[a]] = v;
    } else throw new Error(`모르는 옵션: ${a}\n\n${HELP}`);
  }
  for (const k of ["width", "height", "frames", "interval", "wait", "scale"]) o[k] = Number(o[k]);
  if (![o.width, o.height, o.frames, o.scale].every((n) => Number.isFinite(n) && n > 0)) throw new Error("폭·높이·장수·배율은 0보다 큰 숫자여야 해요");
  o.screens = o.screen.split(",").map((s) => s.trim()).filter(Boolean);
  return o;
}

function validate(o) {
  if (!SCENARIO_NAMES().includes(o.scenario)) throw new Error(`알 수 없는 시나리오 "${o.scenario}" (목록: pnpm shot -- --list)`);
  for (const s of o.screens) if (!SCREENS[s]) throw new Error(`알 수 없는 화면 "${s}" (사용 가능: ${Object.keys(SCREENS).join(", ")})`);
  if (!["light", "dark"].includes(o.theme)) throw new Error('--theme 은 "light" 또는 "dark"');
}

/** 비어 있는 포트 하나. 개발 서버가 다른 실행과 겹치지 않게 매번 새로 고른다. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Playwright 전용 Chromium을 띄운다. 없으면 한 번만 내려받는다 (시스템 크롬은 쓰지 않는다). */
async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (e) {
    if (!/Executable doesn't exist|playwright install/i.test(String(e))) throw e;
    console.log("Playwright용 Chromium이 없어서 한 번만 내려받을게요…");
    const cli = path.join(ROOT, "node_modules", "playwright-core", "cli.js");
    const r = spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("Chromium 설치에 실패했어요. 인터넷 연결을 확인해 주세요.");
    return chromium.launch({ headless: true });
  }
}

/** /api/<명령> 요청에 가짜 팀 데이터로 답한다. 실제 백엔드(Tauri/원격 서버) 없이도 화면이 채워진다. */
function fakeApi(cmd, args, data) {
  switch (cmd) {
    case "projects_list":
      return data.projects;
    case "team_get":
      return data.teams[args.projectId] ?? null;
    case "workspace_root":
      return "/tmp";
    case "accounts_list":
    case "batch_list":
    case "usage_get":
    case "models_list":
    case "cli_status":
    case "task_files":
    case "task_engine_files":
      return [];
    case "knowledge_get":
      return "";
    default:
      return null;
  }
}

/** 화면마다 앱을 여는 동작. 새로 열 때마다 호출된다 (이전 화면의 탭 선택 등이 남지 않게). */
async function openScreen(page, screen, o, data) {
  const narrow = o.width <= 820;
  const phoneTab = (label) => page.getByRole("tablist", { name: "화면" }).getByRole("tab", { name: label, exact: true });
  const focus = data.focus;
  await page.evaluate(
    ({ screen, focus, dark, edit }) => {
      const app = window.__app;
      const set = { dark, critters: true, error: null };
      if (screen === "home") set.view = { name: "home" };
      else if (screen === "settings") Object.assign(set, { view: { name: "settings" }, projectId: focus });
      else Object.assign(set, { view: { name: "main" }, projectId: focus ?? app.getState().projectId });
      app.setState(set);
      if (screen === "edit" && edit) window.__openEdit(edit.projectId, edit.taskId, edit.path);
    },
    { screen, focus, dark: o.theme === "dark", edit: data.edit },
  );
  await page.waitForTimeout(150);
  if (narrow) {
    if (screen === "office" || screen === "team") await phoneTab("사무실").click();
    if (screen === "board") await phoneTab("보드").click();
    if (screen === "chat") await phoneTab("총괄").click();
  }
  if (screen === "team") {
    // 팀 요약 탭 줄에서 첫 번째 팀 (0번은 🏢 사무실)
    await page.getByRole("tablist", { name: "팀 요약" }).getByRole("tab").nth(1).click();
  }
}

async function capture(browser, base, o, data, log) {
  const errors = [];
  const saved = [];
  const phone = o.width <= 500;
  for (const screen of o.screens) {
    const ctx = await browser.newContext({
      viewport: { width: o.width, height: o.height },
      deviceScaleFactor: o.scale,
      isMobile: phone,
      hasTouch: phone,
      colorScheme: o.theme === "dark" ? "dark" : "light",
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`[${screen}] ${e.message}`));
    await page.route("**/api/**", (route) => {
      const cmd = new URL(route.request().url()).pathname.replace(/^\/api\//, "");
      const args = JSON.parse(route.request().postData() || "{}");
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeApi(cmd, args, data) ?? null) });
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    // 팀 목록이 가짜 데이터로 채워질 때까지 기다린다 (앱이 시작하면서 불러온다)
    await page.waitForFunction((n) => !!window.__app && Object.keys(window.__app.getState().teams).length >= n, Object.keys(data.teams).length, { timeout: 30000 });
    await openScreen(page, screen, o, data);
    await page.waitForTimeout(o.wait);

    const stem = `${o.name || o.scenario}-${screen}-${o.width}-${o.theme}`;
    for (let i = 0; i < o.frames; i++) {
      if (i > 0) await page.waitForTimeout(o.interval);
      // 백엔드 연결 배지("다시 연결 중…")는 가짜 데이터라 항상 뜬다. 화면에서만 치운다
      await page.evaluate(() => document.querySelectorAll('[role="status"]').forEach((el) => el.textContent?.includes("다시 연결") && el.remove()));
      const suffix = o.frames > 1 ? `-${String(i + 1).padStart(2, "0")}` : "";
      const file = path.join(o.out, `${stem}${suffix}.png`);
      await page.screenshot({ path: file, animations: "allow", timeout: 60000 });
      saved.push(file);
    }
    log(`✓ ${screen}: ${o.frames}장`);
    await ctx.close();
  }
  return { saved, errors };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) return console.log(HELP);
  if (o.list) {
    console.log("시나리오:");
    for (const s of SCENARIO_NAMES()) console.log(`  ${s}`);
    console.log("\n화면:");
    for (const [k, v] of Object.entries(SCREENS)) console.log(`  ${k.padEnd(9)} ${v}`);
    return;
  }
  validate(o);
  const data = buildScenario(o.scenario);
  fs.mkdirSync(o.out, { recursive: true });

  const port = await freePort();
  const log = (m) => console.log(m);
  let server;
  let browser;
  let stopping = false;
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  };
  process.on("SIGINT", () => void cleanup().then(() => process.exit(130)));
  process.on("SIGTERM", () => void cleanup().then(() => process.exit(143)));

  try {
    server = await createServer({
      root: ROOT,
      configFile: path.join(ROOT, "vite.config.ts"),
      logLevel: "error",
      clearScreen: false,
      server: { host: "127.0.0.1", port, strictPort: true, hmr: false },
    });
    await server.listen();
    const base = `http://127.0.0.1:${port}/`;
    browser = await launchBrowser();
    const { saved, errors } = await capture(browser, base, o, data, log);
    console.log(`\n저장 ${saved.length}장:`);
    for (const f of saved) console.log(`  ${f}`);
    if (errors.length) {
      console.log(`\n⚠ 화면에서 오류 ${errors.length}건:`);
      for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
    }
  } finally {
    await cleanup();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`화면 캡처 실패: ${e.message}`);
    process.exit(1);
  },
);
