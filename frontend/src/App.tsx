import { lazy, Suspense, useEffect, useState } from "react";
import CommandPalette from "./components/CommandPalette";
import type { State } from "./hooks/usePalette";
import { nativeWindowLabel } from "./lib/tauri";

const Dashboard = lazy(() => import("./components/dashboard/Dashboard"));

const isDashboard = () => location.hash.startsWith("#/dashboard") || nativeWindowLabel() === "dashboard";

/** Same app, two windows: the quick palette (default) and the full Dashboard at #/dashboard. */
export default function App({ initial }: { initial?: Partial<State> }) {
  const [dashboard, setDashboard] = useState(isDashboard);
  useEffect(() => {
    const on = () => setDashboard(isDashboard());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("dash", dashboard); }, [dashboard]);

  return dashboard ? <Suspense fallback={null}><Dashboard /></Suspense> : <CommandPalette initial={initial} />;
}
