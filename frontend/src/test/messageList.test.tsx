import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPrependOf, MessageList } from '../components/MessageList';
import { PathHopWidthProvider, SHOW_PATH_HOP_WIDTH_KEY } from '../contexts/PathHopWidthContext';
import { CONTACT_TYPE_ROOM, type Contact, type Message } from '../types';

const scrollIntoViewMock = vi.fn();
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

/**
 * jsdom has no layout, so Virtua would see a zero-height viewport and mount no
 * rows. This stands in for the browser just enough to exercise the real scroll
 * logic: the message list's scroll container gets a fixed viewport, a scrollHeight
 * derived from the virtualizer's own spacer, and a clamped scrollTop that fires
 * `scroll` like a browser. Rows are never measured (jsdom has no offsetParent),
 * so every row keeps Virtua's 40px estimate — which makes positions predictable.
 */
const VIEWPORT = 400;
const ROW = 40; // Virtua's default estimate for an unmeasured row
const TOP_SLOT = 40; // MessageList's fixed banner slot above the rows

let scroller: HTMLElement | null = null;

function installFakeLayout(el: HTMLElement) {
  let top = 0;
  const contentHeight = () => {
    const spacer = el.querySelector<HTMLElement>('[style*="contain"]');
    return TOP_SLOT + (spacer ? parseFloat(spacer.style.height) || 0 : 0);
  };
  Object.defineProperties(el, {
    clientHeight: { configurable: true, get: () => VIEWPORT },
    clientWidth: { configurable: true, get: () => 400 },
    scrollHeight: { configurable: true, get: () => Math.max(contentHeight(), VIEWPORT) },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        const max = Math.max(0, el.scrollHeight - VIEWPORT);
        const next = Math.min(Math.max(0, value), max);
        if (next === top) return;
        top = next;
        el.dispatchEvent(new Event('scroll'));
      },
    },
  });
  scroller = el;
}

class FakeLayoutResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('overflow-y-auto')) {
      // A row. Virtua skips rows with no offsetParent and keeps unmeasured rows
      // visibility:hidden, so give each a parent and report the uniform height.
      Object.defineProperty(target, 'offsetParent', {
        configurable: true,
        get: () => target.parentElement,
      });
      queueMicrotask(() =>
        this.callback(
          [{ target, contentRect: { width: 400, height: ROW } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver
        )
      );
      return;
    }
    installFakeLayout(target);
    // Async like the real thing; Virtua is not ready for the callback mid-observe.
    queueMicrotask(() =>
      this.callback(
        [
          {
            target,
            contentRect: { width: 400, height: VIEWPORT },
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver
      )
    );
  }
  unobserve() {}
  disconnect() {}
}

/** Lets Virtua's async scrollToIndex settle (it awaits readiness, then re-applies). */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderList(ui: Parameters<typeof render>[0]) {
  const result = render(ui);
  await settle();
  return result;
}

function maxScrollTop() {
  return scroller!.scrollHeight - VIEWPORT;
}

/**
 * User scroll: sets scrollTop the way a gesture would, then lets React react.
 * Virtua keeps re-applying a programmatic scrollToIndex for 150ms after the
 * last layout change, so wait that out first (a real user is never that fast).
 * The margin over 150ms matters: under a loaded parallel run, a 160ms wait let a
 * still-live jump-to-message scroll re-apply on the next append and flake.
 */
async function userScrollTo(top: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await act(async () => {
    scroller!.scrollTop = top;
  });
  await settle();
}

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    type: 'CHAN',
    conversation_key: 'C3B889530D4F02DB5662EA13C417F530',
    text: 'Alice: hello world',
    sender_timestamp: 1700000000,
    received_at: 1700000001,
    paths: null,
    txt_type: 0,
    signature: null,
    sender_key: null,
    outgoing: false,
    acked: 0,
    sender_name: null,
    ...overrides,
  };
}

