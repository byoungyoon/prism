// 소품 가격이 두 곳(화면 src/lib/shop.ts, 앱 기준 src-tauri/src/projects.rs ITEM_PRICES)에 있으므로 같은지 확인한다.
// 실행: npm test (node --test scripts/test/*.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** 화면 쪽: `{ name: "소파", price: 150, ...}` 목록 */
function screenPrices() {
  const src = read("src/lib/shop.ts");
  const out = new Map();
  for (const m of src.matchAll(/\{ name: "([^"]+)", price: (\d+)/g)) out.set(m[1], Number(m[2]));
  return out;
}

/** 앱 쪽: `pub const ITEM_PRICES ... = &[ ("소파", 150), ... ];` 블록 */
function appPrices() {
  const src = read("src-tauri/src/projects.rs");
  const start = src.indexOf("pub const ITEM_PRICES");
  assert.ok(start >= 0, "projects.rs 에서 ITEM_PRICES를 찾지 못했어요");
  const block = src.slice(start, src.indexOf("];", start));
  const out = new Map();
  for (const m of block.matchAll(/\("([^"]+)", (\d+)\)/g)) out.set(m[1], Number(m[2]));
  return out;
}

test("소품 가격: 화면(shop.ts)과 앱(ITEM_PRICES)이 같다", () => {
  const screen = screenPrices();
  const app = appPrices();
  assert.ok(screen.size > 0 && app.size > 0, "목록을 읽지 못했어요");
  assert.deepEqual([...screen.keys()].sort(), [...app.keys()].sort(), "소품 이름 목록이 다릅니다");
  for (const [name, price] of screen) {
    assert.equal(app.get(name), price, `"${name}" 가격이 다릅니다 (화면 ${price} · 앱 ${app.get(name)})`);
  }
});

test("츄르 받는 양: 안내(shop.ts EARN)와 앱(Rust 상수)이 같다", () => {
  const block = read("src/lib/shop.ts").match(/export const EARN = \{([^}]*)\}/)?.[1];
  assert.ok(block, "shop.ts 에서 EARN을 찾지 못했어요");
  const screen = [...block.matchAll(/(\w+): (\d+)/g)];
  assert.ok(screen.length > 0);
  const rust = read("src-tauri/src/projects.rs");
  for (const [, key, value] of screen) {
    const name = key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
    const found = rust.match(new RegExp(`const ${name}: u(?:32|64) = ([\\d_]+);`))?.[1];
    assert.ok(found, `projects.rs 에 ${name} 이 없어요`);
    assert.equal(Number(found.replaceAll("_", "")), Number(value), `${name} 값이 다릅니다`);
  }
});
