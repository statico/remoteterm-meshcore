import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { getBoolPreference, setBoolPreference } from '../utils/boolPreference';

// Browser-local preference for rendering MeshCore Open rich-chat payloads
// (Giphy GIFs and emoji reactions) instead of their raw encoded text. GIF
// rendering fetches images from media.giphy.com, so it is off by default.
export const RENDER_RICH_PAYLOADS_KEY = 'remoteterm-render-rich-payloads';

interface RichPayloadContextValue {
  renderRichPayloads: boolean;
  setRenderRichPayloads: (enabled: boolean) => void;
}

const RichPayloadContext = createContext<RichPayloadContextValue>({
  renderRichPayloads: false,
  setRenderRichPayloads: () => {},
});

export function RichPayloadProvider({ children }: { children: ReactNode }) {
  const [renderRichPayloads, setState] = useState(() =>
    getBoolPreference(RENDER_RICH_PAYLOADS_KEY)
  );
  const setRenderRichPayloads = useCallback((enabled: boolean) => {
    setState(enabled);
    setBoolPreference(RENDER_RICH_PAYLOADS_KEY, enabled);
  }, []);
  const value = useMemo(
    () => ({ renderRichPayloads, setRenderRichPayloads }),
    [renderRichPayloads, setRenderRichPayloads]
  );
  return <RichPayloadContext.Provider value={value}>{children}</RichPayloadContext.Provider>;
}

export function useRichPayloads() {
  return useContext(RichPayloadContext);
}
