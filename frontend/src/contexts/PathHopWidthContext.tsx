import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { getBoolPreference, setBoolPreference } from '../utils/boolPreference';

// Browser-local preference for showing the per-hop byte width (e.g. "2B") next
// to the hop-count badge on received messages. Off by default.
export const SHOW_PATH_HOP_WIDTH_KEY = 'remoteterm-show-path-hop-width';

interface PathHopWidthContextValue {
  showPathHopWidth: boolean;
  setShowPathHopWidth: (enabled: boolean) => void;
}

const PathHopWidthContext = createContext<PathHopWidthContextValue>({
  showPathHopWidth: false,
  setShowPathHopWidth: () => {},
});

export function PathHopWidthProvider({ children }: { children: ReactNode }) {
  const [showPathHopWidth, setState] = useState(() => getBoolPreference(SHOW_PATH_HOP_WIDTH_KEY));
  const setShowPathHopWidth = useCallback((enabled: boolean) => {
    setState(enabled);
    setBoolPreference(SHOW_PATH_HOP_WIDTH_KEY, enabled);
  }, []);
  const value = useMemo(
    () => ({ showPathHopWidth, setShowPathHopWidth }),
    [showPathHopWidth, setShowPathHopWidth]
  );
  return <PathHopWidthContext.Provider value={value}>{children}</PathHopWidthContext.Provider>;
}

export function usePathHopWidth() {
  return useContext(PathHopWidthContext);
}
