import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

  const performLogin = useCallback(
    async (nextPassword: string, method: 'password' | 'blank') => {
      if (loginLoading) return;

      setLoginLoading(true);
      setLoginError(null);
      // Stamped with the send time so posts the login itself triggers (which
      // land while we wait) count as confirmation below.
      const sentAt = Date.now();
      try {
        const result = await api.roomLogin(contact.public_key, nextPassword);
        setLastLoginAttempt({
          ...buildServerLoginAttemptFromResponse(method, result, 'room server'),
          at: sentAt,
        });
        setAuthenticated(true);
        // A lost reply is the usual timeout on a busy mesh; remember the room
        // so a reload opens to chat instead of the login form.
        if (result.authenticated || result.status === 'timeout') {
          saveLastSync(contact.public_key, sentAt);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setLastLoginAttempt({
          ...buildServerLoginAttemptFromError(method, message, 'room server'),
          at: sentAt,
        });
        setAuthenticated(true);
        setLoginError(message);
      } finally {
        setLoginLoading(false);
      }
    },
    [contact.public_key, loginLoading]
  );

  const handleLogin = useCallback(
    async (nextPassword: string) => {
      await performLogin(nextPassword, 'password');
      persistAfterLogin(nextPassword);
    },
    [performLogin, persistAfterLogin]
  );

  // Re-sync quietly on open for a room we have joined before (or know the
  // password for), at most once per AUTO_SYNC_INTERVAL_MS. A blank login is how
  // an existing member reconnects. The attempt is stamped before it is sent and
  // the ref guards the mount: a failed login must never retry on its own,
  // because every login is mesh traffic.
  const autoSyncFiredRef = useRef(false);
  useEffect(() => {
    if (autoSyncFiredRef.current) return;
    autoSyncFiredRef.current = true;
    const lastSync = loadLastSync(contact.public_key);
    if (lastSync === null && !storedPassword) return;
    if (lastSync !== null && Date.now() - lastSync < AUTO_SYNC_INTERVAL_MS) return;
    saveLastSync(contact.public_key, Date.now());
    void performLogin(storedPassword, storedPassword ? 'password' : 'blank');
  }, [contact.public_key, storedPassword, performLogin]);

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
        ? 'No login reply yet; new posts will confirm it'
        : loginFailed
          ? lastLoginAttempt.summary
          : `Synced ${new Date(lastLoginAttempt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

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

  return (
    <section className="border-b border-border bg-muted/20 px-4 py-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {syncStatus && (
          <p
            className={cn(
              'mr-auto min-w-0 truncate text-xs',
              loginFailed && !loginUnanswered && !loginLoading
                ? 'text-warning'
                : 'text-muted-foreground'
            )}
            title={lastLoginAttempt?.details ?? undefined}
          >
            {syncStatus}
          </p>
        )}
        {loginFailed && (
          <Button type="button" variant="ghost" size="sm" onClick={handleReenterPassword}>
            Change Password
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loginLoading}
          title="Re-login to ask the room server to resend recent messages"
          onClick={() => performLogin(password, password.trim() ? 'password' : 'blank')}
        >
          {loginLoading ? 'Syncing...' : 'Sync Now'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdvancedOpen((prev) => !prev)}
        >
          {advancedOpen ? 'Hide Tools' : 'Show Tools'}
        </Button>
      </div>
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
    </section>
  );
}
