import { getBoolPreference, setBoolPreference } from './boolPreference';

export const BATTERY_DISPLAY_CHANGE_EVENT = 'remoteterm-battery-display-change';

// Meshtastic default OCV table (meshtastic/firmware src/power.h)
const OCV_TABLE: [number, number][] = [
  [4190, 100],
  [4050, 90],
  [3990, 80],
  [3890, 70],
  [3800, 60],
  [3720, 50],
  [3630, 40],
  [3530, 30],
  [3420, 20],
  [3300, 10],
  [3100, 0],
];

export function mvToPercent(mv: number): number {
  if (mv >= OCV_TABLE[0][0]) return 100;
  if (mv <= OCV_TABLE[OCV_TABLE.length - 1][0]) return 0;
  for (let i = 0; i < OCV_TABLE.length - 1; i++) {
    const [highMv, highPct] = OCV_TABLE[i];
    const [lowMv, lowPct] = OCV_TABLE[i + 1];
    if (mv >= lowMv)
      return Math.round(lowPct + ((mv - lowMv) / (highMv - lowMv)) * (highPct - lowPct));
  }
  return 0;
}

export function formatBatteryLabel(
  mv: number,
  showPercent: boolean,
  showVoltage: boolean
): string | null {
  if (!showPercent && !showVoltage) return null;
  const pct = mvToPercent(mv);
  if (showPercent && showVoltage) return `${pct}% (${mv}mV)`;
  if (showPercent) return `${pct}%`;
  return `${mv}mV`;
}

const PERCENT_KEY = 'remoteterm-show-battery-percent';
const VOLTAGE_KEY = 'remoteterm-show-battery-voltage';

export const getShowBatteryPercent = () => getBoolPreference(PERCENT_KEY);
export const setShowBatteryPercent = (enabled: boolean) => setBoolPreference(PERCENT_KEY, enabled);

export const getShowBatteryVoltage = () => getBoolPreference(VOLTAGE_KEY);
export const setShowBatteryVoltage = (enabled: boolean) => setBoolPreference(VOLTAGE_KEY, enabled);
