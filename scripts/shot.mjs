#!/usr/bin/env node
// 화면 캡처 도구 (팀원용). 실제 앱 스타일(Tailwind 포함)로 vite 개발 서버를 띄우고, 가짜 팀 데이터를
// 넣어 화면을 PNG로 찍는다. 끝나면 서버와 브라우저를 모두 닫는다.
//
//   (pnpm 이 안 되는 환경이면 `node scripts/shot.mjs ...` 로 똑같이 쓴다)
//   pnpm shot                                  기본: 데모 시나리오 · 사무실 · 1440폭 · 밝은 테마
//   pnpm shot -- -s demo --screen office,board --width 390 --theme dark
//   pnpm shot -- --screen office --frames 6 --interval 300      연속 캡처 (애니메이션 확인)
//   pnpm shot -- --list                        시나리오와 화면 목록
//
// 브라우저는 Playwright 전용 Chromium을 쓴다 (시스템 크롬 미사용 → 사용자 크롬과 충돌·복사본 없음).
// 처음 한 번만 Chromium을 내려받는다.

import { createServer } from "vite";
import os from "node:os";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScenario, SCENARIO_NAMES, GACHA_INFO, dashMock } from "./shot/scenarios.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** playwright-core 폴더. node_modules에 없으면(작업 폴더의 공유 node_modules 등) npx 캐시에서 찾는다. */
function findPlaywrightDir() {
  const req = createRequire(import.meta.url);
  try {
    return path.dirname(req.resolve("playwright-core/package.json"));
  } catch {}
  const npx = path.join(os.homedir(), ".npm", "_npx");
  try {
    for (const h of fs.readdirSync(npx)) {
      const d = path.join(npx, h, "node_modules", "playwright-core");
      if (fs.existsSync(path.join(d, "package.json"))) return d;
    }
  } catch {}
  throw new Error("playwright-core를 찾지 못했어요. `npx -y playwright-core --version` 을 한 번 실행해 캐시에 받아 두고 다시 시도해 주세요. (pnpm install 은 하지 않아요)");
}
const PW_DIR = findPlaywrightDir();
const { chromium } = createRequire(import.meta.url)(PW_DIR);

/** 화면 이름 → 앱을 그 화면으로 여는 방법. narrow = 폭 820 이하(휴대폰 탭 구조). */
const SCREENS = {
  office: "사무실 (관제탑 가운데: 팀 요약 탭 + 사무실)",
  team: "팀 탭 (팀 하나의 보고 목록)",
  board: "작업 보드 (오른쪽 카드 칸)",
  chat: "총괄 채팅 (왼쪽)",
  edit: "편집 (파일 편집 화면, 엔진이 없으면 설치 안내)",
  home: "홈 (프로젝트 목록)",
  settings: "팀 설정",
  shop: "츄르 상점 (관제탑에서 츄르 잔액 버튼을 눌러 연 상태)",
  "shop-cats": "상점 고양이 탭: 뽑기 버튼·확률표·보유 목록 (일부만 보유; -s gacha)",
  "shop-poor": "상점 고양이 탭: 츄르가 모자라 뽑기 버튼이 막힌 상태 (-s gacha-poor)",
  "shop-roll": "뽑기 연출 중: 상자가 흔들리는 순간 (-s gacha --wait 300)",
  "shop-new": "뽑기 결과: 새 고양이 (-s gacha --wait 2600)",
  "shop-dup": "뽑기 결과: 이미 가진 고양이 (-s gacha-dup --wait 2600)",
  "shop-earn": "상점 '츄르 받는 법' 탭",
  reward: "츄르를 받은 순간: 잔액 옆에 '+N 출석' 표시",
  arrange: "꾸민 휴게실: 소품 몇 개를 마우스로 끌어다 옮긴 모습",
  lift: "휴게실: 쉬던 고양이를 들어 올린 모습 (잡고 있는 상태)",
  "coat-menu": "휴게실 고양이를 우클릭해 털색 메뉴를 띄운 모습",
  "coat-done": "털색 메뉴에서 다른 색을 고른 뒤의 모습",
  dashboard: "대시보드 탭 (-s dash-empty · dash-multi · dash-ai 로 상태를 고른다)",
  account: "계정 화면 (맨 아래에 지금 버전 표시)",
  "account-end": "계정 화면을 맨 아래까지 내린 모습",
  "install-old": "안내: 예전 Prism이 아직 켜져 있음",
  "install-newer": "안내: 지금 연 것이 예전 버전 (새 버전이 이미 켜져 있음)",
  "install-open": "안내: 다운로드 폴더의 예전 복사본을 열었음",
  "install-move": "안내: 설치 파일(DMG) 안에서 켜져 응용 프로그램 폴더로 옮기기",
  "install-replaced": "안내: 켜 둔 사이에 새 버전이 설치됨",
  draft: "대시보드 설명으로 만들기: 설명을 적고 '초안 만들기' 뒤 미리보기 (-s dash-draft)",
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
    const cli = path.join(PW_DIR, "cli.js");
    const r = spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("Chromium 설치에 실패했어요. 인터넷 연결을 확인해 주세요.");
    return chromium.launch({ headless: true });
  }
}

