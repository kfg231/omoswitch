import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initI18n } from "./i18n";
import "./index.css";

if (import.meta.env.VITE_MOCK_IPC === "1") {
  const { installMockIpc } = await import("./lib/mockIpc");
  installMockIpc();
}

initI18n();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
