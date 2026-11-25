/*
 * Reciprocal — Android bridge shim.
 *
 * The bundled frontend is the unmodified Tauri/React app: it talks to its backend through
 * `@tauri-apps/api`'s `invoke()`. On Android there is no Tauri runtime, so this shim provides the
 * `window.__TAURI_INTERNALS__` object Tauri would have installed and forwards every command to the
 * Kotlin bridge (`ReciprocalNative`), which answers through `window.__reciprocalNativeResolve`.
 *
 * Loaded synchronously from index.html *before* the app module, so `isTauri` in lib/api.ts is
 * already true when React boots.
 *
 * When the Kotlin bridge is absent (plain browser preview) the shim stays inert and the app falls
 * back to its built-in mock data — handy for UI work.
 */
(function () {
  "use strict";

  var native = window.ReciprocalNative;
  if (!native) {
    window.__reciprocalAndroid = false;
    return;
  }

  window.__reciprocalAndroid = true;
  document.documentElement.dataset.platform = "android";

  var pending = Object.create(null);
  var nextRequestId = 0;

  window.__reciprocalNativeResolve = function (id, ok, payloadJson) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];
    var value;
    try {
      value = JSON.parse(payloadJson);
    } catch (error) {
      value = payloadJson;
    }
    if (ok) entry.resolve(value);
    else entry.reject(value);
  };

  function invoke(command, args) {
    return new Promise(function (resolve, reject) {
      var id = ++nextRequestId;
      pending[id] = { resolve: resolve, reject: reject };
      try {
        native.invoke(String(id), String(command), JSON.stringify(args || {}));
      } catch (error) {
        delete pending[id];
        reject(String((error && error.message) || error));
      }
    });
  }

  // Count the first load so the native log mirrors the desktop "ui ready: N habits" line.
  var rawInvoke = invoke;
  invoke = function (command, args) {
    var promise = rawInvoke(command, args);
    if (command === "load_app") {
      promise.then(function (data) {
        try {
          native.ready(
            (data.habits || []).length +
              " habits, " +
              (data.logs || []).length +
              " logs, " +
              (data.tasks || []).length +
              " tasks",
          );
        } catch (error) {
          /* logging only */
        }
      });
    }
    return promise;
  };

  window.__TAURI_INTERNALS__ = {
    invoke: function (command, args) {
      return invoke(command, args);
    },
    transformCallback: function (callback, once) {
      var id = ++nextRequestId;
      window["_" + id] = function (payload) {
        if (once) delete window["_" + id];
        callback(payload);
      };
      return id;
    },
    unregisterCallback: function (id) {
      delete window["_" + id];
    },
    convertFileSrc: function (path) {
      return path;
    },
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
      windows: [{ label: "main" }],
      webviews: [{ label: "main" }],
    },
  };

  /*
   * Android hardware/virtual back button.
   *
   * Order: close an open modal (the UI closes on Escape), then let the app navigate back to the home
   * view via a cancelable event; returns true when the press was consumed so Kotlin does not finish
   * the Activity.
   */
  window.__reciprocalBack = function () {
    if (document.querySelector(".modal-backdrop")) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    }
    var event = new CustomEvent("reciprocal:back", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  // The Android WebView reports `prefers-color-scheme: light` regardless of the system setting
  // (the activity uses a Light theme), so the shell exposes the real night mode for "auto".
  window.__reciprocalSystemDark = function () {
    try {
      return !!(window.ReciprocalHost && window.ReciprocalHost.isSystemDark());
    } catch (error) {
      return false;
    }
  };

  // Called by MainActivity when the system theme changes; the app re-resolves its own theme.
  window.__reciprocalSystemThemeChanged = function () {
    window.dispatchEvent(new CustomEvent("reciprocal:system-theme"));
  };

  // Keep the native system bars in sync with the app theme (the app follows light/dark itself).
  function reportTheme() {
    var dark = document.documentElement.dataset.theme === "dark";
    try {
      window.ReciprocalHost.setDarkMode(dark);
    } catch (error) {
      /* host may not expose it */
    }
  }

  new MutationObserver(reportTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", reportTheme);
  } else {
    reportTheme();
  }

  // Belt and braces: never let a stray navigation leave the app origin.
  document.addEventListener("click", function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    var href = anchor.getAttribute("href") || "";
    if (href.startsWith("http")) {
      event.preventDefault();
      try {
        window.ReciprocalNative.invoke(
          String(++nextRequestId),
          "open_external",
          JSON.stringify({ url: href }),
        );
      } catch (error) {
        /* ignore */
      }
    }
  });
})();
