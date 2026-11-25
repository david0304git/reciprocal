#!/usr/bin/env node
/*
 * Ad-hoc console into the app's WebView (Chrome DevTools protocol over adb).
 *
 *   node scripts/inspect-webview.mjs "document.title"
 *   node scripts/inspect-webview.mjs --file snippets/layout.js
 *
 * The expression runs in the page; its value is printed as JSON. When the expression evaluates to a
 * promise it is awaited. Use it for debugging real-device layout/computed-style questions.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PKG = "com.lutszhong.reciprocal";
const ADB = process.env.ADB || `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const PORT = Number(process.env.CDP_PORT || 9223);

const args = process.argv.slice(2);
const expression = args[0] === "--file" ? readFileSync(args[1], "utf8") : args[0];
if (!expression) {
  console.error("usage: inspect-webview.mjs <expression> | --file <path>");
  process.exit(2);
}

const pid = execFileSync(ADB, ["shell", "pidof", PKG], { encoding: "utf8" }).trim().split(/\s+/)[0];
if (!pid) {
  console.error("app is not running");
  process.exit(1);
}
execFileSync(ADB, ["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);

let page;
for (let attempt = 0; attempt < 40 && !page; attempt += 1) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    page = targets.find((target) => target.type === "page" && target.url.includes("appassets"));
  } catch {
    /* retry */
  }
  if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!page) {
  console.error("no devtools target");
  process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});

function send(method, params = {}) {
  return new Promise((resolve) => {
    const messageId = ++id;
    pending.set(messageId, resolve);
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
}

const response = await send("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
});
if (response.result?.exceptionDetails) {
  console.error(JSON.stringify(response.result.exceptionDetails, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(response.result?.result?.value, null, 2));
socket.close();
