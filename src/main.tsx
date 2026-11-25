import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";

const platform = /Windows/i.test(navigator.userAgent)
  ? "windows"
  : /Mac/i.test(navigator.userAgent)
    ? "macos"
    : "other";
document.documentElement.dataset.platform = platform;
let cachedUiStyle = "paper";
try {
  const storedUiStyle = localStorage.getItem("reciprocal.uiStyle");
  if (storedUiStyle === "glass" || storedUiStyle === "swiss") {
    cachedUiStyle = storedUiStyle;
  }
} catch {
  /* storage may be unavailable */
}
document.documentElement.dataset.uiStyle = cachedUiStyle;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
