import { getBoolPreference, setBoolPreference } from './boolPreference';

export const STATUS_DOT_PULSE_CHANGE_EVENT = 'remoteterm-status-dot-pulse-change';
export const STATUS_DOT_PULSE_PACKET_EVENT = 'remoteterm-status-dot-pulse-packet';

const STORAGE_KEY = 'remoteterm-status-dot-pulse';

export type StatusDotPulseKind = 'channel' | 'dm' | 'advert' | 'other';

export const getStatusDotPulseEnabled = () => getBoolPreference(STORAGE_KEY);
export const setStatusDotPulseEnabled = (enabled: boolean) =>
  setBoolPreference(STORAGE_KEY, enabled);

function payloadTypeToPulseKind(payloadType: string | null | undefined): StatusDotPulseKind {
  switch (payloadType) {
    case 'GROUP_TEXT':
      return 'channel';
    case 'TEXT_MESSAGE':
      return 'dm';
    case 'ADVERT':
      return 'advert';
    default:
      return 'other';
  }
}

const PULSE_COLORS: Record<StatusDotPulseKind, string> = {
  channel: 'hsl(210, 90%, 55%)', // blue
  dm: 'hsl(270, 75%, 60%)', // purple
  advert: 'hsl(185, 85%, 55%)', // cyan
  other: 'hsl(140, 80%, 22%)', // dark green
};

export function pulseColorFor(kind: StatusDotPulseKind): string {
  return PULSE_COLORS[kind];
}

export const STATUS_DOT_PULSE_DURATION_MS = 250;

export function emitStatusDotPulse(payloadType: string | null | undefined): void {
  const kind = payloadTypeToPulseKind(payloadType);
  window.dispatchEvent(
    new CustomEvent<StatusDotPulseKind>(STATUS_DOT_PULSE_PACKET_EVENT, {
      detail: kind,
    })
  );
}
