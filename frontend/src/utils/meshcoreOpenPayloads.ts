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
 * Received reactions are displayed generically: we decode the emoji from
 * <index> and show it, but we do NOT resolve <hash> back to the target message
 * (see issue #291). Sending is the other direction and does need the hash, so
 * Dart's String.hashCode is ported below.
 */

// --- Emoji table (order must match meshcore-open exactly for index compat) ---

/** The six one-tap reaction emoji meshcore-open shows first. */
export const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🔥'];

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

// --- Encoding (sending) ---

// meshcore-open hashes the reaction target with Dart's String.hashCode, so we
// have to reproduce the Dart VM's string hash exactly or its clients will not
// match our reaction back to a message. Ported from runtime/vm/object.h
// (StringHasher) + runtime/vm/hash.h (CombineHashes/FinalizeHash) in the Dart
// SDK: Jenkins one-at-a-time over UTF-16 code units. The VM masks the result to
// 30 bits, which cannot affect the low 16 bits the reaction hash uses.
function dartStringHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash + s.charCodeAt(i)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  hash = (hash + (hash << 15)) >>> 0;
  hash &= 0x3fffffff;
  return hash === 0 ? 1 : hash;
}

/**
 * Compute the 4-hex-char target hash for a reaction, matching meshcore-open's
 * ReactionHelper.computeReactionHash: timestamp + [sender name] + the first 5
 * characters of the text. `senderName` is omitted for 1:1 chats, where the
 * sender is implicit.
 */
export function computeReactionHash(
  timestampSeconds: number,
  senderName: string | null,
  text: string
): string {
  const input = `${timestampSeconds}${senderName ?? ''}${text.slice(0, 5)}`;
  return (dartStringHash(input) & 0xffff).toString(16).padStart(4, '0');
}

/**
 * Encode a reaction payload ("r:<hash>:<index>") for a target message, or null
 * when the emoji is not in the shared table (so it has no wire index).
 */
export function encodeReaction(
  emoji: string,
  timestampSeconds: number,
  senderName: string | null,
  text: string
): string | null {
  const index = REACTION_EMOJIS.indexOf(emoji);
  if (index < 0) return null;
  return `r:${computeReactionHash(timestampSeconds, senderName, text)}:${index
    .toString(16)
    .padStart(2, '0')}`;
}

// meshcore-open's GifHelper.parseGif also accepts Giphy URLs, so accept the
// pasted-link forms when composing and send the short "g:<id>" over the air.
const GIPHY_URL_PATTERNS = [
  /^(?:https?:\/\/)?media\d*\.giphy\.com\/media\/(?:[A-Za-z0-9_-]+\/)?([A-Za-z0-9_-]+)\/giphy\.gif/,
  /^(?:https?:\/\/)?(?:www\.)?giphy\.com\/gifs\/(?:[A-Za-z0-9_-]*-)?([A-Za-z0-9_-]+)\/?$/,
];

/**
 * Extract a Giphy GIF id from composed text: either an already-encoded
 * "g:<id>" payload or a pasted Giphy link. Returns null for anything else.
 */
export function gifIdFromInput(text: string): string | null {
  const trimmed = text.trim();
  const bare = parseGif(trimmed);
  if (bare) return bare;
  for (const pattern of GIPHY_URL_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) return match[1];
  }
  return null;
}
