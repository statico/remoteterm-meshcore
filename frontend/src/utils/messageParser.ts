/**
 * Parse sender from channel message text.
 * Channel messages have format "sender: message".
 */
const HASHTAG_CHANNEL_REFERENCE_PATTERN = /(^|\s)(#[a-z0-9]+(?:-[a-z0-9]+)*)(?=$|[\s.,;:])/g;

export function parseSenderFromText(text: string): { sender: string | null; content: string } {
  const colonIndex = text.indexOf(': ');
  if (colonIndex > 0 && colonIndex < 50) {
    const potentialSender = text.substring(0, colonIndex);
    // Check for colon in potential sender (would indicate it's not a simple name)
    if (!potentialSender.includes(':')) {
      return {
        sender: potentialSender,
        content: text.substring(colonIndex + 2),
      };
    }
  }
  return { sender: null, content: text };
}

export interface HashtagChannelReference {
  label: string;
  start: number;
  end: number;
}

export function findLinkedChannelReferences(text: string): HashtagChannelReference[] {
  const references: HashtagChannelReference[] = [];
  let match: RegExpExecArray | null;

  HASHTAG_CHANNEL_REFERENCE_PATTERN.lastIndex = 0;
  while ((match = HASHTAG_CHANNEL_REFERENCE_PATTERN.exec(text)) !== null) {
    const prefix = match[1];
    const label = match[2];
    const start = match.index + prefix.length;
    references.push({
      label,
      start,
      end: start + label.length,
    });
  }

  return references;
}

/**
 * Format a Unix timestamp to a time string.
 * Shows date for messages not from today.
 */
// Built once: toLocale*String with options builds a new formatter per call,
// which was most of a message row's render cost.
const TIME_FORMAT = new Intl.DateTimeFormat([], {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const time = TIME_FORMAT.format(date);
  if (date.toDateString() === new Date().toDateString()) {
    return time;
  }
  // Show short date for older messages
  return `${SHORT_DATE_FORMAT.format(date)} ${time}`;
}

/** Twitter-style age of a Unix timestamp: "now", "5m", "3h", "2d", then "Mar 4". */
export function formatShortAgo(timestamp: number, nowMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000 - timestamp));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  return SHORT_DATE_FORMAT.format(new Date(timestamp * 1000));
}

/** Check if a message text contains a mention of the given name in @[name] format. */
export function messageContainsMention(text: string, name: string | null): boolean {
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentionPattern = new RegExp(`@\\[${escaped}\\]`, 'i');
  return mentionPattern.test(text);
}
