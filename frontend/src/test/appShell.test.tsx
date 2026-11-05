import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import { AppShell } from '../components/AppShell';
import type { Conversation } from '../types';

const search: Conversation = { type: 'search', id: 'search', name: 'Search' };
const channel: Conversation = { type: 'channel', id: 'abc', name: '#test' };

function props(overrides: Partial<ComponentProps<typeof AppShell>> = {}) {
  return {
    localLabel: { text: '', color: '#000000' },
    activeConversation: channel,
    showSettings: false,
    settingsSection: 'radio' as const,
    sidebarOpen: false,
    showCracker: false,
    contactInfoOpen: false,
    channelInfoOpen: false,
    onSettingsSectionChange: vi.fn(),
    onSidebarOpenChange: vi.fn(),
    onCloseSettingsView: vi.fn(),
    statusBar: <div>status-slot</div>,
    sidebar: <div>sidebar-slot</div>,
    conversationPane: <div>conversation-slot</div>,
    searchView: <div>search-slot</div>,
    settingsView: <div>settings-slot</div>,
    crackerPanel: <div>cracker-slot</div>,
    contactInfoPane: <div>contact-info-slot</div>,
    channelInfoPane: <div>channel-info-slot</div>,
    children: <div>modal-child</div>,
    ...overrides,
  };
}

describe('AppShell', () => {
  it('renders the always-on slots and children', () => {
    render(<AppShell {...props()} />);
    for (const text of ['status-slot', 'sidebar-slot', 'conversation-slot', 'modal-child']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    for (const text of ['search-slot', 'settings-slot', 'cracker-slot', 'contact-info-slot']) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
  });

  it('keeps lazy panes mounted after first use', () => {
    const { rerender } = render(<AppShell {...props({ activeConversation: search })} />);
    expect(screen.getByText('search-slot')).toBeInTheDocument();

    rerender(<AppShell {...props({ activeConversation: channel, contactInfoOpen: true })} />);
    expect(screen.getByText('search-slot')).toBeInTheDocument();
    expect(screen.getByText('contact-info-slot')).toBeInTheDocument();

    rerender(<AppShell {...props({ activeConversation: channel })} />);
    expect(screen.getByText('contact-info-slot')).toBeInTheDocument();
  });

  it('swaps the sidebar for settings nav and reports section clicks', () => {
    const onSettingsSectionChange = vi.fn();
    render(<AppShell {...props({ showSettings: true, onSettingsSectionChange })} />);
    expect(screen.getByText('settings-slot')).toBeInTheDocument();
    expect(screen.queryByText('sidebar-slot')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /local/i }));
    expect(onSettingsSectionChange).toHaveBeenCalledWith('local');
  });
});
