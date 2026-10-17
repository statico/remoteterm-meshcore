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

  it('keeps room controls available when login is not confirmed', async () => {
    mockApi.roomLogin.mockResolvedValueOnce({
      status: 'timeout',
      authenticated: false,
      message:
        "No login confirmation was heard from the room server. You're free to try sending messages; try logging in again if authenticated actions fail.",
    });
    const onAuthenticatedChange = vi.fn();

    render(<RoomServerPanel contact={roomContact} onAuthenticatedChange={onAuthenticatedChange} />);

    fireEvent.click(screen.getByText('Login with Existing Access / Guest'));

    await waitFor(() => {
      expect(screen.getByText('Show Tools')).toBeInTheDocument();
    });
    expect(screen.getByText(/No login reply yet/)).toBeInTheDocument();
    expect(screen.getByText('Change Password')).toBeInTheDocument();
    expect(onAuthenticatedChange).toHaveBeenLastCalledWith(true);
    // Remembered so a reload opens to chat and the auto-sync stays gated.
    expect(Number(localStorage.getItem(lastSyncKey))).toBeGreaterThan(0);
  });

  it('treats a room post after an unanswered login as confirmation', async () => {
    mockApi.roomLogin.mockResolvedValueOnce({
      status: 'timeout',
      authenticated: false,
      message: 'No reply heard',
    });

    const { rerender } = render(<RoomServerPanel contact={roomContact} lastPostAt={0} />);
    fireEvent.click(screen.getByText('Login with Existing Access / Guest'));
    await waitFor(() => {
      expect(screen.getByText(/No login reply yet/)).toBeInTheDocument();
    });

    rerender(
      <RoomServerPanel contact={roomContact} lastPostAt={Math.ceil(Date.now() / 1000) + 1} />
    );

    await waitFor(() => {
      expect(screen.getByText(/^Synced /)).toBeInTheDocument();
    });
    expect(screen.queryByText('Change Password')).not.toBeInTheDocument();
  });

  it('ignores room posts older than the unanswered login', async () => {
    mockApi.roomLogin.mockResolvedValueOnce({
      status: 'timeout',
      authenticated: false,
      message: 'No reply heard',
    });

    render(
      <RoomServerPanel contact={roomContact} lastPostAt={Math.floor(Date.now() / 1000) - 60} />
    );
    fireEvent.click(screen.getByText('Login with Existing Access / Guest'));

    await waitFor(() => {
      expect(screen.getByText(/No login reply yet/)).toBeInTheDocument();
    });
  });

  it('retains the last password for one-click retry after unlocking the panel', async () => {
    mockApi.roomLogin
      .mockResolvedValueOnce({
        status: 'timeout',
        authenticated: false,
        message: 'No reply heard',
      })
      .mockResolvedValueOnce({
        status: 'ok',
        authenticated: true,
        message: null,
      });

    render(<RoomServerPanel contact={roomContact} />);

    fireEvent.change(screen.getByLabelText('Repeater password'), {
      target: { value: 'secret-room-password' },
    });
    fireEvent.click(screen.getByText('Login with Password'));

    await waitFor(() => {
      expect(screen.getByText('Sync Now')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Sync Now'));

    await waitFor(() => {
      expect(mockApi.roomLogin).toHaveBeenNthCalledWith(
        1,
        roomContact.public_key,
        'secret-room-password'
      );
      expect(mockApi.roomLogin).toHaveBeenNthCalledWith(
        2,
        roomContact.public_key,
        'secret-room-password'
      );
    });
  });

  it('returns to an empty login form when re-entering the password', async () => {
    mockApi.roomLogin.mockResolvedValueOnce({
      status: 'timeout',
      authenticated: false,
      message: 'No reply heard',
    });

    render(<RoomServerPanel contact={roomContact} />);

    fireEvent.click(screen.getByLabelText('Remember password'));
    fireEvent.change(screen.getByLabelText('Repeater password'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByText('Login with Password'));

    await waitFor(() => {
      expect(screen.getByText('Change Password')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Change Password'));

    await waitFor(() => {
      expect(screen.getByText('Login with Password')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Repeater password')).toHaveValue('');
    expect(screen.queryByText('Change Password')).not.toBeInTheDocument();
    expect(localStorage.getItem(`remoteterm-server-password:room:${roomContact.public_key}`)).toBe(
      null
    );
  });

  it('records the sync after a confirmed login', async () => {
    mockApi.roomLogin.mockResolvedValueOnce({
      status: 'ok',
      authenticated: true,
      message: null,
    });

    render(<RoomServerPanel contact={roomContact} />);

    fireEvent.click(screen.getByText('Login with Existing Access / Guest'));

    await waitFor(() => {
      expect(screen.getByText('Show Tools')).toBeInTheDocument();
    });

    expect(screen.getByText(/^Synced /)).toBeInTheDocument();
    expect(screen.queryByText('Change Password')).not.toBeInTheDocument();
    expect(Number(localStorage.getItem(lastSyncKey))).toBeGreaterThan(0);
  });

  it('opens a previously synced room straight to chat without re-logging in', async () => {
    localStorage.setItem(lastSyncKey, String(Date.now() - 60_000));
    const onAuthenticatedChange = vi.fn();

    render(<RoomServerPanel contact={roomContact} onAuthenticatedChange={onAuthenticatedChange} />);

    expect(screen.getByText('Sync Now')).toBeInTheDocument();
    await waitFor(() => expect(onAuthenticatedChange).toHaveBeenLastCalledWith(true));
    expect(mockApi.roomLogin).not.toHaveBeenCalled();
  });

  it('quietly re-syncs a stale room with an existing-member login', async () => {
    localStorage.setItem(lastSyncKey, String(Date.now() - 60 * 60_000));
    mockApi.roomLogin.mockResolvedValue({ status: 'ok', authenticated: true, message: null });

    render(<RoomServerPanel contact={roomContact} />);

    await waitFor(() => {
      expect(mockApi.roomLogin).toHaveBeenCalledWith(roomContact.public_key, '');
    });
    expect(mockApi.roomLogin).toHaveBeenCalledTimes(1);
  });
  it('auto-logs in once when a password is already remembered', async () => {
    localStorage.setItem(
      `remoteterm-server-password:room:${roomContact.public_key}`,
      JSON.stringify({ password: 'remembered-password' })
    );
    mockApi.roomLogin.mockResolvedValue({ status: 'ok', authenticated: true, message: null });

    const { rerender } = render(<RoomServerPanel contact={roomContact} />);

    await waitFor(() => {
      expect(screen.getByText('Show Tools')).toBeInTheDocument();
    });
    rerender(<RoomServerPanel contact={roomContact} />);

    expect(mockApi.roomLogin).toHaveBeenCalledTimes(1);
    expect(mockApi.roomLogin).toHaveBeenCalledWith(roomContact.public_key, 'remembered-password');
  });

  it('does not auto-log in when no password is remembered', async () => {
    render(<RoomServerPanel contact={roomContact} />);

    await waitFor(() => {
      expect(screen.getByText('Login with Password')).toBeInTheDocument();
    });
    expect(mockApi.roomLogin).not.toHaveBeenCalled();
  });

  it('does not retry the auto-login after it fails', async () => {
    localStorage.setItem(
      `remoteterm-server-password:room:${roomContact.public_key}`,
      JSON.stringify({ password: 'remembered-password' })
    );
    mockApi.roomLogin.mockRejectedValue(new Error('room server unreachable'));

    const { rerender } = render(<RoomServerPanel contact={roomContact} />);

    await waitFor(() => {
      expect(mockApi.roomLogin).toHaveBeenCalledTimes(1);
    });
    rerender(<RoomServerPanel contact={roomContact} />);
    await waitFor(() => {
      expect(screen.getByText('Change Password')).toBeInTheDocument();
    });

    expect(mockApi.roomLogin).toHaveBeenCalledTimes(1);
  });

  it('re-issues the login when Sync Now is clicked', async () => {
    mockApi.roomLogin.mockResolvedValue({ status: 'ok', authenticated: true, message: null });

    render(<RoomServerPanel contact={roomContact} />);

    fireEvent.click(screen.getByText('Login with Existing Access / Guest'));
    await waitFor(() => {
      expect(screen.getByText('Sync Now')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Sync Now'));

    await waitFor(() => {
      expect(mockApi.roomLogin).toHaveBeenCalledTimes(2);
    });
  });
});
