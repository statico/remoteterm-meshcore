import { memo, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const avatarRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock('../components/ContactAvatar', () => ({
  ContactAvatar: () => {
    avatarRenders.count += 1;
    return <span data-testid="avatar" />;
  },
}));

import { Sidebar } from '../components/Sidebar';
import { DistanceUnitProvider, useDistanceUnit } from '../contexts/DistanceUnitContext';
import { PathHopWidthProvider, usePathHopWidth } from '../contexts/PathHopWidthContext';
import { RichPayloadProvider, useRichPayloads } from '../contexts/RichPayloadContext';
import type { Contact } from '../types';

const contact: Contact = {
  public_key: '11'.repeat(32),
  name: 'Alice',
  type: 1,
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

const noop = () => {};
const sidebarProps = {
  contacts: [contact],
  channels: [],
  activeConversation: null,
  onSelectConversation: noop,
  onNewMessage: noop,
  lastMessageTimes: {},
  unreadCounts: {},
  mentions: {},
  showCracker: false,
  crackerRunning: false,
  onToggleCracker: noop,
  onMarkAllRead: noop,
};

describe('render memoization', () => {
  it('Sidebar skips re-rendering when its parent re-renders with the same props', () => {
    let bump: () => void = noop;
    function Parent() {
      const [tick, setTick] = useState(0);
      bump = () => setTick((t) => t + 1);
      return (
        <>
          <span data-testid="tick">{tick}</span>
          <Sidebar {...sidebarProps} />
        </>
      );
    }

    avatarRenders.count = 0;
    render(<Parent />);
    expect(screen.getAllByTestId('avatar').length).toBeGreaterThan(0);
    const initial = avatarRenders.count;

    act(() => bump());
    expect(screen.getByTestId('tick').textContent).toBe('1');
    expect(avatarRenders.count).toBe(initial);
  });

  it('Sidebar re-renders when a prop changes', () => {
    let setUnread: (u: Record<string, number>) => void = noop;
    function Parent() {
      const [unreadCounts, set] = useState<Record<string, number>>({});
      setUnread = set;
      return <Sidebar {...sidebarProps} unreadCounts={unreadCounts} />;
    }

    avatarRenders.count = 0;
    render(<Parent />);
    const initial = avatarRenders.count;
    act(() => setUnread({ [`contact-${contact.public_key}`]: 2 }));
    expect(avatarRenders.count).toBeGreaterThan(initial);
  });

  it('preference providers keep a stable context value across parent re-renders', () => {
    const consumerRenders = { count: 0 };
    const Consumer = memo(function Consumer() {
      useDistanceUnit();
      usePathHopWidth();
      useRichPayloads();
      consumerRenders.count += 1;
      return null;
    });

    let bump: () => void = noop;
    function Parent() {
      const [, setTick] = useState(0);
      bump = () => setTick((t) => t + 1);
      return (
        <DistanceUnitProvider>
          <RichPayloadProvider>
            <PathHopWidthProvider>
              <Consumer />
            </PathHopWidthProvider>
          </RichPayloadProvider>
        </DistanceUnitProvider>
      );
    }

    render(<Parent />);
    expect(consumerRenders.count).toBe(1);
    act(() => bump());
    expect(consumerRenders.count).toBe(1);
  });

  it('preference setters re-render consumers and persist the choice', () => {
    localStorage.clear();
    let prefs: {
      distance: ReturnType<typeof useDistanceUnit>;
      hop: ReturnType<typeof usePathHopWidth>;
      rich: ReturnType<typeof useRichPayloads>;
    } | null = null;
    function Consumer() {
      prefs = { distance: useDistanceUnit(), hop: usePathHopWidth(), rich: useRichPayloads() };
      return null;
    }
    render(
      <DistanceUnitProvider>
        <RichPayloadProvider>
          <PathHopWidthProvider>
            <Consumer />
          </PathHopWidthProvider>
        </RichPayloadProvider>
      </DistanceUnitProvider>
    );
    expect(prefs!.distance.distanceUnit).toBe('metric');
    expect(prefs!.hop.showPathHopWidth).toBe(false);
    expect(prefs!.rich.renderRichPayloads).toBe(false);

    act(() => {
      prefs!.distance.setDistanceUnit('imperial');
      prefs!.hop.setShowPathHopWidth(true);
      prefs!.rich.setRenderRichPayloads(true);
    });

    expect(prefs!.distance.distanceUnit).toBe('imperial');
    expect(prefs!.hop.showPathHopWidth).toBe(true);
    expect(prefs!.rich.renderRichPayloads).toBe(true);
    expect(localStorage.getItem('remoteterm-distance-unit')).toBe('imperial');
    expect(localStorage.getItem('remoteterm-show-path-hop-width')).toBe('true');
    expect(localStorage.getItem('remoteterm-render-rich-payloads')).toBe('true');
  });
});
