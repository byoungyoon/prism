#!/usr/bin/env node
// Headless MCP smoke test for deckcraft-cli, over stdio.
//
//   node scripts/deckcraft-mcp-smoke.mjs CLI IN.pptx OUT_DIR
//
// Starts `CLI mcp` confined to IN's folder (read) and OUT_DIR (write), then:
//   1. open_presentation IN.pptx
//   2. inspect_slide 0, pick the first shape with text
//   3. set_text that shape to a marker string, inspect again to confirm
//   4. save_presentation OUT_DIR/edited.pptx
//   5. save_presentation outside the write root must be refused (isError)
// Then checks the saved file with `CLI convert OUT_DIR/edited.pptx OUT_DIR/edited.txt` and
// greps the marker. Exit 0 only when every check passes; prints a JSON report.
import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const [cli, input, outArg] = process.argv.slice(2);
if (!cli || !input || !outArg) {
  console.error("usage: node scripts/deckcraft-mcp-smoke.mjs CLI IN.pptx OUT_DIR");
  process.exit(2);
}

const readRoot = path.dirname(path.resolve(input));
const writeRoot = path.resolve(outArg);
const output = path.join(writeRoot, "edited.pptx");
const outline = path.join(writeRoot, "edited.txt");
const refused = path.join(readRoot, "refused.pptx");
const marker = `MCP smoke ${new Date().toISOString()}`;

await mkdir(writeRoot, { recursive: true });

const child = spawn(cli, ["mcp", "--automation-read-root", readRoot, "--automation-write-root", writeRoot], {
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));

const waiting = new Map();
createInterface({ input: child.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  const resolve = waiting.get(msg.id);
  if (resolve) {
    waiting.delete(msg.id);
    resolve(msg);
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
}
async function tool(name, args) {
  const reply = await rpc("tools/call", { name, arguments: args });
  if (reply.error) return { isError: true, text: reply.error.message };
  return { isError: reply.result.isError === true, text: reply.result.content.map((c) => c.text).join("\n") };
}

const checks = {};
const report = { cli, input, writeRoot, marker, checks };
try {
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "deckcraft-smoke", version: "0" },
  });
  checks.initialize = Boolean(init.result);
  notify("notifications/initialized");

  const opened = await tool("open_presentation", { path: input });
  checks.open = !opened.isError;

  const slide = JSON.parse((await tool("inspect_slide", { index: 0 })).text);
  const shape = (slide.shapes ?? []).find((s) => typeof s.text === "string" && s.text.trim() !== "");
  checks.findShape = Boolean(shape);
  report.shapeBefore = shape ? { id: shape.id, text: shape.text } : null;

  if (shape) {
    const set = await tool("set_text", { id: shape.id, text: marker });
    checks.setText = !set.isError;
    const after = JSON.parse((await tool("inspect_slide", { index: 0 })).text);
    const now = (after.shapes ?? []).find((s) => s.id === shape.id);
    checks.textUpdatedInSession = now?.text === marker;
  }

  const saved = await tool("save_presentation", { path: output });
  checks.save = !saved.isError;
  const st = await stat(output).catch(() => null);
  checks.outputIsZip = st !== null && st.size > 0 && (await readFile(output)).subarray(0, 2).toString("latin1") === "PK";

  const escape = await tool("save_presentation", { path: refused });
  checks.writeOutsideRootRefused = escape.isError === true;
  report.refusedMessage = escape.text.split("\n")[0];

  child.stdin.end();
  await new Promise((resolve) => child.on("close", resolve));

  // Independent check: the file on disk, read by the CLI itself, holds the marker.
  if (checks.save) {
    await execFileAsync(cli, ["convert", output, outline]);
    checks.markerOnDisk = (await readFile(outline, "utf8")).includes(marker);
  } else {
    checks.markerOnDisk = false;
  }
} catch (error) {
  report.error = String(error?.message ?? error);
  child.kill();
} finally {
  report.stderr = stderr.trim().split("\n").slice(0, 3);
  console.log(JSON.stringify(report, null, 2));
}

const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
if (report.error || failed.length) {
  console.error(`smoke test failed: ${report.error ?? failed.join(", ")}`);
  process.exit(1);
}
console.error("smoke test passed");
