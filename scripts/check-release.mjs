#!/usr/bin/env node
// release.yml이 초안을 공개하기 전에 쓰는 검사.
//   node scripts/check-release.mjs versions v0.3.9
//   node scripts/check-release.mjs assets v0.3.9 latest.json assets.json 주인/저장소

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 태그와 앱 안의 버전 세 곳이 같은지. 다르면 문제 목록. */
export function checkVersions(tag, root = ROOT) {
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const found = {
    "package.json": JSON.parse(read("package.json")).version,
    "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
    "src-tauri/Cargo.toml": /^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1],
  };
  return Object.entries(found)
    .filter(([, v]) => `v${v}` !== tag)
    .map(([file, v]) => `${file} 버전(${v})이 태그(${tag})와 달라요`);
}

const PLATFORMS = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"];

/** 초안에 설치 파일과 latest.json의 세 플랫폼이 모두 있는지. 문제 목록(비면 통과). */
export function checkAssets(tag, latest, assets, repo) {
  const problems = [];
  const version = tag.replace(/^v/, "");
  // 올리다 만 파일은 state가 "uploaded"가 아니다
  const names = new Set(assets.filter((a) => a.state === "uploaded" && a.size > 0).map((a) => a.name));
  for (const installer of [`Prism_${version}_aarch64.dmg`, `Prism_${version}_x64.dmg`, `Prism_${version}_x64-setup.exe`, `Prism_${version}_x64_en-US.msi`]) {
    if (!names.has(installer)) problems.push(`설치 파일이 없어요: ${installer}`);
  }
  if (latest.version !== version) problems.push(`latest.json의 버전이 ${latest.version}이에요 (기대: ${version})`);
  const platforms = latest.platforms ?? {};
  for (const p of PLATFORMS) if (!platforms[p]) problems.push(`latest.json에 ${p}가 없어요`);
  const prefix = `https://github.com/${repo}/releases/download/${tag}/`;
  for (const [p, entry] of Object.entries(platforms)) {
    if (!entry.signature) problems.push(`${p}: 서명이 비어 있어요`);
    if (!entry.url?.startsWith(prefix)) problems.push(`${p}: 주소가 ${tag} 릴리스가 아니에요 (${entry.url})`);
    else if (!names.has(entry.url.slice(prefix.length))) problems.push(`${p}: 가리키는 파일이 릴리스에 없어요 (${entry.url})`);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [mode, tag, latestFile, assetsFile, repo] = process.argv.slice(2);
  const json = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
  let problems;
  if (mode === "versions" && tag) problems = checkVersions(tag);
  else if (mode === "assets" && repo) problems = checkAssets(tag, json(latestFile), json(assetsFile), repo);
  else {
    console.error("사용법: check-release.mjs versions <태그> | assets <태그> <latest.json> <assets.json> <저장소>");
    process.exit(2);
  }
  for (const p of problems) console.error(`::error::${p}`);
  if (problems.length) {
    console.error("초안은 공개하지 않았어요. Actions에서 'Re-run all jobs'를 눌러 주세요.");
    process.exit(1);
  }
  console.log(`✓ ${mode} 검사 통과 (${tag})`);
}
