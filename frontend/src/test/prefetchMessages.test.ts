import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conversation, Message } from '../types';

const mockGetMessages = vi.fn();

vi.mock('../api', () => ({
  api: { getMessages: (...args: unknown[]) => mockGetMessages(...args) },
  isAbortError: () => false,
}));

vi.mock('../components/ui/sonner', () => ({ toast: { error: vi.fn() } }));

const channel: Conversation = { type: 'channel', id: 'ABCDEF', name: '#test' };

function message(id: number): Message {
  return {
    id,
    type: 'CHAN',
    conversation_key: 'ABCDEF',
    text: `m${id}`,
    sender_timestamp: 1700000000 + id,
    received_at: 1700000000 + id,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: null,
  };
}

/** index.html sets window.__prefetch before the app modules load. */
async function loadHookWithPrefetch(conversationKey: string, page: Message[]) {
  vi.resetModules();
  (window as unknown as { __prefetch: unknown }).__prefetch = {
    messages: { conversationKey, promise: Promise.resolve(page) },
  };
  return (await import('../hooks/useConversationMessages')).useConversationMessages;
}

describe('startup messages prefetch', () => {
  beforeEach(() => {
    mockGetMessages.mockReset();
  });

  it('serves the first open of the hash conversation without a second request', async () => {
    const useConversationMessages = await loadHookWithPrefetch('ABCDEF', [message(1), message(2)]);

    const { result } = renderHook(() => useConversationMessages(channel));

    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual([1, 2]));
    expect(mockGetMessages).not.toHaveBeenCalled();
  });

  it('ignores a prefetch for another conversation and fetches normally', async () => {
    const useConversationMessages = await loadHookWithPrefetch('OTHER', [message(9)]);
    mockGetMessages.mockResolvedValueOnce([message(3)]);

    const { result } = renderHook(() => useConversationMessages(channel));

    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual([3]));
    expect(mockGetMessages).toHaveBeenCalledTimes(1);
  });
});