/** install-* 화면에서 백엔드(install_check)가 돌려줄 값 */
const INSTALL_ISSUES = {
  "install-old": { kind: "oldRunning", version: "0.3.9", other: "0.3.7", place: null },
  "install-newer": { kind: "newerRunning", version: "0.3.7", other: "0.3.9", place: "다운로드 폴더" },
  "install-open": { kind: "openInstalled", version: "0.3.7", other: "0.3.9", place: "다운로드 폴더" },
  "install-move": { kind: "move", version: "0.3.9", other: "0.3.7", place: "설치 파일(DMG) 안" },
  "install-replaced": { kind: "replaced", version: "0.3.8", other: "0.3.9", place: null },
};

/** /api/<명령> 요청에 가짜 팀 데이터로 답한다. 실제 백엔드(Tauri/원격 서버) 없이도 화면이 채워진다. */
function fakeApi(cmd, args, data) {
  // 대시보드 명령(웹·엑셀·슬랙·AI 보기·설계도)은 시나리오의 대시보드 목 데이터로 답한다
  if (/^(dashboard_|sheet_|web_|slack_|ai_)/.test(cmd)) return dashMock(data.dash, cmd, args);
  switch (cmd) {
    case "projects_list":
      return data.projects;
    case "team_get":
      return data.teams[args.projectId] ?? null;
    case "workspace_root":
      return "/tmp";
    case "prefs_get":
      return data.prefs;
    case "install_check":
      return data.install ?? null;
    case "prefs_set_coat": {
      const coats = { ...data.prefs.coats };
      if (args.coat) coats[args.member] = args.coat;
      else delete coats[args.member];
      data.prefs = { ...data.prefs, coats };
      return data.prefs;
    }
    case "gacha_info":
      return GACHA_INFO;
    case "gacha_pull": {
      // 실제 뽑기 규칙을 흉내 낸다: 다 모았으면 거절, 잔액이 모자라면 거절, 아니면 250츄르 차감 (중복 환급 없음)
      const p = data.prefs;
      const owned = GACHA_INFO.cats.every((c) => p.owned.includes(`cat:${c.id}`));
      if (owned) throw new Error("고양이를 모두 모았어요. 더 뽑을 고양이가 없어요");
      if (p.churu < GACHA_INFO.price) throw new Error(`츄르가 ${GACHA_INFO.price - p.churu}개 모자라요 (뽑기 ${GACHA_INFO.price}츄르, 있는 츄르 ${p.churu}개)`);
      const cat = data.gachaNext ?? "cat:calico";
      const isNew = !p.owned.includes(cat);
      data.prefs = { ...p, churu: p.churu - GACHA_INFO.price, owned: isNew ? [...p.owned, cat] : p.owned };
      return { cat, isNew, prefs: data.prefs };
    }
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

/** 휴게실 시연 1: 소품을 끌어다 옮긴다 (휴게실 안의 정해 둔 자리로, 화면 비율로) */
async function arrangeLounge(page) {
  const lounge = await page.locator(".of-lounge").first().boundingBox();
  if (!lounge) return;
  const plan = [
    ["소파", 0.2, 0.66],
    ["캣타워", 0.13, 0.4],
    ["숨숨집", 0.82, 0.5],
  ];
  for (const [name, fx, fy] of plan) {
    const box = await page.locator(`[data-piece="${name}"]`).first().boundingBox();
    if (!box) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(lounge.x + fx * lounge.width, lounge.y + fy * lounge.height, { steps: 12 });
    await page.mouse.up();
  }
}

/** 휴게실 시연 2: 쉬던 고양이를 마우스로 집어 든 채로 둔다 (버튼을 떼지 않아 들려 있는 모습이 남는다) */
async function liftLoungeCat(page) {
  // 고양이는 .of-cats에 있어서 휴게실 박스 안에 중심이 드는 쉬는 고양이만 고른다 (벽 쪽 고양이를 잡지 않게)
  const lounge = await page.locator(".of-lounge").first().boundingBox();
  if (!lounge) return;
  const lounging = page.locator(".of-cats .cr-mover").filter({ has: page.locator(".cr-pose-coffee, .cr-pose-sit, .cr-pose-sleep") });
  await lounging.first().waitFor({ timeout: 15000 }).catch(() => {});
  let body = null;
  for (let i = 0; i < (await lounging.count()); i++) {
    const b = await lounging.nth(i).locator(".critter").boundingBox().catch(() => null);
    if (!b) continue;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    if (cx > lounge.x && cx < lounge.x + lounge.width && cy > lounge.y && cy < lounge.y + lounge.height) {
      body = b;
      break;
    }
  }
  if (!body) return;
  const x = body.x + body.width / 2;
  const y = body.y + body.height * 0.6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 90, { steps: 14 });
}

/** 털색 메뉴 시연: 휴게실에서 쉬는 고양이 하나를 (없으면 아무 고양이나) 우클릭한다 */
async function rightClickCat(page) {
  const cats = page.locator(".of-cats .cr-mover .critter[data-coat-key]");
  await cats.first().waitFor({ timeout: 15000 });
  // 걸어가는 중이면 자리가 바뀌니 앉을 때까지 기다린다
  await page.waitForTimeout(2500);
  const resting = page.locator(".of-cats .critter[data-coat-key].cr-pose-coffee, .of-cats .critter[data-coat-key].cr-pose-sit, .of-cats .critter[data-coat-key].cr-pose-sleep");
  const box = await ((await resting.count()) ? resting : cats).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.65, { button: "right" });
  await page.getByRole("menu").waitFor({ timeout: 5000 });
}

