import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkAssets, checkVersions } from "../check-release.mjs";

const REPO = "byoungyoon/prism";
const names = ["Prism_1.2.3_aarch64.dmg", "Prism_1.2.3_x64.dmg", "Prism_1.2.3_x64-setup.exe", "Prism_1.2.3_x64_en-US.msi", "Prism_aarch64.app.tar.gz", "Prism_x64.app.tar.gz", "latest.json"];
const assets = names.map((name) => ({ name, state: "uploaded", size: 10 }));
const entry = (file) => ({ signature: "sig", url: `https://github.com/${REPO}/releases/download/v1.2.3/${file}` });
const latest = {
  version: "1.2.3",
  platforms: {
    "darwin-aarch64": entry("Prism_aarch64.app.tar.gz"),
    "darwin-x86_64": entry("Prism_x64.app.tar.gz"),
    "windows-x86_64": entry("Prism_1.2.3_x64_en-US.msi"),
  },
};

test("세 플랫폼과 설치 파일이 다 있으면 통과", () => {
  assert.deepEqual(checkAssets("v1.2.3", latest, assets, REPO), []);
});

test("플랫폼 하나가 빠지면 막는다", () => {
  const { "darwin-x86_64": _, ...rest } = latest.platforms;
  assert.match(checkAssets("v1.2.3", { ...latest, platforms: rest }, assets, REPO).join(), /darwin-x86_64가 없어요/);
});

test("설치 파일이 덜 올라갔거나, 초안 임시 주소·예전 버전이면 막는다", () => {
  const half = assets.map((a) => (a.name.endsWith("setup.exe") ? { ...a, state: "starter" } : a));
  assert.match(checkAssets("v1.2.3", latest, half, REPO).join(), /setup\.exe/);
  const untagged = { ...latest, platforms: { ...latest.platforms, "windows-x86_64": { signature: "s", url: `https://github.com/${REPO}/releases/download/untagged-abc/Prism_1.2.3_x64_en-US.msi` } } };
  assert.match(checkAssets("v1.2.3", untagged, assets, REPO).join(), /릴리스가 아니에요/);
  assert.match(checkAssets("v1.2.3", { ...latest, version: "1.2.2" }, assets, REPO).join(), /1\.2\.2/);
});

test("저장소의 버전 세 곳이 서로 같다 (태그 검사의 전제)", () => {
  const { version } = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(checkVersions(`v${version}`), []);
  assert.equal(checkVersions("v0.0.0").length, 3);
});
