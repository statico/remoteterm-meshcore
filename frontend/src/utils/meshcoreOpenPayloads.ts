/**
 * Parsing for rich-chat payloads sent by MeshCore Open clients as ordinary
 * plaintext mesh messages.
 *
 * MeshCore Open encodes some rich features into the message body with a short
 * prefix. RemoteTerm recognizes two of them for display:
 *
 *   g:<gifId>        Giphy GIF        -> https://media.giphy.com/media/<id>/giphy.gif
 *   r:<hash>:<index> Emoji reaction   -> <index> picks an emoji from a fixed list
 *
 * Formats and the emoji table are ported verbatim from meshcore-open:
 *   lib/helpers/gif_helper.dart
 *   lib/helpers/reaction_helper.dart
 *   lib/widgets/emoji_picker.dart
 * (github.com/zjs81/meshcore-open, dev branch).
 *
 * Reaction support here is intentionally "generic display only": we decode the
 * emoji from <index> and show it, but we do NOT resolve <hash> back to the
 * target message (that requires porting Dart's String.hashCode). See issue #291.
 */

// --- Emoji table (order must match meshcore-open exactly for index compat) ---

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🔥'];

// prettier-ignore
const SMILEYS = [
  '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂',
  '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋',
  '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩',
  '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖',
  '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯',
  '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔',
  '🤭', '🤫', '🤥', '😶',
];

// prettier-ignore
const GESTURES = [
  '👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟', '🤘',
  '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚',
  '🖐️', '✋', '🖖', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️',
  '💅', '🤳', '💪',
];

// prettier-ignore
const HEARTS = [
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
  '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟',
  '💌', '💢', '💥', '💫', '💦', '💨', '🕳️', '💬', '👁️‍🗨️', '🗨️',
  '🗯️', '💭',
];

// prettier-ignore
const OBJECTS = [
  '🎉', '🎊', '🎈', '🎁', '🎀', '🪅', '🪆', '🏆', '🥇', '🥈',
  '🥉', '⚽', '⚾', '🥎', '🏀', '🏐', '🏈', '🏉', '🎾', '🥏',
  '🎳', '🏏', '🏑', '🏒', '🥍', '🏓', '🏸', '🥊', '🥋', '🥅',
  '⛳', '🔥', '⭐', '🌟', '✨', '⚡', '💡', '🔦', '🏮', '🪔',
  '📱', '💻', '⌚', '📷', '📺', '📻', '🎵', '🎶', '🚀',
];

/** Combined reaction emoji list, in the fixed index order used on the wire. */
export const REACTION_EMOJIS: readonly string[] = [
  ...QUICK_EMOJIS,
  ...SMILEYS,
  ...GESTURES,
  ...HEARTS,
  ...OBJECTS,
];

// --- GIF (g:<gifId>) ---

const GIF_PATTERN = /^g:([A-Za-z0-9_-]+)$/;

/**
 * Parse a MeshCore Open GIF payload. Returns the Giphy GIF id, or null if the
 * (trimmed) text is not a `g:<id>` payload.
 */
export function parseGif(text: string): string | null {
  const match = GIF_PATTERN.exec(text.trim());
  return match ? match[1] : null;
}

/** Build the Giphy media URL for a GIF id. */
export function giphyUrlForId(gifId: string): string {
  return `https://media.giphy.com/media/${gifId}/giphy.gif`;
}

// --- Reaction (r:<hash>:<index>) ---

const REACTION_PATTERN = /^r:([0-9a-f]{4}):([0-9a-f]{2})$/;

export interface ParsedReaction {
  /** The decoded reaction emoji. */
  emoji: string;
  /** Hash identifying the target message (not resolved here). */
  targetHash: string;
  /** Name of the target message's sender, when the payload carries one. */
  targetSender?: string;
}

