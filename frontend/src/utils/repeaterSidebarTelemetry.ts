import type { TelemetryHistoryEntry } from '../types';
import { mvToPercent } from './batteryDisplay';

export const REPEATER_SIDEBAR_TELEMETRY_CHANGE_EVENT =
  'remoteterm-repeater-sidebar-telemetry-change';

export const REPEATER_POWER_MODES = ['off', 'volts', 'percent'] as const;
export type RepeaterPowerMode = (typeof REPEATER_POWER_MODES)[number];

const POWER_MODE_KEY = 'remoteterm-sidebar-repeater-power';
const TEMPERATURE_KEY = 'remoteterm-sidebar-repeater-temperature';

// The percent curve is for one Li-ion cell; above this it's a pack (e.g. 12V)
// and a percentage would be wrong, so show volts instead.
const SINGLE_CELL_MAX_VOLTS = 4.5;

export function getRepeaterPowerMode(): RepeaterPowerMode {
  try {
    const raw = localStorage.getItem(POWER_MODE_KEY);
    return REPEATER_POWER_MODES.includes(raw as RepeaterPowerMode)
      ? (raw as RepeaterPowerMode)
      : 'off';
  } catch {
    return 'off';
  }
}

export function setRepeaterPowerMode(mode: RepeaterPowerMode): void {
  try {
    localStorage.setItem(POWER_MODE_KEY, mode);
  } catch {
    // localStorage may be unavailable
  }
}

export function getShowRepeaterTemperature(): boolean {
  try {
    return localStorage.getItem(TEMPERATURE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setShowRepeaterTemperature(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(TEMPERATURE_KEY, 'true');
    } else {
      localStorage.removeItem(TEMPERATURE_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
}

export function formatRepeaterPower(
  volts: number | undefined,
  mode: RepeaterPowerMode
): string | null {
  if (mode === 'off' || !volts || volts <= 0) return null;
  if (mode === 'percent' && volts <= SINGLE_CELL_MAX_VOLTS) {
    return `${mvToPercent(Math.round(volts * 1000))}%`;
  }
  return `${volts.toFixed(1)}V`;
}

export function formatRepeaterTemperature(
  entry: TelemetryHistoryEntry,
  unit: 'metric' | 'imperial' | string
): string | null {
  const sensor = entry.data.lpp_sensors?.find((s) => s.type_name === 'temperature');
  if (!sensor || typeof sensor.value !== 'number') return null;
  return unit === 'imperial'
    ? `${Math.round((sensor.value * 9) / 5 + 32)}°F`
    : `${Math.round(sensor.value)}°C`;
}
