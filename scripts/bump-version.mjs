#!/usr/bin/env node
// 버전을 한 번에 올린다: node scripts/bump-version.mjs 0.3.3
// 4곳(package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock의 prism 항목)을
// 모두 찾을 수 있을 때만 쓴다. 하나라도 못 찾거나 형식이 틀리면 아무 파일도 바꾸지 않고 종료 코드 1.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+$/;

const version = process.argv[2];

function fail(message) {
  console.error(`bump-version: ${message}`);
  console.error('아무 파일도 바꾸지 않았습니다.');
  process.exit(1);
}

if (!version) fail('버전이 필요합니다. 예: node scripts/bump-version.mjs 0.3.3');
if (!SEMVER.test(version)) fail(`형식이 틀렸습니다: "${version}" (x.y.z 형식이어야 합니다, 예: 0.3.3)`);

// 파일마다 "버전 줄"을 찾는 정규식. 정확히 한 번 매칭되어야 한다.
const targets = [
  {
    file: 'package.json',
    // 최상위 "version" 키 (2칸 들여쓰기)
    pattern: /^(  "version": ")[^"]*(")/gm,
    validate: (text) => JSON.parse(text),
  },
  {
    file: 'src-tauri/tauri.conf.json',
    pattern: /^(  "version": ")[^"]*(")/gm,
    validate: (text) => JSON.parse(text),
  },
  {
    file: 'src-tauri/Cargo.toml',
    // [package] 섹션의 version 줄 (파일 안에서 줄 시작 version = "...")
    pattern: /^(version = ")[^"]*(")/gm,
  },
  {
    file: 'src-tauri/Cargo.lock',
    // Cargo.lock의 prism 패키지 항목
    pattern: /(\[\[package\]\]\r?\nname = "prism"\r?\nversion = ")[^"]*(")/g,
  },
];

const updates = [];
for (const target of targets) {
  const path = join(ROOT, target.file);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    fail(`${target.file}을(를) 읽을 수 없습니다: ${err.message}`);
  }

  if (target.validate) {
    try {
      target.validate(text);
    } catch (err) {
      fail(`${target.file}이(가) 올바른 JSON이 아닙니다: ${err.message}`);
    }
  }

  const matches = [...text.matchAll(target.pattern)];
  if (matches.length !== 1) {
    fail(`${target.file}에서 버전 항목을 ${matches.length}개 찾았습니다 (1개여야 함).`);
  }

  const next = text.replace(target.pattern, (_, head, tail) => `${head}${version}${tail}`);
  updates.push({ file: target.file, path, next, changed: next !== text });
}

// 모든 파일 검사가 끝난 뒤에만 쓴다.
for (const update of updates) {
  if (update.changed) writeFileSync(update.path, update.next);
  console.log(`${update.changed ? '갱신' : '이미 같음'}: ${update.file} -> ${version}`);
}
console.log(`버전을 ${version}으로 올렸습니다.`);