/**
 * Parse a MeshCore Open reaction payload. Returns the decoded emoji and the
 * (unresolved) target-message hash, or null if the (trimmed) text is not a
 * valid `r:<hash>:<index>` payload or the index is out of range.
 */
export function parseReaction(text: string): ParsedReaction | null {
  const match = REACTION_PATTERN.exec(text.trim());
  if (!match) return null;
  const index = parseInt(match[2], 16);
  if (!Number.isInteger(index) || index < 0 || index >= REACTION_EMOJIS.length) {
    return null;
  }
  return { emoji: REACTION_EMOJIS[index], targetHash: match[1] };
}

// --- MeshCore One reaction ({emoji}@[{sender}]\n{hash}) ---

// MeshCore One (github.com/Avi0n/MeshCoreOne, docs/Reactions.md) speaks a
// different reaction dialect that meshcore-open users see too, and which
// otherwise renders as an emoji followed by a junk token (issue #354):
//
//   channel: {emoji}@[{targetSenderName}]\n{hash}
//   DM:      {emoji}\n{hash}
//
// A newer MC1 build swaps the first line to "@[{targetSenderName}]{emoji}", so
// both orders are accepted. <hash> is 8 Crockford Base32 chars (SHA-256 of the
// target text + its sender timestamp, first 5 bytes) — like the meshcore-open
// hash it is not resolved back to the target message here. There is no wire
// representation for removing a reaction.

// Crockford Base32 is case-insensitive and normalizes I/L -> 1 and O -> 0, so
// every letter but U can appear in a received hash.
const MC1_HASH_PATTERN = /^[0-9a-tv-z]{8}$/i;

// The first line is the emoji plus, on a channel reaction, the target's name in
// either order. MC1 only checks that the emoji segment is non-empty and starts
// with an emoji, so match it loosely and test the first character.
const MC1_HEAD_PATTERN = /^(?:([^@[\]]+)(?:@\[([^\]]+)\])?|@\[([^\]]+)\](.+))$/;
const EMOJI_START = /^\p{Extended_Pictographic}/u;

/**
 * Parse a MeshCore One reaction payload. Returns the emoji, the (unresolved)
 * target-message hash and, for channel reactions, the target sender's name;
 * null when the text is not a MeshCore One reaction.
 */
export function parseMeshCoreOneReaction(text: string): ParsedReaction | null {
  const lines = text.trim().split('\n');
  if (lines.length !== 2) return null;
  const hash = lines[1].trim();
  if (!MC1_HASH_PATTERN.test(hash)) return null;
  const head = MC1_HEAD_PATTERN.exec(lines[0].trim());
  if (!head) return null;
  const emoji = (head[1] ?? head[4]).trim();
  if (!EMOJI_START.test(emoji)) return null;
  const targetSender = head[2] ?? head[3];
  return targetSender ? { emoji, targetHash: hash, targetSender } : { emoji, targetHash: hash };
}

// --- Reply-mention prefix (@[senderName] <payload>) ---

// meshcore-open prefixes replies with "@[senderName] " before the message body
// (see meshcore-open channels.md / BLE_PROTOCOL.md). Its own display code strips
// that prefix before parsing rich payloads, so a GIF/reaction reply arrives on
// the wire as "@[Name] g:<id>". parseGif/parseReaction stay strict (whole-body
// only); this splits the reply prefix off so the remainder can be parsed.
const REPLY_MENTION_PREFIX = /^(@\[[^\]]+\])\s+([\s\S]+)$/;

export interface SplitReplyMention {
  /** The leading "@[Name]" reply-mention token. */
  mention: string;
  /** The message remainder after the reply-mention prefix. */
  body: string;
}

/**
 * Split a leading meshcore-open reply mention ("@[Name] ") off the text, or
 * return null when there is no such prefix.
 */
export function splitReplyMention(text: string): SplitReplyMention | null {
  const match = REPLY_MENTION_PREFIX.exec(text.trim());
  if (!match) return null;
  return { mention: match[1], body: match[2] };
}
