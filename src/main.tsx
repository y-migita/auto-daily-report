import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/zen-maru-gothic";
import App from "./App";
import "./App.css";

// 開発モード時はテキスト選択を許可
if (import.meta.env.DEV) {
  document.body.classList.add("dev-mode");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
