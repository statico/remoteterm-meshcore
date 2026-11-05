import { createContext, useContext, useMemo, type ReactNode } from 'react';

interface PathHopWidthContextValue {
  showPathHopWidth: boolean;
  setShowPathHopWidth: (enabled: boolean) => void;
}

const noop = () => {};

const PathHopWidthContext = createContext<PathHopWidthContextValue>({
  showPathHopWidth: false,
  setShowPathHopWidth: noop,
});

export function PathHopWidthProvider({
  showPathHopWidth,
  setShowPathHopWidth,
  children,
}: PathHopWidthContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ showPathHopWidth, setShowPathHopWidth }),
    [showPathHopWidth, setShowPathHopWidth]
  );
  return <PathHopWidthContext.Provider value={value}>{children}</PathHopWidthContext.Provider>;
}

export function usePathHopWidth() {
  return useContext(PathHopWidthContext);
}
