import CommandPalette from "./components/CommandPalette";
import type { State } from "./hooks/usePalette";

export default function App({ initial }: { initial?: Partial<State> }) {
  return <CommandPalette initial={initial} />;
}