/** 화면마다 앱을 여는 동작. 새로 열 때마다 호출된다 (이전 화면의 탭 선택 등이 남지 않게). */
async function openScreen(page, screen, o, data) {
  const narrow = o.width <= 820;
  const phoneTab = (label) => page.getByRole("tablist", { name: "화면" }).getByRole("tab", { name: new RegExp(`^${label}(\\s*\\d+)?$`) }); // "사무실 1": a badge may follow
  const focus = data.focus;
  await page.evaluate(
    ({ screen, focus, dark, edit }) => {
      const app = window.__app;
      const set = { dark, critters: true, error: null, mainTab: screen === "dashboard" || screen === "draft" ? "dashboard" : "office" };
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
  if (screen.startsWith("account")) {
    await page.evaluate(() => window.__app.getState().openAccounts());
    await page.getByRole("dialog", { name: "계정" }).waitFor();
    if (screen === "account-end") await page.getByRole("dialog", { name: "계정" }).evaluate((el) => (el.scrollTop = el.scrollHeight));
  }
  if (screen.startsWith("install-")) await page.getByRole("alertdialog").waitFor({ timeout: 15000 });
  if (screen === "arrange" || screen === "lift") {
    if (narrow) await phoneTab("사무실").click();
    await page.locator(".of-lounge [data-piece]").first().waitFor({ timeout: 15000 }).catch(() => {});
    if (screen === "arrange") await arrangeLounge(page);
    else await liftLoungeCat(page);
  }
  if (screen.startsWith("coat-")) {
    if (narrow) await phoneTab("사무실").click();
    await rightClickCat(page);
    if (screen === "coat-done") {
      // 지금 색이 아닌 것 중 마지막 털색을 고른다
      const other = page.getByRole("menu").locator('[role="menuitemradio"][aria-checked="false"]');
      if (await other.count()) await other.last().click();
    }
  }
  if (screen.startsWith("shop")) {
    await page.getByRole("button", { name: /츄르 상점/ }).click();
    // 뽑기 연출: 버튼을 누른 뒤 --wait 만큼 기다렸다 찍는다 (흔들리는 중은 짧게, 결과는 연출이 끝난 뒤)
    if (screen === "shop-earn") await page.getByRole("tab", { name: "츄르 받는 법" }).click();
    if (["shop-roll", "shop-new", "shop-dup"].includes(screen)) await page.getByRole("button", { name: /고양이 뽑기/ }).click();
  }
  if (screen === "reward") await page.evaluate(() => window.__app.getState().showReward({ kind: "attend", amount: 80, streak: 7 }));
  if (screen === "draft") {
    // 빈 대시보드에 할 일을 적고 초안을 만든 뒤, 미리보기가 뜰 때까지 기다린다
    await page.getByLabel("하는 일을 설명해 주세요").fill("고객 문의 엑셀에서 답 안 단 문의만 보고, 슬랙 고객센터 채널도 같이 보고 싶어요");
    await page.getByRole("button", { name: "초안 만들기" }).click();
    await page.getByText("이렇게 만들어 볼까요?").waitFor({ timeout: 15000 });
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
      // 실제 백엔드처럼 Err는 400과 한국어 문장으로 돌려준다 (transport.call이 Error로 바꾼다)
      try {
        const shown = { ...data, install: INSTALL_ISSUES[screen] };
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fakeApi(cmd, args, cmd === "install_check" ? shown : data) ?? null) });
      } catch (e) {
        route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify(e.message) });
      }
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
