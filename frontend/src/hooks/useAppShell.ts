import { startTransition, useCallback, useEffect, useRef, useState } from 'react';

import { getLocalLabel, type LocalLabel } from '../utils/localLabel';
import type { SettingsSection } from '../components/settings/settingsConstants';
import { parseHashSettingsSection, updateSettingsHash, pushSettingsHash } from '../utils/urlHash';

interface UseAppShellResult {
  showNewMessage: boolean;
  showSettings: boolean;
  settingsSection: SettingsSection;
  sidebarOpen: boolean;
  showCracker: boolean;
  crackerRunning: boolean;
  localLabel: LocalLabel;
  setSettingsSection: (section: SettingsSection) => void;
  setSidebarOpen: (open: boolean) => void;
  setCrackerRunning: (running: boolean) => void;
  setLocalLabel: (label: LocalLabel) => void;
  handleCloseSettingsView: () => void;
  handleToggleSettingsView: () => void;
  handleOpenNewMessage: () => void;
  handleCloseNewMessage: () => void;
  handleToggleCracker: () => void;
}

export function useAppShell(): UseAppShellResult {
  const initialSettingsSection = typeof window === 'undefined' ? null : parseHashSettingsSection();
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [showSettings, setShowSettings] = useState(() => initialSettingsSection !== null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(
    () => initialSettingsSection ?? 'radio'
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showCracker, setShowCracker] = useState(false);
  const [crackerRunning, setCrackerRunning] = useState(false);
  const [localLabel, setLocalLabel] = useState(getLocalLabel);
  const previousHashRef = useRef('');
  const isOpeningSettingsRef = useRef(false);
  const pushedSettingsEntryRef = useRef(false);

  useEffect(() => {
    if (showSettings) {
      if (isOpeningSettingsRef.current) {
        pushSettingsHash(settingsSection);
        isOpeningSettingsRef.current = false;
      } else {
        updateSettingsHash(settingsSection);
      }
    }
  }, [settingsSection, showSettings]);

  const handleCloseSettingsView = useCallback(() => {
    startTransition(() => setShowSettings(false));
    setSidebarOpen(false);
    if (typeof window !== 'undefined') {
      if (pushedSettingsEntryRef.current) {
        pushedSettingsEntryRef.current = false;
        window.history.back();
      } else if (parseHashSettingsSection() !== null) {
        window.history.replaceState(null, '', previousHashRef.current || window.location.pathname);
      }
    }
  }, []);

  const handleToggleSettingsView = useCallback(() => {
    if (showSettings) {
      handleCloseSettingsView();
      return;
    }

    if (typeof window !== 'undefined') {
      previousHashRef.current =
        parseHashSettingsSection() === null ? window.location.hash : previousHashRef.current;
    }
    isOpeningSettingsRef.current = true;
    pushedSettingsEntryRef.current = true;
    startTransition(() => {
      setShowSettings(true);
    });
    setSidebarOpen(false);
  }, [handleCloseSettingsView, showSettings]);

  // Respond to browser back/forward navigating into or out of settings
  useEffect(() => {
    const handlePopstate = () => {
      const section = parseHashSettingsSection();
      if (section !== null) {
        // Don't set pushedSettingsEntryRef here — the user arrived via
        // back/forward, not by opening settings.  Closing settings should
        // replaceState, not history.back(), to avoid popping an unrelated entry.
        startTransition(() => {
          setShowSettings(true);
          setSettingsSection(section);
        });
      } else {
        startTransition(() => setShowSettings(false));
      }
    };

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, []);

  const handleOpenNewMessage = useCallback(() => {
    setShowNewMessage(true);
    setSidebarOpen(false);
  }, []);

  const handleCloseNewMessage = useCallback(() => {
    setShowNewMessage(false);
  }, []);

  const handleToggleCracker = useCallback(() => {
    setShowCracker((prev) => !prev);
  }, []);

  return {
    showNewMessage,
    showSettings,
    settingsSection,
    sidebarOpen,
    showCracker,
    crackerRunning,
    localLabel,
    setSettingsSection,
    setSidebarOpen,
    setCrackerRunning,
    setLocalLabel,
    handleCloseSettingsView,
    handleToggleSettingsView,
    handleOpenNewMessage,
    handleCloseNewMessage,
    handleToggleCracker,
  };
}
