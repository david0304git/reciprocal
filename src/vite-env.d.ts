/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

/** Injected by web/public/tauri-shim.js when the app runs inside the Android WebView. */
interface Window {
  __reciprocalAndroid?: boolean;
  /** Real system night mode, provided by MainActivity (see UiHost.isSystemDark). */
  __reciprocalSystemDark?: () => boolean;
  /** Cancelable "back" hook used by the Android back button. */
  __reciprocalBack?: () => boolean;
}
