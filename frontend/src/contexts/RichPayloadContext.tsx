import { createContext, useContext, useMemo, type ReactNode } from 'react';

interface RichPayloadContextValue {
  renderRichPayloads: boolean;
  setRenderRichPayloads: (enabled: boolean) => void;
}

const noop = () => {};

const RichPayloadContext = createContext<RichPayloadContextValue>({
  renderRichPayloads: false,
  setRenderRichPayloads: noop,
});

export function RichPayloadProvider({
  renderRichPayloads,
  setRenderRichPayloads,
  children,
}: RichPayloadContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ renderRichPayloads, setRenderRichPayloads }),
    [renderRichPayloads, setRenderRichPayloads]
  );
  return <RichPayloadContext.Provider value={value}>{children}</RichPayloadContext.Provider>;
}

export function useRichPayloads() {
  return useContext(RichPayloadContext);
}
