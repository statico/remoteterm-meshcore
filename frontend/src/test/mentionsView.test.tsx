import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';

const mockGetMessages = vi.fn<(...args: unknown[]) => Promise<Message[]>>();

vi.mock('../api', () => ({
  api: {
    getMessages: (...args: unknown[]) => mockGetMessages(...args),
  },
  isAbortError: (err: unknown) => err instanceof DOMException && err.name === 'AbortError',
}));

import { MentionsView } from '../components/MentionsView';

const CHAN = 'ABC123';

function mention(id: number, receivedAt: number): Message {
  return {
    id,
    type: 'CHAN',
    conversation_key: CHAN,
    text: `Alice: hey @[MyNode] #${id}`,
    sender_timestamp: receivedAt,
    received_at: receivedAt,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: 'Alice',
  };
}

const channel = {
  key: CHAN,
  name: '#mesh',
  is_hashtag: true,
  on_radio: false,
  last_read_at: null,
  favorite: false,
  muted: false,
};

describe('MentionsView', () => {
  beforeEach(() => {
    mockGetMessages.mockReset();
  });

  it('marks mentions newer than the last read as unread and jumps on click', async () => {
    mockGetMessages.mockResolvedValue([mention(2, 200), mention(1, 100)]);
    const onNavigateToMessage = vi.fn();

    render(
      <MentionsView
        contacts={[]}
        channels={[channel]}
        myName="MyNode"
        mentions={{ [`channel-${CHAN}`]: true }}
        lastReadAts={{ [`channel-${CHAN}`]: 150 }}
        refreshNonce={0}
        onNavigateToMessage={onNavigateToMessage}
      />
    );

    expect(await screen.findByLabelText('Unread mention in #mesh')).toBeInTheDocument();
    expect(screen.getByLabelText('Mention in #mesh')).toBeInTheDocument();
    expect(screen.getByText('1 new')).toBeInTheDocument();
    expect(mockGetMessages.mock.calls[0][0]).toMatchObject({ mentions: true, offset: 0 });

    fireEvent.click(screen.getByLabelText('Unread mention in #mesh'));
    expect(onNavigateToMessage).toHaveBeenCalledWith({
      id: 2,
      type: 'CHAN',
      conversation_key: CHAN,
      conversation_name: '#mesh',
    });
  });
});
