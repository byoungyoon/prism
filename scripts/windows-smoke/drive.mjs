// Presses the real buttons of the installed app through WebView2's debugging port:
// first-run guide → install Claude and Codex → the sign-in buttons (never signs in).
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const [exe, out, modules] = process.argv.slice(2);
const { chromium } = createRequire(path.join(modules, "x.js"))("playwright-core");
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hide = (s) => String(s).replace(/(https?:\/\/[^\s"?#]+)[?#][^\s"]*/g, "$1?…");
const ps = (script) => execFileSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
const screen = (name) => ps(`. '${path.join(import.meta.dirname, "lib.ps1")}'; Save-Screen '${path.join(out, name)}'`);
const browsers = () => ps(`Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(msedge|chrome|firefox|iexplore)\\.exe$' -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { "$($_.Name) $($_.ProcessId) $($_.CommandLine)" }`);
const killBrowsers = () => ps(`Get-Process msedge,chrome,firefox -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2`);

const app = spawn(exe, [], { stdio: "ignore", env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222" } });
app.on("exit", (c) => log(`app exited: ${c}`));
let browser;
for (let i = 0; i < 240 && !browser; i++) {
  await sleep(250);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9222").catch(() => undefined);
}
if (!browser) {
  log(`webview command lines:\n${ps(`Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object CommandLine`)}`);
  throw new Error("could not attach to WebView2");
}
const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].waitForEvent("page"));
page.on("pageerror", (e) => log(`PAGE ERROR ${e.message}`));
page.on("console", (m) => m.type() === "error" && log(`console.error ${hide(m.text())}`));
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) }).catch((e) => log(`shot failed ${e.message}`));
const text = async (loc) => hide(await loc.innerText({ timeout: 3000 }).catch(() => "(gone)"));

const guide = page.getByRole("dialog", { name: "Prism 시작하기" });
await guide.waitFor({ timeout: 90000 });
log("first-run guide is on screen");
await shot("01-first-screen");
await guide.getByRole("checkbox", { name: /Claude/ }).click();
await guide.getByRole("checkbox", { name: /ChatGPT/ }).click();
await guide.getByRole("button", { name: "다음" }).click();

// ── installs ──
let before = "";
let step = 0;
const deadline = Date.now() + 15 * 60 * 1000;
let reached = false;
await sleep(1500);
while (Date.now() < deadline) {
  const now = await text(guide);
  if (now.includes("구독 계정을 연결해 주세요")) {
    reached = true;
    break;
  }
  const view = guide.locator("details").filter({ hasText: "설치 과정 보기" }).first();
  if ((await view.count()) && !(await view.evaluate((d) => d.open))) await view.locator("summary").first().click().catch(() => {});
  // the terminal's own text changes all the time; only a change in the list or the reason counts
  const key = now.replace(/\s+/g, " ").slice(0, 600);
  if (key !== before) {
    before = key;
    log(`install screen:\n${now}`);
    await shot(`02-install-${String(++step).padStart(2, "0")}`);
  }
  if (now.includes("설치 실패")) {
    await sleep(2000);
    const more = guide.getByText("자세한 내용", { exact: true });
    if (await more.count()) await more.first().click();
    await sleep(500);
    log(`FAILED install screen:\n${await text(guide)}`);
    const pre = guide.locator("pre").first();
    if (await pre.count()) log(`failure detail:\n${await text(pre)}`);
    await pre.scrollIntoViewIfNeeded().catch(() => {});
    await shot("03-install-failed");
    screen("03-install-failed-desktop.png");
    break;
  }
  const rows = await guide.locator(".xterm-rows").first().innerText({ timeout: 500 }).catch(() => "");
  if (rows.trim() && Math.floor((Date.now() - t0) / 1000) % 20 < 5) log(`terminal:\n${hide(rows.replace(/\n{2,}/g, "\n").trim().slice(-1200))}`);
  await sleep(5000);
}
if (!reached) {
  log(`did NOT reach the sign-in step. last screen:\n${await text(guide)}`);
  await shot("04-stuck");
} else {
  log("all installs done, sign-in step reached");
  await sleep(4000);
  await shot("05-login-step");
  log(`default browser: ${ps(`(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice' -ErrorAction SilentlyContinue).ProgId; (Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\\https\\shell\\open\\command' -ErrorAction SilentlyContinue).'(default)'`)}`);
  for (const name of ["Claude", "ChatGPT"]) {
    killBrowsers();
    log(`── press "${name} 연결" (browsers running: ${browsers() || "none"})`);
    const button = guide.getByRole("button", { name: `${name} 연결` });
    if (!(await button.count())) {
      log(`no "${name} 연결" button. screen:\n${await text(guide)}`);
      continue;
    }
    await button.click();
    for (const at of [3, 10, 25]) {
      await sleep(at === 3 ? 3000 : at === 10 ? 7000 : 15000);
      log(`after ${at}s screen:\n${await text(page.getByRole("status").last())}`);
      log(`after ${at}s browsers:\n${hide(browsers()) || "none"}`);
      await shot(`06-login-${name}-${at}s`);
      screen(`06-login-${name}-${at}s-desktop.png`);
    }
    const again = page.getByRole("button", { name: "브라우저 다시 열기" });
    if (await again.count()) {
      killBrowsers();
      await again.click();
      await sleep(8000);
      log(`after "브라우저 다시 열기" browsers:\n${hide(browsers()) || "none"}`);
      log(`screen:\n${await text(page.getByRole("status").last())}`);
      screen(`07-reopen-${name}-desktop.png`);
    }
    const cancel = page.getByRole("button", { name: "취소", exact: true });
    if (await cancel.count()) await cancel.click();
    await sleep(500);
    const close = page.getByRole("button", { name: "닫기", exact: true });
    if (await close.count()) await close.last().click();
    await sleep(1500);
  }
  killBrowsers();
}
await browser.close().catch(() => {});
ps(`. '${path.join(import.meta.dirname, "lib.ps1")}'; Stop-Tree ${app.pid}`);
process.exit(0);
