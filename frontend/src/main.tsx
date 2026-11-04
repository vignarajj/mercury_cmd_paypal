import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { isTauri } from "./lib/tauri";
import { showcaseFromUrl } from "./showcase";

// Web mode (browser, no native window): the CSS paints its own backdrop and keeps the palette on screen.
if (!isTauri) document.documentElement.classList.add("web");

const seed = import.meta.env.DEV ? showcaseFromUrl() : undefined; // screenshot scenes never ship in a production build

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App initial={seed ?? undefined} />
  </React.StrictMode>,
);
