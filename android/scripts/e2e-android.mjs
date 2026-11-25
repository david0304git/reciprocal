#!/usr/bin/env node
/*
 * Reciprocal Android — end-to-end checks against the debug build running on a device/emulator.
 *
 * It attaches to the WebView through the Chrome DevTools protocol (`adb forward` → `/json`), so the
 * assertions drive the *real* app: React UI, the Tauri shim, the Kotlin bridge, SQLite and the
 * system calendar provider.
 *
 *   node scripts/e2e-android.mjs                  # all checks
 *   node scripts/e2e-android.mjs --only=backup    # one group
 *   node scripts/e2e-android.mjs --json           # machine-readable summary
 *
 * Requires: an emulator/device with the debug APK installed (see scripts/install-apk.sh).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const PKG = "com.lutszhong.reciprocal";
const ADB =
  process.env.ADB || `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const ROOT = path.resolve(import.meta.dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const SHOTS = path.join(ARTIFACTS, "screenshots");
const DB_DIR = path.join(ARTIFACTS, "db");

const args = process.argv.slice(2);
const only = args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length) || null;
const asJson = args.includes("--json");

// ---------------------------------------------------------------- adb helpers

function adb(...cmd) {
  return execFileSync(ADB, cmd, { encoding: "utf8" }).trim();
}

function adbRaw(...cmd) {
  return execFileSync(ADB, cmd, { maxBuffer: 64 * 1024 * 1024 });
}

function adbShell(...cmd) {
  return adb("shell", ...cmd);
}

// ---------------------------------------------------------------- test harness

const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, fn) {
  if (only && !name.startsWith(only)) return;
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? "" });
    if (!asJson) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    const detail = error?.message || String(error);
    results.push({ name, ok: false, detail });
    if (!asJson) console.log(`FAIL  ${name} — ${detail}`);
  }
}

// ---------------------------------------------------------------- CDP client

let socket;
let messageId = 0;
const pending = new Map();

async function connect() {
  const pid = adbShell("pidof", PKG).split(/\s+/)[0];
  assert(pid, "app is not running — start it with `am start -n com.lutszhong.reciprocal/.MainActivity`");
  adb("forward", `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`);

  const deadline = Date.now() + 20_000;
  let page;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const targets = await response.json();
      page = targets.find((target) => target.type === "page" && target.url.includes("appassets"));
      if (page) break;
    } catch {
      /* devtools endpoint not ready yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(page, "could not find the WebView devtools target");

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  });

  const { result } = await send("Runtime.enable");
  return result;
}

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++messageId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const message = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const response = message.result;
  if (response?.exceptionDetails) {
    const description =
      response.exceptionDetails.exception?.description ||
      response.exceptionDetails.text ||
      "evaluation failed";
    throw new Error(description);
  }
  return response?.result?.value;
}

/** Calls a bridge command exactly like the React app does. */
async function invoke(command, commandArgs = {}) {
  const value = await evaluate(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(commandArgs)})`,
  );
  return value;
}

async function expectFailure(command, commandArgs, expectedFragment) {
  const outcome = await evaluate(`
    (async () => {
      try {
        await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(commandArgs)});
        return { ok: true };
      } catch (error) {
        return { ok: false, message: String(error) };
      }
    })()
  `);
  assert(outcome.ok === false, `${command} unexpectedly succeeded`);
  if (expectedFragment) {
    assert(
      String(outcome.message).includes(expectedFragment),
      `${command} error "${outcome.message}" does not contain "${expectedFragment}"`,
    );
  }
  return outcome.message;
}

async function screenshot(name) {
  mkdirSync(SHOTS, { recursive: true });
  const buffer = adbRaw("exec-out", "screencap", "-p");
  writeFileSync(path.join(SHOTS, `${name}.png`), buffer);
}

async function waitForApp() {
  // The bridge must be alive; a data-layer failure leaves the error splash up, which the
  // "shell/bridge" check reports with its message instead of aborting the whole run.
  const deadline = Date.now() + 30_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(`({
      android: window.__reciprocalAndroid === true,
      hasBridge: typeof window.__TAURI_INTERNALS__ === "object",
      splash: !!document.querySelector(".splash"),
      splashError: !!document.querySelector(".splash__mark--error"),
      splashText: document.querySelector(".splash__text")?.textContent || null,
      nav: document.querySelectorAll(".nav__item").length,
    })`).catch(() => null);
    // Ready = the shell mounted (4 nav tabs) or the app gave up with an error splash.
    if (last?.android && last.hasBridge && (last.nav >= 4 || last.splashError)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`bridge never came up: ${JSON.stringify(last)}`);
}

/**
 * Reloads the web app and waits for the shell. Commands invoked straight through the bridge bypass
 * React's in-memory store, so UI assertions need a fresh mount to see the new data.
 */
async function reloadApp() {
  await evaluate("location.reload()").catch(() => {});
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(`({
      nav: document.querySelectorAll(".nav__item").length,
      splash: !!document.querySelector(".splash"),
      android: window.__reciprocalAndroid === true,
    })`).catch(() => null);
    if (ready?.android && ready.nav >= 4 && !ready.splash) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("app did not come back after reload");
}

/** Pulls the SQLite files (WAL included) so they can be inspected on the host. */
function pullDatabase() {
  mkdirSync(DB_DIR, { recursive: true });
  const dir = `/data/data/${PKG}/databases`;
  const files = adbShell("run-as", PKG, "ls", dir).split(/\s+/).filter(Boolean);
  for (const file of files) {
    if (!file.startsWith("reciprocal.db")) continue;
    const buffer = adbRaw("exec-out", "run-as", PKG, "cat", `${dir}/${file}`);
    writeFileSync(path.join(DB_DIR, file), buffer);
  }
  return path.join(DB_DIR, "reciprocal.db");
}

function sqlite(dbPath, query) {
  return execFileSync("/usr/bin/sqlite3", [dbPath, query], { encoding: "utf8" }).trim();
}

// ---------------------------------------------------------------- checks

async function run() {
  const boot = await waitForApp();
  console.log(`attached: nav=${boot.nav} splash=${boot.splash}${boot.splashText ? ` (${boot.splashText})` : ""}`);

  // Start from the same state a brand-new install has, so the suite is repeatable. (That a fresh
  // install really is empty is asserted by scripts/verify-parity.py: the seed may only contain the
  // onboarding marker.)
  await invoke("clear_all_data");
  await reloadApp();
  console.log("state reset via clear_all_data\n");

  // ---------------------------------------------------------------- shell & boot
  await test("shell/bridge", async () => {
    const state = await evaluate(`({
      android: window.__reciprocalAndroid,
      tauri: typeof window.__TAURI_INTERNALS__?.invoke,
      navLabels: Array.from(document.querySelectorAll(".nav__item .nav__label")).map((el) => el.textContent),
      style: document.documentElement.dataset.uiStyle,
      theme: document.documentElement.dataset.theme,
      platform: document.documentElement.dataset.platform,
    })`);
    assert(state.android === true, "shim did not detect the native bridge");
    assert(state.tauri === "function", "__TAURI_INTERNALS__.invoke missing");
    assert(state.platform === "android", `platform marker is ${state.platform}`);
    assert(
      JSON.stringify(state.navLabels) === JSON.stringify(["主頁", "日曆", "時間表", "設定"]),
      `unexpected nav: ${JSON.stringify(state.navLabels)}`,
    );
    const splashError = await evaluate(
      `document.querySelector(".splash__mark--error") ? document.querySelector(".splash__text")?.textContent : null`,
    );
    assert(!splashError, `app is stuck on its error splash: ${splashError}`);
    return `nav=${state.navLabels.join("/")} style=${state.style} theme=${state.theme}`;
  });

  await test("ui/viewport", async () => {
    // Regression guard: hosting the WebView in a Compose AndroidView used to give Chromium a
    // zero-height CSS viewport even though the page painted (100vh/100dvh/% all resolved to 0px).
    const metrics = await evaluate(`({
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      vh: (() => { const d = document.createElement("div"); d.style.cssText = "height:100vh"; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h; })(),
      mediaHeightWorks: matchMedia("(min-height: 100px)").matches,
      shellHeight: parseFloat(getComputedStyle(document.querySelector(".shell")).height),
      navTop: document.querySelector(".sidebar").getBoundingClientRect().top,
      navBottom: document.querySelector(".sidebar").getBoundingClientRect().bottom,
    })`);
    assert(metrics.innerHeight > 400, `innerHeight=${metrics.innerHeight}`);
    assert(
      Math.abs(metrics.vh - metrics.innerHeight) < 2,
      `100vh=${metrics.vh} does not match innerHeight=${metrics.innerHeight}`,
    );
    assert(metrics.mediaHeightWorks, "media query height collapsed to 0");
    assert(
      Math.abs(metrics.shellHeight - metrics.innerHeight) < 2,
      `shell height=${metrics.shellHeight} vs viewport=${metrics.innerHeight}`,
    );
    assert(metrics.navTop > metrics.innerHeight / 2, `nav bar is not at the bottom (top=${metrics.navTop})`);
    return `viewport=${metrics.innerWidth}x${metrics.innerHeight} · nav at y=${Math.round(metrics.navTop)}`;
  });

  await test("data/fresh-install", async () => {
    // The Android build ships no demo data: a brand-new database must be empty, with only the
    // onboarding marker written (the desktop app still seeds sample rows).
    const data = await invoke("load_app");
    assert(data.habits.length === 0, `habits=${data.habits.length}`);
    assert(data.logs.length === 0, `logs=${data.logs.length}`);
    assert(data.events.length === 0, `events=${data.events.length}`);
    assert(data.tasks.length === 0, `tasks=${data.tasks.length}`);
    assert(data.timetable.length === 0, `timetable=${data.timetable.length}`);
    assert(data.settings.onboarded === "1", "onboarding flag missing");
    const demo = ["與朋友午餐", "月度回顧", "買新的筆記本", "深度工作", "團隊同步"];
    for (const table of ["events", "tasks", "timetable"]) {
      for (const row of data[table]) {
        assert(!demo.includes(row.title), `demo row survived: ${row.title}`);
      }
    }
    return "empty database · onboarded=1 · no demo rows";
  });

  await test("data/db-file", async () => {
    const dbPath = pullDatabase();
    const version = sqlite(dbPath, "PRAGMA user_version");
    assert(version === "6", `user_version=${version}`);
    const tables = sqlite(dbPath, "SELECT group_concat(name, ',') FROM sqlite_master WHERE type='table' ORDER BY name");
    for (const table of ["events", "habit_logs", "habits", "settings", "tasks", "timetable"]) {
      assert(tables.includes(table), `missing table ${table}`);
    }
    const index = sqlite(dbPath, "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_events_imported_key'");
    assert(index === "1", "imported-event unique index missing");
    return `user_version=6 tables=${tables}`;
  });

  // ---------------------------------------------------------------- tasks
  await test("tasks/crud", async () => {
    const created = await invoke("save_task", {
      task: {
        title: "E2E 任務",
        notes: "由 e2e-android.mjs 建立",
        status: "todo",
        priority: 2,
        dueDate: null,
        tags: ["測試", "e2e"],
        list: "個人",
      },
    });
    assert(created.id > 0, "task id missing");
    assert(created.title === "E2E 任務", `title=${created.title}`);
    assert(created.tags.join(",") === "測試,e2e", `tags=${created.tags}`);
    assert(created.completedAt === null, "new task should not be completed");

    const doing = await invoke("set_task_status", { id: created.id, status: "doing" });
    assert(doing.status === "doing", `status=${doing.status}`);

    const done = await invoke("set_task_status", { id: created.id, status: "done" });
    assert(done.status === "done" && done.completedAt, "done task needs completedAt");

    await invoke("delete_task", { id: created.id });
    const data = await invoke("load_app");
    assert(!data.tasks.some((task) => task.id === created.id), "task not deleted");
    return `id=${created.id} todo→doing→done→deleted`;
  });

  await test("tasks/validation", async () => {
    const message = await expectFailure("save_task", { task: { title: "   " } }, "標題");
    return message;
  });

  // ---------------------------------------------------------------- events
  await test("events/crud", async () => {
    const created = await invoke("save_event", {
      event: {
        title: "E2E 行程",
        notes: "",
        date: "2026-12-24",
        startTime: "19:30",
        endTime: "20:30",
        allDay: false,
        color: "#5B7DB1",
        location: "測試地點",
        category: "個人",
      },
    });
    assert(created.id > 0, "event id missing");
    assert(created.startTime === "19:30" && created.allDay === false, "event time drifted");
    assert(created.source === "local", `source=${created.source}`);

    const allDay = await invoke("save_event", {
      event: { title: "E2E 全日", date: "2026-12-25", allDay: true },
    });
    assert(allDay.allDay === true && allDay.startTime === null, "all-day event shape drifted");

    await invoke("delete_event", { id: created.id });
    await invoke("delete_event", { id: allDay.id });
    const data = await invoke("load_app");
    assert(data.events.length === 0, `events after cleanup=${data.events.length}`);
    return `id=${created.id}`;
  });

  // ---------------------------------------------------------------- timetable + settings
  await test("timetable/crud", async () => {
    const block = await invoke("save_timetable", {
      block: { day: 3, startTime: "20:00", endTime: "21:00", title: "E2E 時段", notes: "", color: "#3F7C6A" },
    });
    assert(block.id > 0 && block.day === 3, "timetable block drifted");
    await invoke("delete_timetable", { id: block.id });
    return `id=${block.id}`;
  });

  await test("settings/roundtrip", async () => {
    await invoke("set_setting", { key: "theme", value: "dark" });
    let data = await invoke("load_app");
    assert(data.settings.theme === "dark", `theme=${data.settings.theme}`);
    await invoke("set_setting", { key: "theme", value: "auto" });
    data = await invoke("load_app");
    assert(data.settings.theme === "auto", `theme=${data.settings.theme}`);
    return "theme dark→auto persisted";
  });

  // ---------------------------------------------------------------- backup
  await test("backup/export-import", async () => {
    // Build a known dataset first (there is no seed to export any more).
    const task = await invoke("save_task", {
      task: { title: "備份測試任務", notes: "export", status: "todo", priority: 1, tags: ["備份"], list: "個人" },
    });
    const event = await invoke("save_event", {
      event: { title: "備份測試行程", date: "2026-12-30", startTime: "08:00", endTime: "09:00", allDay: false, color: "#5B7DB1", category: "個人" },
    });
    const block = await invoke("save_timetable", {
      block: { day: 2, startTime: "07:00", endTime: "08:00", title: "備份測試時段", notes: "", color: "#3F7C6A" },
    });
    assert(task.id > 0 && event.id > 0 && block.id > 0, "could not create the backup fixture");

    const uri = `file:///data/data/${PKG}/files/e2e-backup.json`;
    const written = await invoke("export_backup", { path: uri });
    assert(written, "export returned nothing");
    const text = adbShell("run-as", PKG, "cat", `/data/data/${PKG}/files/e2e-backup.json`);
    const backup = JSON.parse(text);
    // The envelope version is 1 in the desktop app (the DB schema version lives in
    // PRAGMA user_version, not in the backup).
    assert(backup.version === 1, `backup version=${backup.version}`);
    assert(backup.exportedAt, "backup exportedAt missing");
    assert(backup.tasks.some((row) => row.title === "備份測試任務"), "backup lost the task");
    assert(backup.events.some((row) => row.title === "備份測試行程"), "backup lost the event");
    assert(backup.timetable.some((row) => row.title === "備份測試時段"), "backup lost the block");
    assert(backup.settings.onboarded === "1", "backup settings missing");

    const extra = await invoke("save_task", { task: { title: "匯入前建立的任務", status: "todo" } });
    assert(extra.id > 0, "could not create task before import");
    const restored = await invoke("import_backup", { path: uri });
    assert(
      restored.tasks.some((row) => row.title === "備份測試任務"),
      "import lost the backed-up task",
    );
    assert(
      !restored.tasks.some((row) => row.title === "匯入前建立的任務"),
      "import did not replace existing data",
    );
    return `exported ${text.length} bytes · restored ${restored.tasks.length} tasks`;
  });

  await test("backup/legacy-v1", async () => {
    // The exact fixture the Rust test suite uses for "old backup without timetable/source".
    const legacy = JSON.stringify(
      {
        version: 1,
        exportedAt: "2026-10-01T00:00:00.000Z",
        habits: [],
        logs: [],
        events: [],
        tasks: [],
        settings: { theme: "dark" },
      },
      null,
      2,
    );
    const remote = `/data/data/${PKG}/files/e2e-legacy.json`;
    execFileSync(
      ADB,
      ["shell", `run-as ${PKG} sh -c 'cat > files/e2e-legacy.json'`],
      { input: legacy, encoding: "utf8" },
    );
    const restored = await invoke("import_backup", { path: `file://${remote}` });
    assert(restored.habits.length === 0, `habits=${restored.habits.length}`);
    assert(restored.timetable.length === 0, "a v1 backup must restore an empty timetable");
    assert(restored.settings.theme === "dark", `theme=${restored.settings.theme}`);
    assert(restored.settings.onboarded === "1", "import must set onboarded=1");

    // Re-import the full backup so later checks see the seeded dataset again.
    await invoke("import_backup", { path: `file:///data/data/${PKG}/files/e2e-backup.json` });
    return "v1 backup restored (0 habits, 0 timetable, theme=dark) then reseeded";
  });

  await test("platform/version-and-links", async () => {
    const version = await invoke("plugin:app|version");
    assert(version === "0.1.7", `version=${version}`);
    const message = await expectFailure("open_external", { url: "https://example.com" }, "GitHub");
    return `version=${version} · non-GitHub link rejected (${message})`;
  });

  // ---------------------------------------------------------------- storage & update
  await test("storage/info", async () => {
    const info = await invoke("storage_info");
    assert(info.dbPath.endsWith("reciprocal.db"), `dbPath=${info.dbPath}`);
    assert(info.dataDir.startsWith("/data/user/0/") || info.dataDir.startsWith("/data/data/"), `dataDir=${info.dataDir}`);
    assert(info.sizeBytes > 0, `sizeBytes=${info.sizeBytes}`);
    return `${info.dbPath} (${info.sizeBytes} bytes)`;
  });

  await test("update/check", async () => {
    const info = await invoke("check_for_updates");
    assert(info.currentVersion === "0.1.7", `currentVersion=${info.currentVersion}`);
    assert(["release", "tag", "none"].includes(info.source), `source=${info.source}`);
    assert(typeof info.updateAvailable === "boolean", "updateAvailable must be boolean");
    return `${info.source} latest=${info.latestVersion} available=${info.updateAvailable}`;
  });

  // ---------------------------------------------------------------- calendar
  await test("calendar/sync", async () => {
    adbShell("pm", "grant", PKG, "android.permission.READ_CALENDAR");
    adbShell("pm", "grant", PKG, "android.permission.WRITE_CALENDAR");

    const connected = await invoke("apple_connect");
    assert(Array.isArray(connected.events), "connect did not return AppData");

    const status = await invoke("apple_status");
    assert(status.supported === true, "calendar should be supported on Android");
    assert(status.enabled === true, `enabled=${status.enabled}`);
    assert(status.authorization === "fullAccess", `authorization=${status.authorization}`);
    assert(status.calendarId, "no Reciprocal calendar id");

    const event = await invoke("save_event", {
      event: {
        title: "E2E 系統日曆行程",
        date: "2026-12-26",
        startTime: "09:00",
        endTime: "10:00",
        allDay: false,
        color: "#D98A5F",
        category: "個人",
        appleCalendarId: status.calendarId,
      },
    });
    assert(event.id > 0, "could not create mirrored event");

    const synced = await invoke("apple_sync");
    const mirrored = synced.events.find((item) => item.id === event.id);
    assert(mirrored?.externalId, "event was not pushed to the system calendar");

    const providerRows = adbShell(
      "content",
      "query",
      "--uri",
      "content://com.android.calendar/calendars",
      "--projection",
      "_id:name:account_name",
    );
    assert(providerRows.includes("Reciprocal"), `calendar provider has no Reciprocal calendar:\n${providerRows}`);

    const calendars = await invoke("apple_calendars");
    assert(Array.isArray(calendars.calendars), "apple_calendars shape drifted");
    assert(Array.isArray(calendars.eventCalendars), "eventCalendars missing");

    await invoke("delete_event", { id: event.id });
    return `calendar=${status.calendarId} imported=${status.importedCount} mirrored=${status.mirroredCount}`;
  });

  // ---------------------------------------------------------------- UI behaviour
  await test("ui/navigation", async () => {
    await evaluate(`document.querySelectorAll(".nav__item")[1].click()`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    let active = await evaluate(`document.querySelector(".nav__item--active .nav__label")?.textContent`);
    assert(active === "日曆", `active view=${active}`);
    await screenshot("android-calendar");

    const handled = await evaluate(`window.__reciprocalBack()`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert(handled === true, "back was not consumed while on the calendar view");
    active = await evaluate(`document.querySelector(".nav__item--active .nav__label")?.textContent`);
    assert(active === "主頁", `after back active view=${active}`);
    return "日曆 → back → 主頁";
  });

  await test("ui/page-transition", async () => {
    const showHome = async () => {
      await evaluate(`document.querySelectorAll(".nav__item")[0].click()`);
      await new Promise((resolve) => setTimeout(resolve, 700));
    };
    const read = () =>
      evaluate(`(() => {
        const track = document.querySelector(".view-track");
        const viewport = document.querySelector(".view-viewport");
        const panels = Array.from(document.querySelectorAll(".view-panel"));
        const shift = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41;
        const viewportWidth = viewport.getBoundingClientRect().width;
        return {
          panels: panels.length,
          panelWidth: Math.round(panels[0].getBoundingClientRect().width),
          viewportWidth: Math.round(viewportWidth),
          trackWidth: Math.round(track.getBoundingClientRect().width),
          shift: Math.round(shift),
          active: panels.findIndex((panel) => panel.dataset.active === "true"),
          transition: getComputedStyle(track).transitionProperty,
          straddling:
            panels.some((panel) => {
              const rect = panel.getBoundingClientRect();
              return rect.left < -2 && rect.right > 2;
            }) &&
            panels.some((panel) => {
              const rect = panel.getBoundingClientRect();
              return rect.left < viewportWidth - 2 && rect.left > 2;
            }),
        };
      })()`);

    await showHome();
    let state = await read();
    assert(state.panels === 4, `expected four panels, got ${state.panels}`);
    assert(
      Math.abs(state.trackWidth - state.panelWidth * 4) <= 8,
      `the four pages should form one sheet (${state.trackWidth} vs ${state.panelWidth * 4})`,
    );
    assert(Math.abs(state.shift) <= 1 && state.active === 0, "home should be page 1");
    assert(state.transition.includes("transform"), `transition = ${state.transition}`);

    await evaluate(`document.querySelectorAll(".nav__item")[1].click()`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const mid = await read();
    assert(mid.straddling, "the neighbouring page should be visible while the camera moves");
    assert(mid.shift < 0 && mid.shift > -mid.panelWidth, `mid shift = ${mid.shift}`);
    await new Promise((resolve) => setTimeout(resolve, 420));
    state = await read();
    assert(
      Math.abs(state.shift + state.panelWidth) <= 2 && state.active === 1,
      `calendar shift = ${state.shift} (panel ${state.panelWidth})`,
    );

    await evaluate(`document.querySelectorAll(".nav__item")[3].click()`);
    await new Promise((resolve) => setTimeout(resolve, 520));
    state = await read();
    assert(
      Math.abs(state.shift + state.panelWidth * 3) <= 3 && state.active === 3,
      `settings shift = ${state.shift} (panel ${state.panelWidth})`,
    );

    await showHome();
    state = await read();
    assert(Math.abs(state.shift) <= 1 && state.active === 0, "home should be back in view");
    return "4 panels as one sheet · camera moves one page per step · no reload";
  });

  await test("ui/modal-back", async () => {
    await evaluate(`document.querySelectorAll(".nav__item")[2].click()`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const opened = await evaluate(`
      (() => {
        const button = Array.from(document.querySelectorAll("button")).find((el) => el.textContent.includes("新增") && el.offsetParent);
        if (!button) return false;
        button.click();
        return true;
      })()
    `);
    assert(opened, "no create button found on the schedule view");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const hasModal = await evaluate(`!!document.querySelector(".modal-backdrop")`);
    const handled = await evaluate(`window.__reciprocalBack()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const closed = await evaluate(`!!document.querySelector(".modal-backdrop")`);
    assert(handled === true, "back did not consume the modal");
    assert(closed === false, "modal still open after back");
    return `modal opened=${hasModal}`;
  });

  await test("ui/event-form", async () => {
    // The Apple-calendar category picker would replace the local ones; keep this deterministic.
    await invoke("set_setting", { key: "appleSyncEnabled", value: "0" });
    await reloadApp();

    await evaluate(`document.querySelectorAll(".nav__item")[1].click()`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const opened = await evaluate(`
      (() => {
        const button = Array.from(document.querySelectorAll("button")).find(
          (el) => /新增行程/.test(el.textContent) && el.offsetParent,
        );
        if (!button) return false;
        button.click();
        return true;
      })()
    `);
    assert(opened, "no create-event button on the calendar view");
    await new Promise((resolve) => setTimeout(resolve, 700));

    const form = await evaluate(`({
      modal: !!document.querySelector(".modal"),
      nativeSelects: document.querySelectorAll(".modal select").length,
      chips: Array.from(document.querySelectorAll(".modal .category-chip__main")).map((el) => el.textContent.trim()),
    })`);
    assert(form.modal, "the event sheet did not open");
    assert(
      form.nativeSelects === 0,
      `the sheet still renders ${form.nativeSelects} native <select> element(s)`,
    );
    assert(
      form.chips.includes("個人") && form.chips.some((label) => label.includes("自訂")),
      `category chips = ${form.chips.join(",")}`,
    );

    // custom time picker: 09:00 → 14:30 through the in-app panel
    const picked = await evaluate(`
      (async () => {
        const trigger = document.querySelector(".modal .time-field__trigger");
        if (!trigger) return { error: "no time field" };
        trigger.click();
        await new Promise((r) => setTimeout(r, 300));
        const picker = document.querySelector(".time-picker");
        if (!picker) return { error: "the picker did not open" };
        const columns = picker.querySelectorAll(".time-picker__col");
        const optionByText = (root, text) =>
          Array.from(root.querySelectorAll(".time-picker__item")).find(
            (el) => el.textContent.trim() === text,
          );
        optionByText(columns[0], "14").click();
        await new Promise((r) => setTimeout(r, 120));
        optionByText(columns[1], "30").click();
        await new Promise((r) => setTimeout(r, 120));
        const value = trigger.querySelector(".time-field__value").textContent.replace(/\s+/g, "");
        picker.querySelector(".time-picker__foot button").click();
        await new Promise((r) => setTimeout(r, 200));
        return { value, closed: !document.querySelector(".time-picker") };
      })()
    `);
    assert(!picked.error, picked.error);
    assert(picked.value === "14:30", `picker value = ${picked.value}`);
    assert(picked.closed, "the picker did not close");

    // custom date picker: month navigation + pick a day, no native date input
    const date = await evaluate(`
      (async () => {
        const trigger = document.querySelector(".modal .date-field__trigger");
        if (!trigger) return { error: "no date field" };
        const before = trigger.textContent.replace(/\\s+/g, "");
        trigger.click();
        await new Promise((r) => setTimeout(r, 300));
        const panel = document.querySelector(".modal .date-picker");
        if (!panel) return { error: "the date picker did not open" };
        const title = panel.querySelector(".date-picker__title").textContent.trim();
        panel.querySelector('.date-picker__nav[aria-label="下個月"]').click();
        await new Promise((r) => setTimeout(r, 200));
        const next = panel.querySelector(".date-picker__title").textContent.trim();
        panel.querySelector(".date-picker__day.is-outside").click();
        await new Promise((r) => setTimeout(r, 300));
        return {
          before,
          title,
          next,
          after: trigger.textContent.replace(/\\s+/g, ""),
          nativeDateInputs: document.querySelectorAll('.modal input[type="date"]').length,
        };
      })()
    `);
    assert(!date.error, date.error);
    assert(date.nativeDateInputs === 0, "the sheet still renders a native date input");
    assert(date.title !== date.next, `month navigation did nothing (${date.title})`);
    assert(date.after !== date.before, `picking a day did not change the date (${date.after})`);

    // user-defined category: add → selected → persisted in settings → removable
    const category = await evaluate(`
      (async () => {
        const add = Array.from(document.querySelectorAll(".modal .category-chip__main")).find(
          (el) => el.textContent.includes("自訂"),
        );
        add.click();
        await new Promise((r) => setTimeout(r, 250));
        const input = document.querySelector(".category-add input");
        if (!input) return { error: "no category input" };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, "E2E 分類");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        Array.from(document.querySelectorAll(".category-add .btn"))
          .find((el) => el.textContent.trim() === "新增")
          .click();
        await new Promise((r) => setTimeout(r, 700));
        return {
          chips: Array.from(document.querySelectorAll(".modal .category-chip__main")).map((el) => el.textContent.trim()),
          selected: document.querySelector(".modal .category-chip.is-active .category-chip__main")?.textContent.trim(),
        };
      })()
    `);
    assert(!category.error, category.error);
    assert(category.chips.includes("E2E 分類"), `chips = ${category.chips.join(",")}`);
    assert(category.selected === "E2E 分類", `selected category = ${category.selected}`);

    const stored = await invoke("load_app").then((data) => data.settings.eventCategories);
    assert(
      JSON.parse(stored || "[]").includes("E2E 分類"),
      `stored categories = ${stored}`,
    );

    // cleanup so the database keeps only the user's own categories
    await evaluate(`
      (async () => {
        const remove = document.querySelector(".modal .category-chip__remove");
        if (remove) {
          remove.click();
          await new Promise((r) => setTimeout(r, 700));
        }
        const cancel = Array.from(document.querySelectorAll(".modal button")).find(
          (el) => el.textContent.trim() === "取消",
        );
        if (cancel) cancel.click();
        await new Promise((r) => setTimeout(r, 300));
      })()
    `);
    const after = await invoke("load_app").then((data) => data.settings.eventCategories);
    assert(
      !JSON.parse(after || "[]").includes("E2E 分類"),
      `category was not removed: ${after}`,
    );
    return "no native select/date · 09:00→14:30 + date via in-app pickers · custom category saved + removed";
  });

  await test("ui/home-agenda", async () => {
    const isoOffset = (days) =>
      evaluate(`(() => { const d = new Date(); d.setDate(d.getDate() + ${days}); const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })()`);
    const tomorrow = await isoOffset(1);
    const tenDays = await isoOffset(10);
    const weekday = await evaluate("new Date().getDay() === 0 ? 7 : new Date().getDay()");

    const showHome = async () => {
      await evaluate(`document.querySelectorAll(".nav__item")[0].click()`);
      await new Promise((resolve) => setTimeout(resolve, 600));
    };

    const read = () =>
      evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll(".agenda-row")).map((row) => ({
          title: row.querySelector(".agenda-row__title")?.textContent.trim(),
          countdown: row.querySelector(".agenda-row__countdown")?.textContent.trim(),
          dot: !!row.querySelector(".agenda-row__dot"),
        }));
        return {
          rows,
          order: localStorage.getItem("reciprocal.homeEventOrder"),
          heroCard: !!document.querySelector(".home-now"),
          empty: document.querySelector(".home__empty-title")?.textContent.trim() ?? null,
          peekLabel: document.querySelector(".timetable-peek__label")?.textContent.trim() ?? null,
          peekTitle: document.querySelector(".timetable-peek__title")?.textContent.trim() ?? null,
          sheetRows: document.querySelectorAll(".timetable-sheet__row").length,
        };
      })()`);

    // clean slate: no events/blocks, 7-day range, no custom order
    const loaded = await invoke("load_app");
    for (const event of loaded.events) await invoke("delete_event", { id: event.id });
    for (const block of loaded.timetable) await invoke("delete_timetable", { id: block.id });
    await invoke("set_setting", { key: "homeEventRangeDays", value: "7" });
    await evaluate(`localStorage.removeItem("reciprocal.homeEventOrder")`);

    const near = await invoke("save_event", {
      event: { title: "E2E 明天的行程", date: tomorrow, startTime: "09:00", endTime: "10:00", allDay: false, color: "#5B7DB1", category: "工作" },
    });
    const fiveDays = await isoOffset(5);
    const far = await invoke("save_event", {
      event: { title: "E2E 十天後", date: tenDays, startTime: "10:00", endTime: "11:00", allDay: false, color: "#3F7C6A", category: "工作" },
    });
    const middle = await invoke("save_event", {
      event: { title: "E2E 五天後", date: fiveDays, startTime: "11:00", endTime: "12:00", allDay: false, color: "#D98A5F", category: "個人" },
    });

    await reloadApp();
    await showHome();
    let state = await read();
    assert(!state.heroCard, "the old hero card should be gone (uniform rows only)");
    assert(
      state.rows.length === 2 &&
        !state.rows.some((row) => row.title === "E2E 十天後"),
      `7-day rows = ${state.rows.map((row) => row.title).join(",")}`,
    );
    assert(state.rows[0].title === "E2E 明天的行程", `first row = ${state.rows[0].title}`);
    assert(
      state.rows[0].countdown && /後$/.test(state.rows[0].countdown),
      `countdown = ${state.rows[0].countdown}`,
    );
    assert(!state.rows[0].dot, "the colour dot should be gone");
    // no date/time anywhere on the row — only the name and the countdown
    const rowTexts = await evaluate(`Array.from(document.querySelectorAll(".agenda-row")).map((row) => row.textContent.replace(/\\s+/g, ""))`);
    assert(
      rowTexts.every((text) => !/\d+月\d+日|\d{2}:\d{2}/.test(text)),
      `rows still show dates/times: ${rowTexts.join(" | ")}`,
    );

    // a very long title must wrap, never scroll sideways
    const longTitle = await invoke("save_event", {
      event: {
        title: "這是一個非常非常長的行程名稱用來測試卡片文字太長的時候會不會像廣告一樣左右滾動",
        date: tenDays,
        startTime: "13:00",
        endTime: "14:00",
        allDay: false,
        color: "#B06AA0",
        category: "工作",
      },
    });
    const shortTitle = await invoke("save_event", {
      event: { title: "午餐", date: tenDays, startTime: "15:00", endTime: "16:00", allDay: false, color: "#3F7C6A", category: "個人" },
    });
    await invoke("set_setting", { key: "homeEventRangeDays", value: "14" });
    await reloadApp();
    await showHome();
    const longTitleState = await evaluate(`(() => {
      const doc = document.documentElement;
      const scroller = document.querySelector('.view-panel[data-active="true"]');
      const title = Array.from(document.querySelectorAll(".agenda-row__title")).find((el) => el.textContent.includes("非常非常長"));
      const short = Array.from(document.querySelectorAll(".agenda-row__title")).find((el) => el.textContent.trim() === "午餐");
      return {
        docOverflowX: doc.scrollWidth - doc.clientWidth,
        scrollOverflowX: scroller ? scroller.scrollWidth - scroller.clientWidth : -1,
        titleHeight: title ? Math.round(title.getBoundingClientRect().height) : 0,
        lineHeight: title ? parseFloat(getComputedStyle(title).lineHeight) || 20 : 0,
        nowrap: title ? getComputedStyle(title).whiteSpace : null,
        longFont: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
        longWrapped: title ? title.classList.contains("auto-fit--wrap") : false,
        shortFont: short ? parseFloat(getComputedStyle(short).fontSize) : 0,
        titleHalf: (() => {
          const row = title?.closest(".agenda-row");
          const rowRect = row?.getBoundingClientRect();
          const rect = title?.getBoundingClientRect();
          if (!rowRect || !rect) return 0;
          return Math.round((rect.width / rowRect.width) * 100);
        })(),
      };
    })()`);
    assert(longTitleState.docOverflowX <= 0, `the page scrolls sideways by ${longTitleState.docOverflowX}px`);
    assert(
      longTitleState.scrollOverflowX <= 0,
      `the agenda scrolls sideways by ${longTitleState.scrollOverflowX}px`,
    );
    assert(longTitleState.nowrap !== "nowrap", "long titles must wrap instead of marquee");
    assert(
      longTitleState.titleHeight <= longTitleState.lineHeight * 2.2,
      `long title grew to ${longTitleState.titleHeight}px (more than two lines)`,
    );
    assert(
      longTitleState.shortFont >= 19,
      `short titles should use the maximum size (got ${longTitleState.shortFont}px)`,
    );
    assert(
      longTitleState.longFont >= 14 && longTitleState.longFont <= 16,
      `long titles should shrink towards the floor (got ${longTitleState.longFont}px)`,
    );
    assert(longTitleState.longWrapped === true, "long titles must wrap onto a second line");
    assert(
      longTitleState.titleHalf >= 33 && longTitleState.titleHalf <= 50,
      `title should take about half the row (got ${longTitleState.titleHalf}%)`,
    );
    await invoke("delete_event", { id: longTitle.id });
    await invoke("delete_event", { id: shortTitle.id });

    // widen the range → the far event appears, still uniform rows
    await invoke("set_setting", { key: "homeEventRangeDays", value: "14" });
    await reloadApp();
    await showHome();
    state = await read();
    assert(
      state.rows.some((row) => row.title === "E2E 十天後"),
      `14-day rows = ${state.rows.map((row) => row.title).join(",")}`,
    );
    const viewport = await evaluate(`(() => {
      const scroller = document.querySelector('.view-panel[data-active="true"]');
      const rows = Array.from(document.querySelectorAll(".agenda-row"));
      return {
        overflow: scroller ? scroller.scrollHeight - scroller.clientHeight : -1,
        heights: rows.map((row) => Math.round(row.getBoundingClientRect().height)),
        allVisible: rows.every((row) => row.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom + 1),
      };
    })()`);
    assert(viewport.heights.length === 3, `expected three cards, got ${viewport.heights.length}`);
    assert(
      viewport.heights.every((height) => height >= 80),
      `cards are too small to fill the page: ${viewport.heights.join(",")}`,
    );
    assert(viewport.allVisible, "three cards must fit on one screen without scrolling");
    assert(viewport.overflow <= 2, `the home page scrolls by ${viewport.overflow}px with three cards`);

    // long-press drag the first row below the second → custom order is kept
    const reordered = await evaluate(`
      (async () => {
        const rows = Array.from(document.querySelectorAll(".agenda-row"));
        if (rows.length < 2) return { error: "need two rows" };
        const rect = rows[0].getBoundingClientRect();
        const base = {
          bubbles: true, cancelable: true, pointerId: 41, pointerType: "touch", isPrimary: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        };
        rows[0].dispatchEvent(new PointerEvent("pointerdown", base));
        await new Promise((r) => setTimeout(r, 480));
        const lifted = !!document.querySelector(".agenda-row.is-dragging");
        rows[0].dispatchEvent(new PointerEvent("pointermove", { ...base, clientY: base.clientY + rect.height + 24 }));
        await new Promise((r) => setTimeout(r, 120));
        rows[0].dispatchEvent(new PointerEvent("pointerup", { ...base, clientY: base.clientY + rect.height + 24 }));
        await new Promise((r) => setTimeout(r, 350));
        return {
          lifted,
          order: JSON.parse(localStorage.getItem("reciprocal.homeEventOrder") || "null"),
          domTitles: Array.from(document.querySelectorAll(".agenda-row__title")).map((el) => el.textContent.trim()),
        };
      })()
    `);
    assert(!reordered.error, reordered.error);
    assert(reordered.lifted === true, "long press did not lift the row");
    assert(
      Array.isArray(reordered.order) && reordered.order.length === 3,
      `stored order = ${JSON.stringify(reordered.order)}`,
    );
    assert(
      reordered.domTitles[0] === "E2E 五天後" && reordered.domTitles[1] === "E2E 明天的行程",
      `DOM order after drag = ${reordered.domTitles.join(" → ")}`,
    );

    // the custom order survives a reload
    await reloadApp();
    await showHome();
    state = await read();
    assert(
      state.rows[0].title === "E2E 五天後",
      `custom order was not restored (${state.rows[0].title})`,
    );
    await evaluate(`localStorage.removeItem("reciprocal.homeEventOrder")`);

    // clear everything → empty state, peek still present
    await invoke("delete_event", { id: near.id });
    await invoke("delete_event", { id: far.id });
    await invoke("delete_event", { id: middle.id });
    await invoke("set_setting", { key: "homeEventRangeDays", value: "7" });
    await reloadApp();
    await showHome();
    state = await read();
    assert(state.rows.length === 0, "rows should be empty");
    assert(state.empty && state.empty.includes("沒有行程"), `empty state = ${state.empty}`);
    assert(state.peekLabel, "the fixed-schedule peek row disappeared");

    // fixed-schedule sheet: tap the peek, Escape closes, swipe-up on 時間表 opens it
    const currentWeekday = await evaluate("new Date().getDay() === 0 ? 7 : new Date().getDay()");
    if (currentWeekday <= 5) {
      const block = await invoke("save_timetable", {
        block: { day: currentWeekday, startTime: "00:00", endTime: "23:59", title: "E2E 時段", notes: "", color: "#3F7C6A" },
      });
      await reloadApp();
      await showHome();
      // A 00:00–23:59 block is already over during the last minute of the day, so accept the
      // “nothing scheduled” peek then (the sheet still lists the block, checked below).
      const nowMinutes = await evaluate("new Date().getHours() * 60 + new Date().getMinutes()");
      const nearMidnight = nowMinutes >= 1438;
      const peekLabel = (await read()).peekLabel;
      assert(
        nearMidnight ? peekLabel !== undefined : peekLabel === "現在",
        `peek label = ${peekLabel}`,
      );
      await evaluate(`document.querySelector(".timetable-peek").click()`);
      await new Promise((resolve) => setTimeout(resolve, 450));
      assert((await read()).sheetRows > 0, "tapping the peek did not open the sheet");
      const placement = await evaluate(`(() => {
        const sheet = document.querySelector(".timetable-sheet");
        const nav = document.querySelector(".sidebar");
        const backdrop = document.querySelector(".timetable-sheet-backdrop");
        return {
          sheetBottom: sheet ? Math.round(sheet.getBoundingClientRect().bottom) : null,
          navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
          backdropPosition: backdrop ? getComputedStyle(backdrop).position : null,
          backdropBottom: backdrop ? Math.round(backdrop.getBoundingClientRect().bottom) : null,
          navHeight: nav ? Math.round(nav.getBoundingClientRect().height) : 0,
        };
      })()`);
      assert(
        placement.sheetBottom !== null && placement.sheetBottom <= (placement.navTop ?? 0) + 1,
        `the sheet must sit above the nav (sheet bottom ${placement.sheetBottom}, nav top ${placement.navTop})`,
      );
      assert(
        placement.backdropPosition === "absolute" &&
          placement.backdropBottom <= (placement.navTop ?? 0) + 1,
        "the sheet backdrop must not cover the navigation bar",
      );
      await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert((await read()).sheetRows === 0, "Escape did not close the sheet");

      // swiping the peek row upwards opens it too
      const peekSwipe = await evaluate(`(() => {
        const peek = document.querySelector(".timetable-peek");
        if (!peek) return { error: "no peek row" };
        const rect = peek.getBoundingClientRect();
        const base = {
          bubbles: true, cancelable: true, pointerId: 51, pointerType: "touch", isPrimary: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        };
        peek.dispatchEvent(new PointerEvent("pointerdown", base));
        peek.dispatchEvent(new PointerEvent("pointermove", { ...base, clientY: base.clientY - 30 }));
        peek.dispatchEvent(new PointerEvent("pointerup", { ...base, clientY: base.clientY - 30 }));
        return { ok: true };
      })()`);
      assert(!peekSwipe.error, peekSwipe.error);
      await new Promise((resolve) => setTimeout(resolve, 450));
      assert((await read()).sheetRows > 0, "swiping the peek row up did not open the sheet");
      await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
      await new Promise((resolve) => setTimeout(resolve, 300));

      await evaluate(`(() => {
        const item = document.querySelectorAll(".nav__item")[2];
        const rect = item.getBoundingClientRect();
        const base = {
          bubbles: true, cancelable: true, pointerId: 31, pointerType: "touch", isPrimary: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height - 6,
        };
        item.dispatchEvent(new PointerEvent("pointerdown", base));
        item.dispatchEvent(new PointerEvent("pointermove", { ...base, clientY: base.clientY - 40 }));
        item.dispatchEvent(new PointerEvent("pointerup", { ...base, clientY: base.clientY - 40 }));
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 450));
      assert((await read()).sheetRows > 0, "swiping up on 時間表 did not open the sheet");
      await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
      await invoke("delete_timetable", { id: block.id });
    }

    // the peek row (and its sheet) belongs to the home page only.
    // Wait out the swipe-flag window first: a tap right after the nav swipe is intentionally
    // swallowed by the gesture handler.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const peekVisibility = await evaluate(`(async () => {
      const nav = Array.from(document.querySelectorAll(".nav__item"));
      const peek = document.querySelector(".timetable-peek");
      const measure = () => ({
        hidden: peek.classList.contains("is-hidden"),
        height: Math.round(peek.getBoundingClientRect().height),
      });
      const state = { home: measure() };
      nav[1].click();
      await new Promise((r) => setTimeout(r, 700));
      state.calendar = measure();
      nav[3].click();
      await new Promise((r) => setTimeout(r, 700));
      state.settings = measure();
      nav[2].click();
      await new Promise((r) => setTimeout(r, 700));
      state.timetable = measure();
      nav[0].click();
      await new Promise((r) => setTimeout(r, 700));
      state.homeAgain = measure();
      return state;
    })()`);
    assert(
      !peekVisibility.home.hidden && peekVisibility.home.height > 30,
      `the peek row should be visible on the home page (${JSON.stringify(peekVisibility.home)})`,
    );
    assert(
      peekVisibility.calendar.hidden && peekVisibility.calendar.height === 0,
      `the peek row must collapse on 日曆 (${JSON.stringify(peekVisibility.calendar)})`,
    );
    assert(
      peekVisibility.settings.hidden && peekVisibility.settings.height === 0,
      `the peek row must collapse on 設定 (${JSON.stringify(peekVisibility.settings)})`,
    );
    assert(
      peekVisibility.timetable.hidden && peekVisibility.timetable.height === 0,
      `the peek row must collapse on 時間表 (${JSON.stringify(peekVisibility.timetable)})`,
    );
    assert(
      !peekVisibility.homeAgain.hidden && peekVisibility.homeAgain.height > 30,
      "the peek row should come back with the home page",
    );

    // the header action still opens the event form
    await evaluate(`(() => {
      const button = Array.from(document.querySelectorAll(".home__head button")).find((el) => /新增行程/.test(el.textContent));
      button?.click();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert(await evaluate(`!!document.querySelector(".modal")`), "header 新增行程 did not open the form");
    await evaluate(`Array.from(document.querySelectorAll(".modal button")).find((el) => el.textContent.trim() === "取消")?.click()`);
    return "統一列（名稱＋倒數）· 3 張不滾動 · 7/14 天範圍 · 長按拖曳排序（持久化）· 空狀態 · peek→sheet · 上拉手勢";
  });

  // ---------------------------------------------------------------- screenshots
  await test("ui/screenshots", async () => {
    const views = [
      [0, "android-home"],
      [1, "android-calendar"],
      [2, "android-schedule"],
      [3, "android-settings"],
    ];
    for (const [index, name] of views) {
      await evaluate(`document.querySelectorAll(".nav__item")[${index}].click()`);
      await new Promise((resolve) => setTimeout(resolve, 700));
      await screenshot(name);
    }
    return views.map(([, name]) => name).join(", ");
  });
}

// ---------------------------------------------------------------- main

try {
  await connect();
  await run();
} catch (error) {
  results.push({ name: "harness", ok: false, detail: error?.message || String(error) });
  if (!asJson) console.error(`\nHARNESS ERROR: ${error?.message || error}`);
} finally {
  socket?.close?.();
}

const failed = results.filter((result) => !result.ok);
if (asJson) {
  console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
} else {
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("failed:");
    for (const item of failed) console.log(`  - ${item.name}: ${item.detail}`);
  }
}
process.exit(failed.length > 0 ? 1 : 0);
