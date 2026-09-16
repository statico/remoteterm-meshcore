import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChatHeader } from '../components/ChatHeader';
import type { Contact, Conversation, PathDiscoveryResponse } from '../types';

const noop = () => {};

const baseProps = {
  channels: [],
  config: null,
  notificationsSupported: true,
  notificationsEnabled: false,
  notificationsPermission: 'granted' as const,
  onTrace: noop,
  onPathDiscovery: vi.fn(async () => {
    throw new Error('unused');
  }) as (_: string) => Promise<PathDiscoveryResponse>,
  onToggleNotifications: noop,
  onToggleFavorite: noop,
  onSetChannelFloodScopeOverride: noop,
  onDeleteChannel: noop,
  onDeleteContact: noop,
};

function makeContact(publicKey: string, floodScopeOverride: string | null = null): Contact {
  return {
    public_key: publicKey,
    name: 'Alice',
    type: 1,
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
    flood_scope_override: floodScopeOverride,
  };
}

const pubKey = 'ab'.repeat(32);
const conversation: Conversation = { type: 'contact', id: pubKey, name: 'Alice' };

describe('ChatHeader contact regional override', () => {
  it('hides the globe for contacts when no contact handler is supplied', () => {
    render(
      <ChatHeader {...baseProps} conversation={conversation} contacts={[makeContact(pubKey)]} />
    );

    expect(screen.queryByLabelText('Set regional override')).not.toBeInTheDocument();
  });

  it('opens the override modal from the contact globe', () => {
    render(
      <ChatHeader
        {...baseProps}
        conversation={conversation}
        contacts={[makeContact(pubKey)]}
        onSetContactFloodScopeOverride={noop}
      />
    );

    fireEvent.click(screen.getByLabelText('Set regional override'));

    expect(screen.getByText('Regional Override')).toBeInTheDocument();
    // Contact-only caveat: the region only rides along on flood-routed DMs.
    expect(screen.getByText(/only carries a region when it is flood-routed/)).toBeInTheDocument();
  });

  it('shows the persisted region as a badge and saves a new one', () => {
    const onSet = vi.fn();
    render(
      <ChatHeader
        {...baseProps}
        conversation={conversation}
        contacts={[makeContact(pubKey, '#Esperance')]}
        onSetContactFloodScopeOverride={onSet}
      />
    );

    expect(screen.getAllByText('#Esperance').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByLabelText('Set regional override')[0]);
    fireEvent.click(screen.getByText('Scope Alice to Esperance'));

    expect(onSet).toHaveBeenCalledWith(pubKey, 'Esperance');
  });

  it('forces unscoped with the canonical marker', () => {
    const onSet = vi.fn();
    render(
      <ChatHeader
        {...baseProps}
        conversation={conversation}
        contacts={[makeContact(pubKey)]}
        onSetContactFloodScopeOverride={onSet}
      />
    );

    fireEvent.click(screen.getByLabelText('Set regional override'));
    fireEvent.click(screen.getByText(/Always send Alice unscoped/));

    expect(onSet).toHaveBeenCalledWith(pubKey, '*');
  });
});
