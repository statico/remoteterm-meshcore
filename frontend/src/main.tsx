import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import './themes.css';
import './styles.css';
import { getSavedTheme, applyTheme, initFollowOSListener } from './utils/theme';
import { applyFontScale, getSavedFontScale } from './utils/fontScale';
import { PushSubscriptionProvider } from './contexts/PushSubscriptionContext';
import { DistanceUnitProvider } from './contexts/DistanceUnitContext';
import { PathHopWidthProvider } from './contexts/PathHopWidthContext';
import { RichPayloadProvider } from './contexts/RichPayloadContext';

// Apply saved theme before first render
applyTheme(getSavedTheme());
// Re-apply when the OS color-scheme preference changes, if on "Follow OS".
initFollowOSListener();
applyFontScale(getSavedFontScale());

// A tab opened before a redeploy asks for lazy chunks whose hashed names no
// longer exist. Reload to pick up the new build instead of blanking the app;
// the timestamp guard stops a reload loop if the chunk is truly missing.
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem('chunkReloadAt') || 0);
  if (Date.now() - last < 10_000) return;
  event.preventDefault();
  sessionStorage.setItem('chunkReloadAt', String(Date.now()));
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PushSubscriptionProvider>
      <DistanceUnitProvider>
        <RichPayloadProvider>
          <PathHopWidthProvider>
            <App />
          </PathHopWidthProvider>
        </RichPayloadProvider>
      </DistanceUnitProvider>
    </PushSubscriptionProvider>
  </StrictMode>
);

// Register service worker for Web Push (requires secure context)
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.warn('Service worker registration failed:', err);
  });
}
