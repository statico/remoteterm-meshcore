import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Message } from '../types';

const OTHER_KEY = '0123456789ABCDEF0123456789ABCDEF';

const mocks = vi.hoisted(() => {
  const returns: Record<string, unknown> = {
    getRadioConfig: { public_key: 'aa'.repeat(32), name: 'TestNode', lat: 0, lon: 0 },
    getSettings: { blocked_keys: [], blocked_names: [], last_message_times: {} },
    getUndecryptedPacketCount: { count: 0 },
    getChannels: [
      { key: '8B3387E9C5CDEA6AC9E5EDBAA115CD72', name: 'Public', favorite: false },
      { key: '0123456789ABCDEF0123456789ABCDEF', name: '#other', favorite: false },
    ],
    getContacts: [],
    getUnreads: {
      counts: {},
      mentions: {},
      last_read_ats: {},
      last_message_times: {},
      first_unread_ids: {},
    },
  };
  const fns = new Map<string, ReturnType<typeof vi.fn>>();
  const api = new Proxy({} as Record<string, unknown>, {
    get: (_, key: string) => {
      if (!fns.has(key))
        fns.set(
          key,
          vi.fn(async () => returns[key])
        );
      return fns.get(key);
    },
  });
  const activeMessages: Message[] = [
    {
      id: 1,
      type: 'CHAN',
      conversation_key: '8B3387E9C5CDEA6AC9E5EDBAA115CD72',
      text: 'Alice: hello',
      sender_timestamp: 1700000000,
      received_at: 1700000000,
      paths: null,
      txt_type: 0,
      signature: null,
      sender_key: null,
      outgoing: false,
      acked: 0,
      sender_name: 'Alice',
    },
  ];
  return { api, activeMessages, richPayloadReads: { count: 0 } };
});

vi.mock('../api', () => ({ api: mocks.api }));
vi.mock('../useWebSocket', () => ({ useWebSocket: vi.fn() }));
vi.mock('../utils/urlHash', () => ({
  parseHashConversation: () => null,
  parseHashSettingsSection: () => null,
  updateUrlHash: vi.fn(),
  pushUrlHash: vi.fn(),
  updateSettingsHash: vi.fn(),
  pushSettingsHash: vi.fn(),
  getSettingsHash: (section: string) => `#settings/${section}`,
  getMapFocusHash: () => '#map',
}));
// MessageList reads this context exactly once per render, so it doubles as a counter.
vi.mock('../contexts/RichPayloadContext', () => ({
  useRichPayloads: () => {
    mocks.richPayloadReads.count += 1;
    return { renderRichPayloads: false, setRenderRichPayloads: () => {} };
  },
}));

vi.mock('../hooks/useConversationMessages', () => {
  const stable = {
    messages: mocks.activeMessages,
    messagesLoading: false,
    loadingOlder: false,
    hasOlderMessages: false,
    hasNewerMessages: false,
    loadingNewer: false,
    fetchOlderMessages: vi.fn(async () => {}),
    fetchNewerMessages: vi.fn(async () => {}),
    jumpToBottom: vi.fn(),
    observeMessage: vi.fn(() => ({ added: true, activeConversation: false })),
    receiveMessageAck: vi.fn(),
    reconcileOnReconnect: vi.fn(),
    renameConversationMessages: vi.fn(),
    removeConversationMessages: vi.fn(),
    applyBlockListChange: vi.fn(),
  };
  return { useConversationMessages: () => stable };
});

import { App } from '../App';
import { useWebSocket } from '../useWebSocket';

describe('App -> MessageList render isolation', () => {
  it('does not re-render the open MessageList when another channel gets an unread', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('View info for Public')).toBeInTheDocument());
    expect(mocks.richPayloadReads.count).toBeGreaterThan(0);
    // Let startup effects (unreads, mark-read) settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const handlers = vi.mocked(useWebSocket).mock.lastCall![0];
    const before = mocks.richPayloadReads.count;
    act(() => {
      handlers.onMessage!({
        ...mocks.activeMessages[0],
        id: 99,
        conversation_key: OTHER_KEY,
        text: 'Bob: elsewhere',
        sender_name: 'Bob',
      });
    });
    expect(mocks.richPayloadReads.count).toBe(before);
  });
});
