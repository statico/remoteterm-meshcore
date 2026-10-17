import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Loader2, RefreshCw, Wrench } from 'lucide-react';

import { api } from '../api';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import type {
  Contact,
  PaneState,
  RepeaterAclResponse,
  RepeaterLppTelemetryResponse,
  RepeaterStatusResponse,
} from '../types';
import { TelemetryPane } from './repeater/RepeaterTelemetryPane';
import { AclPane } from './repeater/RepeaterAclPane';
import { LppTelemetryPane } from './repeater/RepeaterLppTelemetryPane';
import { ConsolePane } from './repeater/RepeaterConsolePane';
import { RepeaterLogin } from './RepeaterLogin';
import { useRememberedServerPassword } from '../hooks/useRememberedServerPassword';
import {
  buildServerLoginAttemptFromError,
  buildServerLoginAttemptFromResponse,
  type ServerLoginAttemptState,
} from '../utils/serverLoginState';

interface RoomServerPanelProps {
  contact: Contact;
  /** received_at (epoch seconds) of the newest incoming post in this room. */
  lastPostAt?: number;
  /**
   * Header slot to render the sync/tools controls into. Omitted renders them
   * inline; null (slot not mounted yet) renders nothing.
   */
  toolbarTarget?: HTMLElement | null;
  onAuthenticatedChange?: (authenticated: boolean) => void;
}

type RoomPaneKey = 'status' | 'acl' | 'lppTelemetry';

type RoomPaneData = {
  status: RepeaterStatusResponse | null;
  acl: RepeaterAclResponse | null;
  lppTelemetry: RepeaterLppTelemetryResponse | null;
};

type RoomPaneStates = Record<RoomPaneKey, PaneState>;

type ConsoleEntry = {
  command: string;
  response: string;
  timestamp: number;
  outgoing: boolean;
};

const INITIAL_PANE_STATE: PaneState = {
  loading: false,
  attempt: 0,
  error: null,
  fetched_at: null,
};

function createInitialPaneStates(): RoomPaneStates {
  return {
    status: { ...INITIAL_PANE_STATE },
    acl: { ...INITIAL_PANE_STATE },
    lppTelemetry: { ...INITIAL_PANE_STATE },
  };
}

function createInitialPaneData(): RoomPaneData {
  return { status: null, acl: null, lppTelemetry: null };
}

// ---------------------------------------------------------------------------
// In-memory LRU cache so room login state survives conversation switches
// ---------------------------------------------------------------------------

interface RoomCacheEntry {
  authenticated: boolean;
  loginError: string | null;
  lastLoginAttempt: ServerLoginAttemptState | null;
  paneData: RoomPaneData;
  paneStates: RoomPaneStates;
  consoleHistory: ConsoleEntry[];
}

const MAX_CACHED_ROOMS = 8;
const roomCache = new Map<string, RoomCacheEntry>();

function getCachedRoom(publicKey: string): RoomCacheEntry | null {
  const cached = roomCache.get(publicKey);
  if (!cached) return null;
  // Touch for LRU
  roomCache.delete(publicKey);
  roomCache.set(publicKey, cached);
  return {
    ...cached,
    paneData: { ...cached.paneData },
    paneStates: {
      status: { ...cached.paneStates.status, loading: false },
      acl: { ...cached.paneStates.acl, loading: false },
      lppTelemetry: { ...cached.paneStates.lppTelemetry, loading: false },
    },
    consoleHistory: cached.consoleHistory.map((e) => ({ ...e })),
  };
}

function setCachedRoom(publicKey: string, entry: RoomCacheEntry) {
  roomCache.delete(publicKey);
  roomCache.set(publicKey, {
    ...entry,
    paneData: { ...entry.paneData },
    paneStates: {
      status: { ...entry.paneStates.status, loading: false },
      acl: { ...entry.paneStates.acl, loading: false },
      lppTelemetry: { ...entry.paneStates.lppTelemetry, loading: false },
    },
    consoleHistory: entry.consoleHistory.map((e) => ({ ...e })),
  });
  if (roomCache.size > MAX_CACHED_ROOMS) {
    const lruKey = roomCache.keys().next().value as string | undefined;
    if (lruKey) roomCache.delete(lruKey);
  }
}

// ---------------------------------------------------------------------------
// Persisted sync time: a room we have logged into once opens straight to chat
// ---------------------------------------------------------------------------

