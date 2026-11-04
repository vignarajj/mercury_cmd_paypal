import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { isTauri } from "./lib/tauri";

// Web mode (browser, no native window): the CSS paints its own backdrop and keeps the palette on screen.
if (!isTauri) document.documentElement.classList.add("web");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
