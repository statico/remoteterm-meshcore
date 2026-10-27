import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { Sidebar } from '../components/Sidebar';
import { CONTACT_TYPE_REPEATER, type Contact, type TelemetryHistoryEntry } from '../types';
import {
  formatRepeaterPower,
  formatRepeaterTemperature,
  setRepeaterPowerMode,
  setShowRepeaterTemperature,
} from '../utils/repeaterSidebarTelemetry';

function entry(data: Record<string, unknown>, ageSeconds = 0): TelemetryHistoryEntry {
  return {
    timestamp: Math.floor(Date.now() / 1000) - ageSeconds,
    data: data as TelemetryHistoryEntry['data'],
  };
}

describe('repeater sidebar telemetry formatting', () => {
  it('formats volts, and percent only for single-cell voltages', () => {
    expect(formatRepeaterPower(12.43, 'volts')).toBe('12.4V');
    expect(formatRepeaterPower(3.72, 'percent')).toBe('50%');
    expect(formatRepeaterPower(12.43, 'percent')).toBe('12.4V');
    expect(formatRepeaterPower(12.43, 'off')).toBeNull();
    expect(formatRepeaterPower(0, 'volts')).toBeNull();
  });

  it('reads the temperature sensor in the chosen unit', () => {
    const e = entry({
      battery_volts: 4,
      lpp_sensors: [
        { channel: 1, type_name: 'voltage', value: 4 },
        { channel: 1, type_name: 'temperature', value: 21.4 },
      ],
    });
    expect(formatRepeaterTemperature(e, 'metric')).toBe('21°C');
    expect(formatRepeaterTemperature(e, 'imperial')).toBe('71°F');
    expect(formatRepeaterTemperature(entry({ battery_volts: 4 }), 'metric')).toBeNull();
  });
});

describe('Sidebar repeater telemetry', () => {
  const relay: Contact = {
    public_key: '22'.repeat(32),
    name: 'Relay',
    type: CONTACT_TYPE_REPEATER,
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

  const renderSidebar = () =>
    render(
      <Sidebar
        contacts={[relay]}
        channels={[]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows power, temperature and age next to a monitored repeater', async () => {
    setRepeaterPowerMode('volts');
    setShowRepeaterTemperature(true);
    vi.spyOn(api, 'getTrackedTelemetryLatest').mockResolvedValue({
      [relay.public_key]: entry(
        { battery_volts: 12.4, lpp_sensors: [{ channel: 1, type_name: 'temperature', value: 20 }] },
        4 * 3600
      ),
    });

    renderSidebar();

    expect(await screen.findByText('12.4V 20°C')).toBeInTheDocument();
    expect(screen.getByText('4h')).toBeInTheDocument();
  });

  it('does not fetch telemetry when the display is off', () => {
    const spy = vi.spyOn(api, 'getTrackedTelemetryLatest');
    renderSidebar();
    expect(spy).not.toHaveBeenCalled();
  });
});