const LAST_SYNC_KEY_PREFIX = 'remoteterm-room-last-sync';
// The room server keeps pushing new posts to members on its own; a re-login
// only wakes a push loop that gave up on us, so it needn't run on every open.
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;

function loadLastSync(publicKey: string): number | null {
  try {
    const value = Number(localStorage.getItem(`${LAST_SYNC_KEY_PREFIX}:${publicKey}`));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

function saveLastSync(publicKey: string, at: number | null) {
  try {
    const key = `${LAST_SYNC_KEY_PREFIX}:${publicKey}`;
    if (at === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(at));
  } catch {
    // localStorage may be unavailable
  }
}

export function resetRoomCacheForTests() {
  roomCache.clear();
}

export function RoomServerPanel({
  contact,
  lastPostAt = 0,
  toolbarTarget,
  onAuthenticatedChange,
}: RoomServerPanelProps) {
  const {
    password,
    storedPassword,
    setPassword,
    rememberPassword,
    setRememberPassword,
    persistAfterLogin,
    forgetPassword,
  } = useRememberedServerPassword('room', contact.public_key);

  const cached = useMemo(() => getCachedRoom(contact.public_key), [contact.public_key]);

  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(cached?.loginError ?? null);
  const [authenticated, setAuthenticated] = useState(
    () => cached?.authenticated ?? loadLastSync(contact.public_key) !== null
  );
  const [lastLoginAttempt, setLastLoginAttempt] = useState<ServerLoginAttemptState | null>(
    cached?.lastLoginAttempt ?? null
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [paneData, setPaneData] = useState<RoomPaneData>(cached?.paneData ?? createInitialPaneData);
  const [paneStates, setPaneStates] = useState<RoomPaneStates>(
    cached?.paneStates ?? createInitialPaneStates
  );
  const [consoleHistory, setConsoleHistory] = useState<ConsoleEntry[]>(
    cached?.consoleHistory ?? []
  );
  const [consoleLoading, setConsoleLoading] = useState(false);

  // Persist to cache on every state change
  useEffect(() => {
    setCachedRoom(contact.public_key, {
      authenticated,
      loginError,
      lastLoginAttempt,
      paneData,
      paneStates,
      consoleHistory,
    });
  }, [
    contact.public_key,
    authenticated,
    loginError,
    lastLoginAttempt,
    paneData,
    paneStates,
    consoleHistory,
  ]);

  useEffect(() => {
    onAuthenticatedChange?.(authenticated);
  }, [authenticated, onAuthenticatedChange]);

  const refreshPane = useCallback(
    async <K extends RoomPaneKey>(pane: K, loader: () => Promise<RoomPaneData[K]>) => {
      setPaneStates((prev) => ({
        ...prev,
        [pane]: {
          ...prev[pane],
          loading: true,
          attempt: prev[pane].attempt + 1,
          error: null,
        },
      }));

      try {
        const data = await loader();
        setPaneData((prev) => ({ ...prev, [pane]: data }));
        setPaneStates((prev) => ({
          ...prev,
          [pane]: {
            loading: false,
            attempt: prev[pane].attempt,
            error: null,
            fetched_at: Date.now(),
          },
        }));
      } catch (err) {
        setPaneStates((prev) => ({
          ...prev,
          [pane]: {
            ...prev[pane],
            loading: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          },
        }));
      }
    },
    []
  );

  // Bumped by Cancel so a login still in flight lands on deaf ears.
  // ponytail: the backend request is not aborted; it holds the radio until its
  // own timeout. Add an abortable endpoint if that wait starts to bite.
  const loginAttemptRef = useRef(0);
  const performLogin = useCallback(
    async (nextPassword: string, method: 'password' | 'blank') => {
      if (loginLoading) return;

      const attempt = ++loginAttemptRef.current;
      setLoginLoading(true);
      setLoginError(null);
      // Stamped with the send time so posts the login itself triggers (which
      // land while we wait) count as confirmation below.
      const sentAt = Date.now();
      try {
        const result = await api.roomLogin(contact.public_key, nextPassword);
        if (attempt !== loginAttemptRef.current) return;
        const loginAttempt = buildServerLoginAttemptFromResponse(method, result, 'room server');
        setLastLoginAttempt({ ...loginAttempt, at: sentAt });
        if (!result.authenticated && result.status !== 'timeout') {
          // The room answered and said no: back to the form with its reason.
          setAuthenticated(false);
          setLoginError(loginAttempt.details ?? loginAttempt.summary);
          return;
        }
        setAuthenticated(true);
        // A lost reply is the usual timeout on a busy mesh; remember the room
        // so a reload opens to chat instead of the login form.
        saveLastSync(contact.public_key, sentAt);
      } catch (err) {
        if (attempt !== loginAttemptRef.current) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setLastLoginAttempt({
          ...buildServerLoginAttemptFromError(method, message, 'room server'),
          at: sentAt,
        });
        setAuthenticated(true);
        setLoginError(message);
      } finally {
        if (attempt === loginAttemptRef.current) setLoginLoading(false);
      }
    },
    [contact.public_key, loginLoading]
  );

  const handleCancelLogin = useCallback(() => {
    loginAttemptRef.current++;
    setLoginLoading(false);
    setAuthenticated(false);
  }, []);

  const handleLogin = useCallback(
    async (nextPassword: string) => {
      await performLogin(nextPassword, 'password');
      persistAfterLogin(nextPassword);
    },
    [performLogin, persistAfterLogin]
  );

  // Connect on open with the remembered password, or a blank login (how an
  // existing member or guest gets in), at most once per AUTO_SYNC_INTERVAL_MS.
  // The ref guards the mount and a room left at the login form this session
  // (cancelled or refused) waits for the user: every login is mesh traffic.
  const autoSyncFiredRef = useRef(false);
  useEffect(() => {
    if (autoSyncFiredRef.current) return;
    autoSyncFiredRef.current = true;
    if (cached && !cached.authenticated) return;
    const lastSync = loadLastSync(contact.public_key);
    if (lastSync !== null && Date.now() - lastSync < AUTO_SYNC_INTERVAL_MS) return;
    void performLogin(storedPassword, storedPassword ? 'password' : 'blank');
  }, [cached, contact.public_key, storedPassword, performLogin]);

  // Posts only reach logged-in members, so one arriving after an unconfirmed
  // attempt proves the login landed even though its reply did not.
  useEffect(() => {
    if (!lastLoginAttempt || lastLoginAttempt.outcome === 'confirmed') return;
    if (lastPostAt * 1000 < lastLoginAttempt.at) return;
    setLastLoginAttempt({
      ...lastLoginAttempt,
      outcome: 'confirmed',
      heardBack: true,
      details: null,
    });
    setLoginError(null);
    saveLastSync(contact.public_key, Date.now());
  }, [contact.public_key, lastLoginAttempt, lastPostAt]);

  const handleLoginAsGuest = useCallback(async () => {
    await performLogin('', 'blank');
    persistAfterLogin('');
  }, [performLogin, persistAfterLogin]);

  // Return to the login form (e.g. after a mistyped password).
  const handleReenterPassword = useCallback(() => {
    forgetPassword();
    saveLastSync(contact.public_key, null);
    setAuthenticated(false);
    setLoginError(null);
    setLastLoginAttempt(null);
  }, [contact.public_key, forgetPassword]);

  const handleConsoleCommand = useCallback(
    async (command: string) => {
      setConsoleLoading(true);
      const timestamp = Date.now();
      setConsoleHistory((prev) => [
        ...prev,
        { command, response: command, timestamp, outgoing: true },
      ]);
      try {
        const response = await api.sendRepeaterCommand(contact.public_key, command);
        setConsoleHistory((prev) => [
          ...prev,
          {
            command,
            response: response.response,
            timestamp: Date.now(),
            outgoing: false,
          },
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setConsoleHistory((prev) => [
          ...prev,
          {
            command,
            response: `(error) ${message}`,
            timestamp: Date.now(),
            outgoing: false,
          },
        ]);
      } finally {
        setConsoleLoading(false);
      }
    },
    [contact.public_key]
  );

  const panelTitle = useMemo(() => contact.name || contact.public_key.slice(0, 12), [contact]);
  const loginFailed = lastLoginAttempt !== null && lastLoginAttempt.outcome !== 'confirmed';
  // No reply at all is usually a lost packet, so it reads as pending rather
  // than an error. Change Password stays offered: rooms ignore a bad password
  // silently, so a wrong one looks the same.
  const loginUnanswered = loginFailed && !lastLoginAttempt.heardBack;
  const syncStatus = loginLoading
    ? 'Syncing...'
    : lastLoginAttempt === null
      ? null
      : loginUnanswered
        ? 'No login reply yet'
        : loginFailed
          ? lastLoginAttempt.summary
          : `Synced ${new Date(lastLoginAttempt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const syncStatusTitle = loginUnanswered
    ? 'The room has not answered the login yet. New posts from the room will confirm it.'
    : (lastLoginAttempt?.details ?? undefined);

  if (!authenticated && loginLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Connecting to {panelTitle}...</p>
        <Button type="button" variant="outline" size="sm" onClick={handleCancelLogin}>
          Cancel
        </Button>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
          <RepeaterLogin
            repeaterName={panelTitle}
            loading={loginLoading}
            error={loginError}
            password={password}
            onPasswordChange={setPassword}
            rememberPassword={rememberPassword}
            onRememberPasswordChange={setRememberPassword}
            onLogin={handleLogin}
            onLoginAsGuest={handleLoginAsGuest}
            description="Log in with the room password or use ACL/guest access to enter this room server"
            passwordPlaceholder="Room server password..."
            guestLabel="Login with Existing Access / Guest"
          />
        </div>
      </div>
    );
  }

  const iconButtonClass =
    'p-1 rounded hover:bg-accent text-muted-foreground transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const toolbar = (
    <>
      {syncStatus && (
        <span
          className={cn(
            'mr-1 flex min-w-0 items-center gap-1.5 text-xs',
            loginFailed && !loginUnanswered && !loginLoading
              ? 'text-warning'
              : 'text-muted-foreground'
          )}
          title={syncStatusTitle}
          role="status"
        >
          {loginLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <span
              className={cn(
                'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                loginFailed ? 'bg-warning' : 'bg-status-connected'
              )}
              aria-hidden="true"
            />
          )}
          <span className="hidden truncate sm:inline">{syncStatus}</span>
        </span>
      )}
      {loginFailed && (
        <button
          type="button"
          className={iconButtonClass}
          onClick={handleReenterPassword}
          title="Change password"
          aria-label="Change Password"
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className={iconButtonClass}
        disabled={loginLoading}
        onClick={() => performLogin(password, password.trim() ? 'password' : 'blank')}
        title="Sync now: re-login to ask the room server to resend recent messages"
        aria-label="Sync Now"
      >
        <RefreshCw className={cn('h-4 w-4', loginLoading && 'animate-spin')} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={iconButtonClass}
        onClick={() => setAdvancedOpen((prev) => !prev)}
        title="Room server tools"
        aria-label="Show Tools"
      >
        <Wrench className="h-4 w-4" aria-hidden="true" />
      </button>
    </>
  );

  return (
    <>
      {toolbarTarget === undefined ? (
        <section className="flex items-center justify-end gap-0.5 border-b border-border px-4 py-1.5">
          {toolbar}
        </section>
      ) : (
        toolbarTarget && createPortal(toolbar, toolbarTarget)
      )}
      <Sheet open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <SheetContent side="right" className="w-full sm:max-w-4xl p-0 flex flex-col">
          <SheetHeader className="sr-only">
            <SheetTitle>Room Server Tools</SheetTitle>
            <SheetDescription>
              Room server telemetry, ACL tools, sensor data, and CLI console
            </SheetDescription>
          </SheetHeader>
          <div className="border-b border-border px-4 py-3 pr-14">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">Room Server Tools</h2>
                <p className="text-sm text-muted-foreground">{panelTitle}</p>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid gap-3 xl:grid-cols-2">
              <TelemetryPane
                data={paneData.status}
                state={paneStates.status}
                onRefresh={() => refreshPane('status', () => api.roomStatus(contact.public_key))}
              />
              <AclPane
                data={paneData.acl}
                state={paneStates.acl}
                onRefresh={() => refreshPane('acl', () => api.roomAcl(contact.public_key))}
              />
              <LppTelemetryPane
                data={paneData.lppTelemetry}
                state={paneStates.lppTelemetry}
                onRefresh={() =>
                  refreshPane('lppTelemetry', () => api.roomLppTelemetry(contact.public_key))
                }
              />
              <ConsolePane
                history={consoleHistory}
                loading={consoleLoading}
                onSend={handleConsoleCommand}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
