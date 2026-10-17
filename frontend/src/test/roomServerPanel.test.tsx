import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { RoomServerPanel, resetRoomCacheForTests } from '../components/RoomServerPanel';
import { resetRememberedServerPasswordsForTests } from '../hooks/useRememberedServerPassword';
import type { Contact } from '../types';

vi.mock('../api', () => ({
  api: {
    roomLogin: vi.fn(),
    roomStatus: vi.fn(),
    roomAcl: vi.fn(),
    roomLppTelemetry: vi.fn(),
    sendRepeaterCommand: vi.fn(),
  },
}));

const { api: _rawApi } = await import('../api');
const mockApi = _rawApi as unknown as Record<string, Mock>;
const lastSyncKey = `remoteterm-room-last-sync:${'aa'.repeat(32)}`;

const roomContact: Contact = {
  public_key: 'aa'.repeat(32),
  name: 'Ops Board',
  type: 3,
  flags: 0,
  direct_path: null,
  direct_path_len: -1,
  direct_path_hash_mode: 0,
  last_advert: null,
  lat: null,
  lon: null,
  last_seen: null,
  on_radio: false,
  favorite: false,
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
};

describe('RoomServerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRoomCacheForTests();
    resetRememberedServerPasswordsForTests();
  });

  const timeoutResult = { status: 'timeout', authenticated: false, message: 'No reply heard' };
  const okResult = { status: 'ok', authenticated: true, message: null };
  const rememberPassword = (password: string) =>
    localStorage.setItem(
      `remoteterm-server-password:room:${roomContact.public_key}`,
      JSON.stringify({ password })
    );

  it('connects on open with a blank login and shows a cancellable spinner', async () => {
    let resolveLogin: (value: unknown) => void = () => {};
    mockApi.roomLogin.mockReturnValueOnce(new Promise((resolve) => (resolveLogin = resolve)));

    render(<RoomServerPanel contact={roomContact} />);

    expect(await screen.findByText(/Connecting to Ops Board/)).toBeInTheDocument();
    expect(mockApi.roomLogin).toHaveBeenCalledWith(roomContact.public_key, '');

    fireEvent.click(screen.getByText('Cancel'));
    expect(await screen.findByText('Login with Password')).toBeInTheDocument();

    // The cancelled reply is ignored when it lands.
    resolveLogin(okResult);
    await waitFor(() => expect(screen.getByText('Login with Password')).toBeInTheDocument());
    expect(localStorage.getItem(lastSyncKey)).toBe(null);
  });

  it('stays on the login form after cancelling when reopened this session', async () => {
    mockApi.roomLogin.mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(<RoomServerPanel contact={roomContact} />);
    fireEvent.click(await screen.findByText('Cancel'));
    unmount();

    render(<RoomServerPanel contact={roomContact} />);

    expect(screen.getByText('Login with Password')).toBeInTheDocument();
    expect(mockApi.roomLogin).toHaveBeenCalledTimes(1);
  });

  it('returns to the login form with the reason when the room refuses', async () => {
    mockApi.roomLogin.mockResolvedValueOnce({
      status: 'error',
      authenticated: false,
      message: 'Room server refused this login',
    });

    render(<RoomServerPanel contact={roomContact} />);

    expect(await screen.findByText('Room server refused this login')).toBeInTheDocument();
    expect(screen.getByText('Login with Password')).toBeInTheDocument();
  });

  it('keeps room controls available when login is not confirmed', async () => {
    mockApi.roomLogin.mockResolvedValueOnce(timeoutResult);
    const onAuthenticatedChange = vi.fn();

    render(<RoomServerPanel contact={roomContact} onAuthenticatedChange={onAuthenticatedChange} />);

    expect(await screen.findByLabelText('Show Tools')).toBeInTheDocument();
    expect(screen.getByText('No login reply yet')).toBeInTheDocument();
    expect(screen.getByLabelText('Change Password')).toBeInTheDocument();
    expect(onAuthenticatedChange).toHaveBeenLastCalledWith(true);
    // Remembered so a reload opens to chat and the auto-sync stays gated.
    expect(Number(localStorage.getItem(lastSyncKey))).toBeGreaterThan(0);
  });

  it('treats a room post after an unanswered login as confirmation', async () => {
    mockApi.roomLogin.mockResolvedValueOnce(timeoutResult);

    const { rerender } = render(<RoomServerPanel contact={roomContact} lastPostAt={0} />);
    expect(await screen.findByText('No login reply yet')).toBeInTheDocument();

    rerender(
      <RoomServerPanel contact={roomContact} lastPostAt={Math.ceil(Date.now() / 1000) + 1} />
    );

    expect(await screen.findByText(/^Synced /)).toBeInTheDocument();
    expect(screen.queryByLabelText('Change Password')).not.toBeInTheDocument();
  });

  it('ignores room posts older than the unanswered login', async () => {
    mockApi.roomLogin.mockResolvedValueOnce(timeoutResult);

    render(
      <RoomServerPanel contact={roomContact} lastPostAt={Math.floor(Date.now() / 1000) - 60} />
    );

    expect(await screen.findByText('No login reply yet')).toBeInTheDocument();
  });

  it('logs in with the typed password and reuses it for Sync Now', async () => {
    mockApi.roomLogin.mockReturnValueOnce(new Promise(() => {}));
    render(<RoomServerPanel contact={roomContact} />);
    fireEvent.click(await screen.findByText('Cancel'));

    mockApi.roomLogin.mockResolvedValueOnce(timeoutResult).mockResolvedValueOnce(okResult);
    fireEvent.change(screen.getByLabelText('Repeater password'), {
      target: { value: 'secret-room-password' },
    });
    fireEvent.click(screen.getByText('Login with Password'));
    fireEvent.click(await screen.findByLabelText('Sync Now'));

    await waitFor(() => {
      expect(mockApi.roomLogin).toHaveBeenNthCalledWith(
        2,
        roomContact.public_key,
        'secret-room-password'
      );
      expect(mockApi.roomLogin).toHaveBeenNthCalledWith(
        3,
        roomContact.public_key,
        'secret-room-password'
      );
    });
  });

  it('returns to an empty login form when changing the password', async () => {
    rememberPassword('wrong-password');
    mockApi.roomLogin.mockResolvedValueOnce(timeoutResult);

    render(<RoomServerPanel contact={roomContact} />);

    fireEvent.click(await screen.findByLabelText('Change Password'));

    expect(await screen.findByText('Login with Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Repeater password')).toHaveValue('');
    expect(localStorage.getItem(`remoteterm-server-password:room:${roomContact.public_key}`)).toBe(
      null
    );
    expect(localStorage.getItem(lastSyncKey)).toBe(null);
  });

  it('records the sync after a confirmed login', async () => {
    mockApi.roomLogin.mockResolvedValueOnce(okResult);

    render(<RoomServerPanel contact={roomContact} />);

    expect(await screen.findByText(/^Synced /)).toBeInTheDocument();
    expect(screen.queryByLabelText('Change Password')).not.toBeInTheDocument();
    expect(Number(localStorage.getItem(lastSyncKey))).toBeGreaterThan(0);
  });

  it('opens a recently synced room straight to chat without re-logging in', async () => {
    localStorage.setItem(lastSyncKey, String(Date.now() - 60_000));
    const onAuthenticatedChange = vi.fn();

    render(<RoomServerPanel contact={roomContact} onAuthenticatedChange={onAuthenticatedChange} />);

    expect(screen.getByLabelText('Sync Now')).toBeInTheDocument();
    await waitFor(() => expect(onAuthenticatedChange).toHaveBeenLastCalledWith(true));
    expect(mockApi.roomLogin).not.toHaveBeenCalled();
  });

  it('quietly re-syncs a stale room in chat view', async () => {
    localStorage.setItem(lastSyncKey, String(Date.now() - 60 * 60_000));
    mockApi.roomLogin.mockResolvedValue(okResult);

    render(<RoomServerPanel contact={roomContact} />);

    expect(screen.queryByText(/Connecting to/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockApi.roomLogin).toHaveBeenCalledWith(roomContact.public_key, '');
    });
    expect(mockApi.roomLogin).toHaveBeenCalledTimes(1);
  });

  it('auto-logs in once with a remembered password', async () => {
    rememberPassword('remembered-password');
    mockApi.roomLogin.mockResolvedValue(okResult);

    const { rerender } = render(<RoomServerPanel contact={roomContact} />);

    expect(await screen.findByLabelText('Show Tools')).toBeInTheDocument();
    rerender(<RoomServerPanel contact={roomContact} />);

    expect(mockApi.roomLogin).toHaveBeenCalledTimes(1);
    expect(mockApi.roomLogin).toHaveBeenCalledWith(roomContact.public_key, 'remembered-password');
  });

  it('does not retry the auto-login after it fails', async () => {
    rememberPassword('remembered-password');
    mockApi.roomLogin.mockRejectedValue(new Error('room server unreachable'));

    const { rerender } = render(<RoomServerPanel contact={roomContact} />);

    expect(await screen.findByLabelText('Change Password')).toBeInTheDocument();
    rerender(<RoomServerPanel contact={roomContact} />);

    expect(mockApi.roomLogin).toHaveBeenCalledTimes(1);
  });

  it('renders the controls into the header slot when given one', async () => {
    localStorage.setItem(lastSyncKey, String(Date.now() - 60_000));
    const slot = document.createElement('div');
    document.body.appendChild(slot);

    render(<RoomServerPanel contact={roomContact} toolbarTarget={slot} />);

    expect(slot.querySelector('[aria-label="Sync Now"]')).not.toBeNull();
    slot.remove();
  });
});
