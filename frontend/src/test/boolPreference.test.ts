import { beforeEach, describe, expect, it } from 'vitest';

import { getBoolPreference, setBoolPreference } from '../utils/boolPreference';
import { getShowBatteryPercent, setShowBatteryPercent } from '../utils/batteryDisplay';
import { getStatusDotPulseEnabled, setStatusDotPulseEnabled } from '../utils/statusDotPulse';
import { getTextReplaceEnabled, setTextReplaceEnabled } from '../utils/textReplace';
import {
  getShowRepeaterTemperature,
  setShowRepeaterTemperature,
} from '../utils/repeaterSidebarTelemetry';

const KEY = 'remoteterm-test-flag';

describe('boolPreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to off when unset', () => {
    expect(getBoolPreference(KEY)).toBe(false);
  });

  it('returns true when enabled', () => {
    localStorage.setItem(KEY, 'true');
    expect(getBoolPreference(KEY)).toBe(true);
  });

  it('treats any non-"true" value as off', () => {
    localStorage.setItem(KEY, 'yes');
    expect(getBoolPreference(KEY)).toBe(false);
  });

  it('persists when enabled and clears the key when disabled', () => {
    setBoolPreference(KEY, true);
    expect(localStorage.getItem(KEY)).toBe('true');

    setBoolPreference(KEY, false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it.each([
    ['remoteterm-show-battery-percent', getShowBatteryPercent, setShowBatteryPercent],
    ['remoteterm-status-dot-pulse', getStatusDotPulseEnabled, setStatusDotPulseEnabled],
    ['remoteterm-text-replace-enabled', getTextReplaceEnabled, setTextReplaceEnabled],
    [
      'remoteterm-sidebar-repeater-temperature',
      getShowRepeaterTemperature,
      setShowRepeaterTemperature,
    ],
  ])('%s keeps its storage key and format', (key, get, set) => {
    expect(get()).toBe(false);
    set(true);
    expect(localStorage.getItem(key)).toBe('true');
    expect(get()).toBe(true);
    set(false);
    expect(localStorage.getItem(key)).toBeNull();
  });
});