describe('MessageList channel sender rendering', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', FakeLayoutResizeObserver);
    scroller = null;
    scrollIntoViewMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
      writable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect,
      writable: true,
    });
  });

  it('renders explicit corrupt placeholder and warning avatar for unnamed corrupt channel packets', async () => {
    await renderList(
      <MessageList
        messages={[
          createMessage({
            text: "Nv\x0ek\x16ɩ'\x7fg:",
            sender_name: null,
            sender_key: null,
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.getByText('<No name -- corrupt packet?>')).toBeInTheDocument();
    expect(screen.getByTestId('corrupt-avatar')).toBeInTheDocument();
  });

  it('renders a region badge for region-scoped channel messages', async () => {
    await renderList(
      <MessageList
        messages={[createMessage({ sender_name: 'Alice', region: 'nl-gr' })]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.getByText('nl-gr')).toBeInTheDocument();
    expect(screen.getByTitle('Regional scope: nl-gr')).toBeInTheDocument();
  });

  it('does not render a region badge for unscoped messages', async () => {
    await renderList(
      <MessageList
        messages={[createMessage({ sender_name: 'Alice', region: null })]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.queryByText('nl-gr')).not.toBeInTheDocument();
  });

  it('shows per-hop byte width in the path badge when the toggle is on', async () => {
    localStorage.setItem(SHOW_PATH_HOP_WIDTH_KEY, 'true');
    await renderList(
      <PathHopWidthProvider>
        <MessageList
          messages={[
            createMessage({
              sender_name: 'Alice',
              // 8 hex chars over 2 hops = 2 bytes/hop.
              paths: [{ path: 'AABBCCDD', path_len: 2, received_at: 1700000001 }],
            }),
          ]}
          contacts={[]}
          loading={false}
        />
      </PathHopWidthProvider>
    );

    expect(screen.getByText('(2 · 2B)')).toBeInTheDocument();
    expect(screen.getByTitle('View message path (2B per hop)')).toBeInTheDocument();
  });

  it('hides the width by default (toggle off) and shows only the hop count', async () => {
    await renderList(
      <MessageList
        messages={[
          createMessage({
            sender_name: 'Alice',
            paths: [{ path: 'AABBCCDD', path_len: 2, received_at: 1700000001 }],
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.queryByText('(2 · 2B)')).not.toBeInTheDocument();
    expect(screen.getByTitle('View message path')).toBeInTheDocument();
  });

  it('omits the width for direct (0-hop) paths even when the toggle is on', async () => {
    localStorage.setItem(SHOW_PATH_HOP_WIDTH_KEY, 'true');
    await renderList(
      <PathHopWidthProvider>
        <MessageList
          messages={[
            createMessage({
              sender_name: 'Alice',
              paths: [{ path: '', path_len: 0, received_at: 1700000001 }],
            }),
          ]}
          contacts={[]}
          loading={false}
        />
      </PathHopWidthProvider>
    );

    expect(screen.getByText('(d)')).toBeInTheDocument();
    expect(screen.getByTitle('View message path')).toBeInTheDocument();
  });

  it('prefers stored sender_name for channel messages even when text is not sender-prefixed', async () => {
    await renderList(
      <MessageList
        messages={[
          createMessage({
            text: 'garbled payload with no sender prefix',
            sender_name: 'Alice',
            sender_key: 'ab'.repeat(32),
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('renders room-server DM messages using stored sender attribution instead of the room contact', async () => {
    const roomContact: Contact = {
      public_key: 'ab'.repeat(32),
      name: 'Ops Board',
      type: CONTACT_TYPE_ROOM,
      flags: 0,
      direct_path: null,
      direct_path_len: -1,
      direct_path_hash_mode: -1,
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

    await renderList(
      <MessageList
        messages={[
          createMessage({
            type: 'PRIV',
            conversation_key: roomContact.public_key,
            text: 'status update: ready',
            sender_name: 'Alice',
            sender_key: '12'.repeat(32),
          }),
        ]}
        contacts={[roomContact]}
        loading={false}
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Ops Board')).not.toBeInTheDocument();
    expect(screen.getByText('status update: ready')).toBeInTheDocument();
  });

  it('gives clickable sender avatars an accessible label', async () => {
    await renderList(
      <MessageList
        messages={[
          createMessage({
            text: 'garbled payload with no sender prefix',
            sender_name: 'Alice',
            sender_key: 'ab'.repeat(32),
          }),
        ]}
        contacts={[]}
        loading={false}
        onOpenContactInfo={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'View info for Alice' })).toBeInTheDocument();
  });

  it('renders valid channel references as clickable links and ignores invalid ones', async () => {
    const user = userEvent.setup();
    const onChannelReferenceClick = vi.fn();

    await renderList(
      <MessageList
        messages={[
          createMessage({
            text: 'Alice: Join #mesh-room now skip #bad--room and visit https://example.com/#also-skip',
          }),
        ]}
        contacts={[]}
        loading={false}
        onChannelReferenceClick={onChannelReferenceClick}
      />
    );

    const linkedChannel = screen.getByRole('button', { name: '#mesh-room' });
    expect(linkedChannel).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '#bad--room' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'https://example.com/#also-skip' })
    ).toBeInTheDocument();

    await user.click(linkedChannel);

    expect(onChannelReferenceClick).toHaveBeenCalledWith('#mesh-room');
  });

  it('links valid channel references when followed by clause punctuation', async () => {
    const user = userEvent.setup();
    const onChannelReferenceClick = vi.fn();

    await renderList(
      <MessageList
        messages={[
          createMessage({
            text: 'Alice: Check #mesh-room, then #ops-room; then #alpha-room.',
          }),
        ]}
        contacts={[]}
        loading={false}
        onChannelReferenceClick={onChannelReferenceClick}
      />
    );

    await user.click(screen.getByRole('button', { name: '#mesh-room' }));
    await user.click(screen.getByRole('button', { name: '#ops-room' }));
    await user.click(screen.getByRole('button', { name: '#alpha-room' }));

    expect(onChannelReferenceClick).toHaveBeenNthCalledWith(1, '#mesh-room');
    expect(onChannelReferenceClick).toHaveBeenNthCalledWith(2, '#ops-room');
    expect(onChannelReferenceClick).toHaveBeenNthCalledWith(3, '#alpha-room');
  });

  it('links valid channel references in direct messages too', async () => {
    const user = userEvent.setup();
    const onChannelReferenceClick = vi.fn();

    await renderList(
      <MessageList
        messages={[
          createMessage({
            type: 'PRIV',
            text: 'check #ops-room',
            conversation_key: 'ab'.repeat(32),
          }),
        ]}
        contacts={[]}
        loading={false}
        onChannelReferenceClick={onChannelReferenceClick}
      />
    );

    await user.click(screen.getByRole('button', { name: '#ops-room' }));

    expect(onChannelReferenceClick).toHaveBeenCalledWith('#ops-room');
  });

  it('does not strip colon-prefixed text in direct messages (issue #198)', async () => {
    await renderList(
      <MessageList
        messages={[
          createMessage({
            type: 'PRIV',
            conversation_key: 'ab'.repeat(32),
            text: 'TEST1: TEST2',
          }),
        ]}
        contacts={[]}
        loading={false}
      />
    );

    expect(screen.getByText('TEST1: TEST2')).toBeInTheDocument();
  });

  it('offers a jump instead of a divider when the unread boundary is not loaded', async () => {
    const user = userEvent.setup();
    const onNavigateToUnread = vi.fn();
    // Boundary id 999 is not among the loaded messages: the real first-unread is
    // further back than this window. The divider must not be invented at the top.
    await renderList(
      <MessageList
        messages={[
          createMessage({ id: 1, received_at: 1700000001, text: 'Alice: older' }),
          createMessage({ id: 2, received_at: 1700000010, text: 'Alice: newer' }),
        ]}
        contacts={[]}
        loading={false}
        unreadMarkerMessageId={999}
        onNavigateToUnread={onNavigateToUnread}
      />
    );

    expect(screen.queryByText('Unread messages')).not.toBeInTheDocument();

    const jump = await screen.findByRole('button', { name: 'Jump to unread' });
    await user.click(jump);

    // Hands off to the jump-to-message path rather than scrolling to a wrong row.
    expect(onNavigateToUnread).toHaveBeenCalledWith(999);
  });

  it('shows no unread affordance at all when nothing is unread', async () => {
    await renderList(
      <MessageList
        messages={[createMessage({ id: 1, received_at: 1700000001, text: 'Alice: hi' })]}
        contacts={[]}
        loading={false}
        unreadMarkerMessageId={null}
      />
    );

    expect(screen.queryByText('Unread messages')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jump to unread' })).not.toBeInTheDocument();
  });

  it('renders and dismisses an unread marker at the first unread message boundary', async () => {
    const user = userEvent.setup();
    const messages = [
      createMessage({ id: 1, received_at: 1700000001, text: 'Alice: older' }),
      createMessage({ id: 2, received_at: 1700000010, text: 'Alice: newer' }),
    ];

    function DismissibleUnreadMarkerList() {
      const [unreadMarkerMessageId, setUnreadMarkerMessageId] = useState<number | undefined>(2);

      return (
        <MessageList
          messages={messages}
          contacts={[]}
          loading={false}
          unreadMarkerMessageId={unreadMarkerMessageId}
          onDismissUnreadMarker={() => setUnreadMarkerMessageId(undefined)}
        />
      );
    }

    await renderList(<DismissibleUnreadMarkerList />);

    const marker = screen.getByRole('button', { name: /Unread messages/i });
    expect(marker).toBeInTheDocument();
    expect(screen.getByText('older')).toBeInTheDocument();
    expect(screen.getByText('newer')).toBeInTheDocument();

    await user.click(marker);

    expect(screen.queryByRole('button', { name: /Unread messages/i })).not.toBeInTheDocument();
  });

  it('shows a jump-to-unread button and dismisses it after use without hiding the marker', async () => {
    const user = userEvent.setup();
    const messages = [
      createMessage({ id: 1, received_at: 1700000001, text: 'Alice: older' }),
      createMessage({ id: 2, received_at: 1700000010, text: 'Alice: newer' }),
    ];

    await renderList(
      <MessageList messages={messages} contacts={[]} loading={false} unreadMarkerMessageId={2} />
    );

    const jumpButton = screen.getByRole('button', { name: 'Jump to unread' });
    expect(jumpButton).toBeInTheDocument();
    expect(screen.getByText('Unread messages')).toBeInTheDocument();

    await user.click(jumpButton);

    expect(screen.queryByRole('button', { name: 'Jump to unread' })).not.toBeInTheDocument();
    expect(screen.getByText('Unread messages')).toBeInTheDocument();
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('lets the user dismiss the jump-to-unread button without scrolling or hiding the marker', async () => {
    const user = userEvent.setup();
    const messages = [
      createMessage({ id: 1, received_at: 1700000001, text: 'Alice: older' }),
      createMessage({ id: 2, received_at: 1700000010, text: 'Alice: newer' }),
    ];

    await renderList(
      <MessageList messages={messages} contacts={[]} loading={false} unreadMarkerMessageId={2} />
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss jump to unread' }));

    expect(screen.queryByRole('button', { name: 'Jump to unread' })).not.toBeInTheDocument();
    expect(screen.getByText('Unread messages')).toBeInTheDocument();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('hides the jump-to-unread button when the unread marker is already visible', async () => {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: function () {
        const element = this as HTMLElement;
        if (element.textContent?.includes('Unread messages')) {
          return {
            top: 200,
            bottom: 240,
            left: 0,
            right: 300,
            width: 300,
            height: 40,
            x: 0,
            y: 200,
            toJSON: () => '',
          };
        }
        if (element.className.includes('overflow-y-auto')) {
          return {
            top: 100,
            bottom: 500,
            left: 0,
            right: 400,
            width: 400,
            height: 400,
            x: 0,
            y: 100,
            toJSON: () => '',
          };
        }
        return {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => '',
        };
      },
    });

    const messages = [
      createMessage({ id: 1, received_at: 1700000001, text: 'Alice: older' }),
      createMessage({ id: 2, received_at: 1700000010, text: 'Alice: newer' }),
    ];

    await renderList(
      <MessageList messages={messages} contacts={[]} loading={false} unreadMarkerMessageId={2} />
    );

    expect(screen.getByText('Unread messages')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jump to unread' })).not.toBeInTheDocument();
  });
  it('mounts only a window of rows for a long history', async () => {
    const messages = Array.from({ length: 500 }, (_, i) =>
      createMessage({
        id: i + 1,
        text: `Alice: message ${i}`,
        sender_timestamp: 1700000000 + i,
        received_at: 1700000001 + i,
      })
    );

    const { container } = await renderList(
      <MessageList messages={messages} contacts={[]} loading={false} />
    );

    // jsdom reports no layout, so the list falls back to a nominal viewport. The point
    // is that the window is bounded: a 500-message history must not mount 500 rows.
    const mounted = container.querySelectorAll('[data-message-id]').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(100);
  });
});

function history(count: number, firstId = 1) {
  return Array.from({ length: count }, (_, i) => {
    const id = firstId + i;
    return createMessage({
      id,
      text: `${id % 2 ? 'Bob' : 'Alice'}: message ${id}`,
      sender_timestamp: 1700000000 + id,
      received_at: 1700000000 + id,
    });
  });
}

const isBob = (msg: { text: string }) => msg.text.startsWith('Bob:');

describe('MessageList scroll behavior (Virtua)', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeLayoutResizeObserver);
    scroller = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens pinned to the newest message', async () => {
    const { container } = await renderList(
      <MessageList messages={history(100)} contacts={[]} loading={false} />
    );

    expect(scroller!.scrollTop).toBe(maxScrollTop());
    expect(container.querySelector('[data-message-id="100"]')).not.toBeNull();
    expect(container.querySelector('[data-message-id="1"]')).toBeNull();
  });

  it('follows a new incoming message when the reader is at the bottom', async () => {
    const messages = history(100);
    const { container, rerender } = await renderList(
      <MessageList messages={messages} contacts={[]} loading={false} />
    );
    const before = scroller!.scrollTop;

    rerender(
      <MessageList messages={[...messages, ...history(1, 101)]} contacts={[]} loading={false} />
    );
    await settle();

    expect(scroller!.scrollTop).toBe(before + ROW);
    expect(scroller!.scrollTop).toBe(maxScrollTop());
    expect(container.querySelector('[data-message-id="101"]')).not.toBeNull();
  });

  it('does not move a reader who has scrolled up when a new message arrives', async () => {
    const messages = history(100);
    const { rerender } = await renderList(
      <MessageList messages={messages} contacts={[]} loading={false} />
    );
    await userScrollTo(1000);

    rerender(
      <MessageList messages={[...messages, ...history(1, 101)]} contacts={[]} loading={false} />
    );
    await settle();

    expect(scroller!.scrollTop).toBe(1000);
    expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeInTheDocument();
  });

  it('keeps the same message on screen when older history is prepended', async () => {
    const page = history(100, 101);
    const { container, rerender } = await renderList(
      <MessageList messages={page} contacts={[]} loading={false} hasOlderMessages />
    );
    await userScrollTo(2000);
    expect(container.querySelector('[data-message-id="150"]')).not.toBeNull();

    rerender(
      <MessageList
        messages={[...history(50, 51), ...page]}
        contacts={[]}
        loading={false}
        hasOlderMessages
      />
    );
    await settle();

    // Virtua's `shift` moves the offset by exactly the prepended height.
    expect(scroller!.scrollTop).toBe(2000 + 50 * ROW);
    expect(container.querySelector('[data-message-id="150"]')).not.toBeNull();
  });

  it('holds the top visible message when blocked rows above it are filtered out', async () => {
    const messages = history(100);
    const { container, rerender } = await renderList(
      <MessageList messages={messages} contacts={[]} loading={false} />
    );
    // 10px into row index 49 (message 50).
    await userScrollTo(TOP_SLOT + 49 * ROW + 10);

    // Block Bob: removes every odd id, 25 of them above message 50.
    rerender(
      <MessageList messages={messages.filter((msg) => !isBob(msg))} contacts={[]} loading={false} />
    );
    await settle();

    // Message 50 is now index 24, and the reader is still 10px into it.
    expect(scroller!.scrollTop).toBe(TOP_SLOT + 24 * ROW + 10);
    expect(container.querySelector('[data-message-id="50"]')).not.toBeNull();
    expect(container.querySelector('[data-message-id="49"]')).toBeNull();
  });

  it('holds the top visible message when unblocked rows are merged in above it', async () => {
    const all = history(100);
    const visible = all.filter((msg) => !isBob(msg));
    const { rerender } = await renderList(
      <MessageList messages={visible} contacts={[]} loading={false} />
    );
    // Row index 24 is message 50.
    await userScrollTo(TOP_SLOT + 24 * ROW);

    // The unblock refetch appends rows unsorted; MessageList sorts them.
    rerender(
      <MessageList messages={[...visible, ...all.filter(isBob)]} contacts={[]} loading={false} />
    );
    await settle();

    expect(scroller!.scrollTop).toBe(TOP_SLOT + 49 * ROW);
  });

  it('stays pinned to the bottom when a block removes rows while at the bottom', async () => {
    const messages = history(100);
    const { rerender } = await renderList(
      <MessageList messages={messages} contacts={[]} loading={false} />
    );

    rerender(
      <MessageList messages={messages.filter((msg) => !isBob(msg))} contacts={[]} loading={false} />
    );
    await settle();

    expect(scroller!.scrollTop).toBe(maxScrollTop());
  });

  it('jumps to and highlights the target message instead of pinning to the bottom', async () => {
    const onTargetReached = vi.fn();
    const { container } = await renderList(
      <MessageList
        messages={history(500)}
        contacts={[]}
        loading={false}
        targetMessageId={250}
        onTargetReached={onTargetReached}
      />
    );

    expect(onTargetReached).toHaveBeenCalledTimes(1);
    // Index 249 centered in the viewport.
    expect(scroller!.scrollTop).toBe(TOP_SLOT + 249 * ROW - (VIEWPORT - ROW) / 2);
    const target = container.querySelector('[data-message-id="250"]');
    expect(target).not.toBeNull();
    expect(target!.querySelector('.message-highlight')).not.toBeNull();
  });

  it('jumps once per target: list changes do not re-jump, a new or re-set target does', async () => {
    const onTargetReached = vi.fn();
    const centred = (index: number) => TOP_SLOT + index * ROW - (VIEWPORT - ROW) / 2;
    const messages = history(500);
    const list = (target: number | null, rows = messages) => (
      <MessageList
        messages={rows}
        contacts={[]}
        loading={false}
        hasNewerMessages
        targetMessageId={target}
        onTargetReached={onTargetReached}
      />
    );
    const { rerender } = await renderList(list(250));
    expect(onTargetReached).toHaveBeenCalledTimes(1);

    // Reader moves away; an in-place list change must not pull them back.
    await userScrollTo(1000);
    rerender(list(250, [...messages, ...history(5, 501)]));
    await settle();
    expect(scroller!.scrollTop).toBe(1000);
    expect(onTargetReached).toHaveBeenCalledTimes(1);

    rerender(list(100));
    await settle();
    expect(scroller!.scrollTop).toBe(centred(99));
    expect(onTargetReached).toHaveBeenCalledTimes(2);

    // Cleared, then the same id again (e.g. the same search hit clicked twice).
    await userScrollTo(1000);
    rerender(list(null));
    await settle();
    rerender(list(100));
    await settle();
    expect(scroller!.scrollTop).toBe(centred(99));
    expect(onTargetReached).toHaveBeenCalledTimes(3);
  });

  it('asks for older messages near the top, but not while a load is running', async () => {
    const onLoadOlder = vi.fn();
    const messages = history(100);
    const { rerender } = await renderList(
      <MessageList
        messages={messages}
        contacts={[]}
        loading={false}
        hasOlderMessages
        loadingOlder
        onLoadOlder={onLoadOlder}
      />
    );
    await userScrollTo(50);
    expect(onLoadOlder).not.toHaveBeenCalled();

    rerender(
      <MessageList
        messages={messages}
        contacts={[]}
        loading={false}
        hasOlderMessages
        onLoadOlder={onLoadOlder}
      />
    );
    await userScrollTo(40);
    expect(onLoadOlder).toHaveBeenCalled();
  });

  it('asks for newer messages at the bottom in jump mode and does not chase appended rows', async () => {
    const onLoadNewer = vi.fn();
    const messages = history(100);
    const { rerender } = await renderList(
      <MessageList
        messages={messages}
        contacts={[]}
        loading={false}
        hasNewerMessages
        targetMessageId={50}
        onLoadNewer={onLoadNewer}
      />
    );
    await userScrollTo(maxScrollTop());
    expect(onLoadNewer).toHaveBeenCalled();
    const atBottom = scroller!.scrollTop;

    rerender(
      <MessageList
        messages={[...messages, ...history(20, 101)]}
        contacts={[]}
        loading={false}
        hasNewerMessages
        targetMessageId={50}
        onLoadNewer={onLoadNewer}
      />
    );
    await settle();

    expect(scroller!.scrollTop).toBe(atBottom);
  });

  it('scroll-to-bottom button returns to the newest message', async () => {
    const user = userEvent.setup();
    await renderList(<MessageList messages={history(100)} contacts={[]} loading={false} />);
    await userScrollTo(500);

    await user.click(screen.getByRole('button', { name: 'Scroll to bottom' }));
    await settle();

    expect(scroller!.scrollTop).toBe(maxScrollTop());
  });
});

describe('isPrependOf', () => {
  const ids = (...values: number[]) => values.map((id) => createMessage({ id }));

  it('is true only for rows added before the old first row', () => {
    expect(isPrependOf(ids(3, 4), ids(1, 2, 3, 4))).toBe(true);
    expect(isPrependOf(ids(3, 4), ids(3, 4, 5))).toBe(false); // append
    expect(isPrependOf(ids(3, 4), ids(1, 3, 4, 5))).toBe(false); // both ends
    expect(isPrependOf(ids(1, 3, 4), ids(1, 2, 3, 4))).toBe(false); // middle insert
    expect(isPrependOf([], ids(1, 2))).toBe(false); // first load
    expect(isPrependOf(ids(1, 2), ids(2))).toBe(false); // removal
  });
});
