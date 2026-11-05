import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Channel, Contact, Message, MessagePath, RadioConfig, RawPacket } from '../types';
import { CONTACT_TYPE_ROOM } from '../types';
import { api } from '../api';
import {
  findLinkedChannelReferences,
  formatTime,
  parseSenderFromText,
} from '../utils/messageParser';
import {
  encodeReaction,
  giphyUrlForId,
  parseGif,
  QUICK_EMOJIS,
  parseMeshCoreOneReaction,
  parseReaction,
  splitReplyMention,
} from '../utils/meshcoreOpenPayloads';
import { useRichPayloads } from '../contexts/RichPayloadContext';
import { usePathHopWidth } from '../contexts/PathHopWidthContext';
import { formatHopCounts, formatPathHopWidths, type SenderInfo } from '../utils/pathUtils';
import { getDirectContactRoute } from '../utils/pathUtils';
import { ContactAvatar } from './ContactAvatar';
import { PathModal } from './PathModal';
import { RawPacketInspectorDialog } from './RawPacketDetailModal';
import { toast } from './ui/sonner';
import { handleKeyboardActivate } from '../utils/a11y';
import { Smile } from 'lucide-react';
import { Virtualizer, type VirtualizerHandle } from 'virtua';
import { cn } from '@/lib/utils';
import { LoadingIndicator } from './LoadingIndicator';
import { MessageListSkeleton } from './LoadingSkeletons';

interface MessageListProps {
  messages: Message[];
  contacts: Contact[];
  channels?: Channel[];
  loading: boolean;
  loadingOlder?: boolean;
  hasOlderMessages?: boolean;
  /** Id of the oldest unread message, from the server. Null when nothing is unread. */
  unreadMarkerMessageId?: number | null;
  onDismissUnreadMarker?: () => void;
  /** Called when the unread boundary is not in loaded history and must be jumped to. */
  onNavigateToUnread?: (messageId: number) => void;
  onSenderClick?: (sender: string) => void;
  onLoadOlder?: () => void;
  onResendChannelMessage?: (messageId: number, newTimestamp?: boolean) => void;
  onChannelReferenceClick?: (channelName: string) => void;
  radioName?: string;
  config?: RadioConfig | null;
  onOpenContactInfo?: (publicKey: string, fromChannel?: boolean) => void;
  targetMessageId?: number | null;
  onTargetReached?: () => void;
  hasNewerMessages?: boolean;
  loadingNewer?: boolean;
  onLoadNewer?: () => void;
  onJumpToBottom?: () => void;
  preSorted?: boolean;
  /** Send an encoded MeshCore Open reaction payload for a message. */
  onSendReaction?: (payload: string) => Promise<void>;
}

// Renders a MeshCore Open GIF payload, falling back to the raw text on load error.
function GifPayload({ gifId, rawText }: { gifId: string; rawText: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <>{rawText}</>;
  }
  const url = giphyUrlForId(gifId);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block"
      title="Open GIF on Giphy"
    >
      <img
        src={url}
        alt="GIF"
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-w-[240px] max-h-[240px] rounded-md"
      />
    </a>
  );
}

// Renders a reaction generically (emoji + "reacted"); the target message is not
// resolved (see issues #291 and #354). MeshCore One reactions name the target's
// sender, so show that when it is there.
function ReactionPayload({ emoji, targetSender }: { emoji: string; targetSender?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xl leading-none">{emoji}</span>
      <span className="text-xs text-muted-foreground italic">
        {targetSender ? `reacted to ${targetSender}` : 'reacted'}
      </span>
    </span>
  );
}

// One-tap reaction picker: the six quick emoji meshcore-open offers first. The
// full 184-emoji table is only used for decoding what others send.
function ReactionPicker({
  message,
  radioName,
  onSendReaction,
}: {
  message: Message;
  radioName?: string;
  onSendReaction: (payload: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  // meshcore-open hashes the target with its sender's name on channels, and
  // without it in a 1:1 chat where the sender is implicit.
  const targetSender = message.type === 'CHAN' ? (message.sender_name ?? radioName ?? null) : null;

  const react = (emoji: string) => {
    setOpen(false);
    const payload = encodeReaction(emoji, message.sender_timestamp!, targetSender, message.text);
    if (!payload) return;
    void onSendReaction(payload).catch((err) => {
      toast.error('Failed to send reaction', {
        description: err instanceof Error ? err.message : 'Check radio connection',
      });
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        aria-label="React to this message"
        title="React"
        onClick={() => setOpen(true)}
        className="reaction-picker-button self-center mx-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
      >
        <Smile className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }
  return (
    <span className="self-center mx-1 flex items-center gap-0.5 rounded-md border border-border bg-background px-1 py-0.5 shadow-sm">
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React with ${emoji}`}
          onClick={() => react(emoji)}
          className="rounded px-1 text-base leading-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        aria-label="Cancel reaction"
        onClick={() => setOpen(false)}
        className="rounded px-1 text-xs leading-none text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ✕
      </button>
    </span>
  );
}

// Render a bare payload body (no reply prefix) into its rich node, or null.
function renderPayloadBody(body: string): ReactNode | null {
  const gifId = parseGif(body);
  if (gifId) {
    return <GifPayload gifId={gifId} rawText={body} />;
  }
  const reaction = parseReaction(body) ?? parseMeshCoreOneReaction(body);
  if (reaction) {
    return <ReactionPayload emoji={reaction.emoji} targetSender={reaction.targetSender} />;
  }
  return null;
}

// Recognize a MeshCore Open payload and render it. Handles both a whole-message
// payload ("g:<id>") and a reply-prefixed one ("@[Name] g:<id>") — the form
// meshcore-open sends when a GIF/reaction is a reply, which otherwise renders as
// raw text (issue #291). Returns null when the content is not a recognized
// payload, so the caller renders normally.
function renderMeshcoreOpenPayload(
  content: string,
  radioName?: string,
  onChannelReferenceClick?: (channelName: string) => void
): ReactNode | null {
  const whole = renderPayloadBody(content);
  if (whole) return whole;

  const split = splitReplyMention(content);
  if (split) {
    const body = renderPayloadBody(split.body);
    if (body) {
      // Preserve the reply mention (rendered as a normal @[Name] mention) so the
      // GIF/reaction still reads as a reply to that person.
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {renderTextWithMentions(split.mention, radioName, onChannelReferenceClick)}
          {body}
        </span>
      );
    }
  }
  return null;
}

// URL regex for linkifying plain text
const URL_PATTERN =
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;

function renderChannelReferences(
  text: string,
  keyPrefix: string,
  onChannelReferenceClick?: (channelName: string) => void
): ReactNode[] {
  const references = findLinkedChannelReferences(text);
  if (references.length === 0) {
    return [text];
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  references.forEach((reference, index) => {
    if (reference.start > lastIndex) {
      parts.push(text.slice(lastIndex, reference.start));
    }

    const className =
      'rounded px-0.5 font-medium text-primary underline underline-offset-2 transition-colors';
    if (onChannelReferenceClick) {
      parts.push(
        <button
          key={`${keyPrefix}-channel-${index}`}
          type="button"
          className={cn(
            className,
            'inline border-0 bg-transparent p-0 align-baseline hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          onClick={() => onChannelReferenceClick(reference.label)}
        >
          {reference.label}
        </button>
      );
    } else {
      parts.push(
        <span key={`${keyPrefix}-channel-${index}`} className={className}>
          {reference.label}
        </span>
      );
    }

    lastIndex = reference.end;
  });

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

// Helper to convert URLs and channel references in a plain text string into rich content
function linkifyText(
  text: string,
  keyPrefix: string,
  onChannelReferenceClick?: (channelName: string) => void
): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIndex = 0;

  URL_PATTERN.lastIndex = 0;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        ...renderChannelReferences(
          text.slice(lastIndex, match.index),
          `${keyPrefix}-text-${keyIndex}`,
          onChannelReferenceClick
        )
      );
    }
    parts.push(
      <a
        key={`${keyPrefix}-link-${keyIndex++}`}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline hover:text-primary/80"
      >
        {match[0]}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex === 0) {
    return renderChannelReferences(text, keyPrefix, onChannelReferenceClick);
  }
  if (lastIndex < text.length) {
    parts.push(
      ...renderChannelReferences(
        text.slice(lastIndex),
        `${keyPrefix}-tail`,
        onChannelReferenceClick
      )
    );
  }
  return parts;
}

// Helper to render text with highlighted @[Name] mentions and clickable URLs
export function renderTextWithMentions(
  text: string,
  radioName?: string,
  onChannelReferenceClick?: (channelName: string) => void
): ReactNode {
  const mentionPattern = /@\[([^\]]+)\]/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIndex = 0;

  while ((match = mentionPattern.exec(text)) !== null) {
    // Add text before the match (with linkification)
    if (match.index > lastIndex) {
      parts.push(
        ...linkifyText(
          text.slice(lastIndex, match.index),
          `pre-${keyIndex}`,
          onChannelReferenceClick
        )
      );
    }

    const mentionedName = match[1];
    const isOwnMention = radioName ? mentionedName === radioName : false;

    parts.push(
      <span
        key={`mention-${keyIndex++}`}
        className={cn(
          'rounded px-0.5',
          isOwnMention ? 'bg-primary/30 text-primary font-medium' : 'bg-muted-foreground/20'
        )}
      >
        @[{mentionedName}]
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match (with linkification)
  if (lastIndex < text.length) {
    parts.push(...linkifyText(text.slice(lastIndex), `post-${keyIndex}`, onChannelReferenceClick));
  }

  return parts.length > 0 ? parts : text;
}

// Clickable hop count badge that opens the path modal
interface HopCountBadgeProps {
  paths: MessagePath[];
  onClick: () => void;
  variant: 'header' | 'inline';
}

function HopCountBadge({ paths, onClick, variant }: HopCountBadgeProps) {
  const { showPathHopWidth } = usePathHopWidth();
  const hopInfo = formatHopCounts(paths);
  const widthLabel = showPathHopWidth ? formatPathHopWidths(paths) : null;
  const label = widthLabel ? `(${hopInfo.display} · ${widthLabel})` : `(${hopInfo.display})`;

  const className =
    variant === 'header'
      ? 'font-normal text-muted-foreground ml-1 text-[0.6875rem] cursor-pointer hover:text-primary hover:underline'
      : 'text-[0.625rem] text-muted-foreground ml-1 cursor-pointer hover:text-primary hover:underline';

  return (
    <span
      className={className}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyboardActivate}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={widthLabel ? `View message path (${widthLabel} per hop)` : 'View message path'}
      aria-label={`${hopInfo.display}${widthLabel ? `, ${widthLabel} per hop` : ''}, view path`}
    >
      {label}
    </span>
  );
}

// Region scope badge for messages that arrived via a transport-routed (region-scoped) packet.
function RegionBadge({ region }: { region: string }) {
  return (
    <span
      className="ml-1.5 align-middle text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
      title={`Regional scope: ${region}`}
    >
      {region}
    </span>
  );
}

const RESEND_WINDOW_SECONDS = 30;
const CORRUPT_SENDER_LABEL = '<No name -- corrupt packet?>';
const ANALYZE_PACKET_NOTICE =
  'This analyzer shows one stored full packet copy only. When multiple receives have identical payloads, the backend deduplicates them to a single stored packet and appends any additional receive paths onto the message path history instead of storing multiple full packet copies.';

function hasUnexpectedControlChars(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Height of the slot above the rows that holds the "older messages" banner. It is
 * fixed, whatever the banner shows, so it can be handed to the virtualizer as a
 * constant `startMargin`: a slot that grew and shrank with the banner would move
 * every row under the reader each time pagination started or stopped.
 */
const TOP_SLOT_HEIGHT = 40;

/** Distance in px from an edge that counts as "at" it (stick-to-bottom, paging). */
const EDGE_THRESHOLD = 100;

interface ContactLookup {
  byKey: Map<string, Contact>;
  byName: Map<string, Contact>;
}

function buildContactLookup(contacts: Contact[]): ContactLookup {
  const byKey = new Map<string, Contact>();
  const byName = new Map<string, Contact>();
  for (const contact of contacts) {
    if (!byKey.has(contact.public_key)) byKey.set(contact.public_key, contact);
    // First match wins, like the Array.find this replaces.
    if (contact.name && !byName.has(contact.name)) byName.set(contact.name, contact);
  }
  return { byKey, byName };
}

function getDmContact(msg: Message, lookup: ContactLookup): Contact | null {
  if (msg.type !== 'PRIV' || !msg.conversation_key) return null;
  return lookup.byKey.get(msg.conversation_key) ?? null;
}

function isCorruptUnnamedChannelMessage(msg: Message, parsedSender: string | null): boolean {
  return (
    msg.type === 'CHAN' &&
    !msg.outgoing &&
    !msg.sender_name &&
    !msg.sender_key &&
    !parsedSender &&
    hasUnexpectedControlChars(msg.text)
  );
}

/** Groups consecutive messages from one sender; a change of key starts a new group. */
function getSenderGroupKey(msg: Message, lookup: ContactLookup): string {
  if (msg.outgoing) return '__outgoing__';
  const parsedSender = msg.type === 'CHAN' ? parseSenderFromText(msg.text).sender : null;
  const senderName =
    msg.type === 'PRIV'
      ? getDmContact(msg, lookup)?.type === CONTACT_TYPE_ROOM
        ? msg.sender_name || null
        : null
      : msg.sender_name || parsedSender;
  if (msg.type === 'PRIV' && msg.sender_key) return `key:${msg.sender_key}`;
  if (msg.type === 'PRIV' && senderName) return `name:${senderName}`;
  if (msg.type === 'PRIV' && msg.conversation_key) return msg.conversation_key;
  if (msg.sender_key) return `key:${msg.sender_key}`;
  if (senderName) return `name:${senderName}`;
  if (isCorruptUnnamedChannelMessage(msg, parsedSender)) return `corrupt:${msg.id}`;
  return '__unknown__';
}

function senderInfoFromContact(contact: Contact, name: string): SenderInfo {
  const directRoute = getDirectContactRoute(contact);
  return {
    name,
    publicKeyOrPrefix: contact.public_key,
    lat: contact.lat,
    lon: contact.lon,
    pathHashMode: directRoute?.path_hash_mode ?? null,
  };
}

function unknownSenderInfo(name: string, publicKeyOrPrefix: string): SenderInfo {
  return { name, publicKeyOrPrefix, lat: null, lon: null, pathHashMode: null };
}

// Build sender info for the path modal
function getSenderInfo(
  msg: Message,
  contact: Contact | null,
  parsedSender: string | null,
  lookup: ContactLookup
): SenderInfo {
  const findSender = (name: string | null) =>
    (msg.sender_key ? lookup.byKey.get(msg.sender_key) : null) ||
    (name ? lookup.byName.get(name) : null) ||
    null;

  if (
    msg.type === 'PRIV' &&
    contact?.type === CONTACT_TYPE_ROOM &&
    (msg.sender_key || msg.sender_name)
  ) {
    const author = findSender(msg.sender_name);
    if (author) {
      return senderInfoFromContact(
        author,
        author.name || msg.sender_name || author.public_key.slice(0, 12)
      );
    }
    return unknownSenderInfo(msg.sender_name || msg.sender_key || 'Unknown', msg.sender_key || '');
  }
  if (msg.type === 'PRIV' && contact) {
    return senderInfoFromContact(contact, contact.name || contact.public_key.slice(0, 12));
  }
  if (msg.type === 'CHAN') {
    const senderName = msg.sender_name || parsedSender;
    const senderContact = findSender(senderName);
    if (senderContact) {
      return senderInfoFromContact(
        senderContact,
        senderContact.name || senderName || senderContact.public_key.slice(0, 12)
      );
    }
    if (senderName || msg.sender_key) {
      return unknownSenderInfo(
        senderName || msg.sender_key || 'Unknown',
        msg.sender_key || msg.conversation_key || ''
      );
    }
  }
  if (parsedSender) {
    const senderContact = lookup.byName.get(parsedSender);
    if (senderContact) return senderInfoFromContact(senderContact, parsedSender);
  }
  return unknownSenderInfo(parsedSender || 'Unknown', msg.conversation_key || '');
}

interface SelectedPath {
  paths: MessagePath[];
  senderInfo: SenderInfo;
  messageId?: number;
  packetId?: number | null;
  isOutgoingChan?: boolean;
}

interface MessageRowProps {
  msg: Message;
  isFirstMessage: boolean;
  isFirstInGroup: boolean;
  showUnreadMarker: boolean;
  isHighlighted: boolean;
  lookup: ContactLookup;
  radioName?: string;
  renderRichPayloads: boolean;
  selfSenderInfo: SenderInfo;
  canResendChannel: boolean;
  onSelectPath: (path: SelectedPath) => void;
  onSenderClick?: (sender: string) => void;
  onChannelReferenceClick?: (channelName: string) => void;
  onOpenContactInfo?: (publicKey: string, fromChannel?: boolean) => void;
  onSendReaction?: (payload: string) => Promise<void>;
  onDismissUnreadMarker?: () => void;
  setUnreadMarkerElement: (node: HTMLButtonElement | HTMLDivElement | null) => void;
}

/**
 * One message. Memoized: the virtualizer re-renders on every scroll frame and asks
 * for each visible row again, so a row whose props have not changed must cost
 * nothing. Every prop is either data for this row or a stable callback.
 */
const MessageRow = memo(function MessageRow({
  msg,
  isFirstMessage,
  isFirstInGroup,
  showUnreadMarker,
  isHighlighted,
  lookup,
  radioName,
  renderRichPayloads,
  selfSenderInfo,
  canResendChannel,
  onSelectPath,
  onSenderClick,
  onChannelReferenceClick,
  onOpenContactInfo,
  onSendReaction,
  onDismissUnreadMarker,
  setUnreadMarkerElement,
}: MessageRowProps) {
  // For DMs, look up contact; for channel messages, use parsed sender
  const contact = getDmContact(msg, lookup);
  const isRoomServer = contact?.type === CONTACT_TYPE_ROOM;

  // Only parse "sender: text" prefix for channel messages — DMs never carry
  // an in-text sender prefix, so parsing them would incorrectly strip
  // user text that happens to contain a colon (e.g. "TEST1: TEST2").
  const { sender, content } =
    msg.type === 'PRIV' ? { sender: null, content: msg.text } : parseSenderFromText(msg.text);
  const directSenderName = msg.type === 'PRIV' && isRoomServer ? msg.sender_name || null : null;
  const channelSenderName = msg.type === 'CHAN' ? msg.sender_name || sender : null;
  const channelSenderContact =
    msg.type === 'CHAN' && channelSenderName ? lookup.byName.get(channelSenderName) : undefined;
  const isCorruptChannelMessage = isCorruptUnnamedChannelMessage(msg, sender);
  const displaySender = msg.outgoing
    ? 'You'
    : directSenderName ||
      (isRoomServer && msg.sender_key ? msg.sender_key.slice(0, 8) : null) ||
      contact?.name ||
      channelSenderName ||
      (isCorruptChannelMessage
        ? CORRUPT_SENDER_LABEL
        : msg.conversation_key?.slice(0, 8) || 'Unknown');

  const canClickSender =
    !msg.outgoing &&
    onSenderClick &&
    displaySender !== 'Unknown' &&
    displaySender !== CORRUPT_SENDER_LABEL;

  const showAvatar = !msg.outgoing && isFirstInGroup;

  // Get avatar info for incoming messages
  let avatarName: string | null = null;
  let avatarKey: string = '';
  let avatarVariant: 'default' | 'corrupt' = 'default';
  if (!msg.outgoing) {
    if (msg.type === 'PRIV' && msg.conversation_key) {
      if (isRoomServer) {
        avatarName = directSenderName;
        avatarKey = msg.sender_key || (avatarName ? `name:${avatarName}` : msg.conversation_key);
      } else {
        avatarName = contact?.name || null;
        avatarKey = msg.conversation_key;
      }
    } else if (isCorruptChannelMessage) {
      avatarName = CORRUPT_SENDER_LABEL;
      avatarKey = `corrupt:${msg.id}`;
      avatarVariant = 'corrupt';
    } else {
      // Channel message: use stored sender identity first, then parsed/fallback display name
      avatarName = channelSenderName || (displaySender !== 'Unknown' ? displaySender : null);
      avatarKey =
        msg.sender_key ||
        channelSenderContact?.public_key ||
        (avatarName ? `name:${avatarName}` : `message:${msg.id}`);
    }
  }
  const avatarActionLabel =
    avatarName && avatarName !== 'Unknown'
      ? `View info for ${avatarName}`
      : `View info for ${avatarKey.slice(0, 12)}`;

  const openIncomingPath = () =>
    onSelectPath({
      paths: msg.paths!,
      senderInfo: getSenderInfo(msg, contact, directSenderName || sender, lookup),
      messageId: msg.id,
      packetId: msg.packet_id,
    });

  return (
    // `flex flex-col` matters: it makes child margins (group spacing, the unread
    // divider) part of the height the virtualizer measures.
    <div className="flex w-full flex-col pb-0.5">
      {showUnreadMarker &&
        (onDismissUnreadMarker ? (
          <button
            ref={setUnreadMarkerElement}
            type="button"
            className="my-2 flex w-full items-center gap-3 text-left text-xs font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onDismissUnreadMarker}
          >
            <span className="h-px flex-1 bg-border" />
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1">
              Unread messages
            </span>
            <span className="h-px flex-1 bg-border" />
          </button>
        ) : (
          <div
            ref={setUnreadMarkerElement}
            className="my-2 flex w-full items-center gap-3 text-xs font-medium text-primary"
          >
            <span className="h-px flex-1 bg-border" />
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1">
              Unread messages
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        ))}
      <div
        data-message-id={msg.id}
        className={cn(
          'group flex items-start max-w-[85%]',
          msg.outgoing && 'flex-row-reverse self-end',
          isFirstInGroup && !isFirstMessage && 'mt-3'
        )}
      >
        {!msg.outgoing && (
          <div className="w-10 flex-shrink-0 flex items-start pt-0.5">
            {showAvatar &&
              avatarKey &&
              (onOpenContactInfo ? (
                <button
                  type="button"
                  className="avatar-action-button rounded-full border-none bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={avatarActionLabel}
                  onClick={() =>
                    onOpenContactInfo(
                      avatarKey,
                      msg.type === 'CHAN' || (msg.type === 'PRIV' && isRoomServer)
                    )
                  }
                >
                  <ContactAvatar
                    name={avatarName}
                    publicKey={avatarKey}
                    size={32}
                    clickable
                    variant={avatarVariant}
                  />
                </button>
              ) : (
                <span>
                  <ContactAvatar
                    name={avatarName}
                    publicKey={avatarKey}
                    size={32}
                    variant={avatarVariant}
                  />
                </span>
              ))}
          </div>
        )}
        <div
          className={cn(
            'py-1.5 px-3 rounded-lg min-w-0',
            msg.outgoing ? 'bg-msg-outgoing' : 'bg-msg-incoming',
            msg.pending && 'opacity-60',
            isHighlighted && 'message-highlight'
          )}
        >
          {showAvatar && (
            <div className="text-[0.8125rem] font-semibold text-foreground mb-0.5">
              {canClickSender ? (
                <span
                  className="cursor-pointer hover:text-primary transition-colors"
                  role="button"
                  tabIndex={0}
                  onKeyDown={handleKeyboardActivate}
                  onClick={() => onSenderClick(displaySender)}
                  title={`Mention ${displaySender}`}
                >
                  {displaySender}
                </span>
              ) : (
                displaySender
              )}
              <span className="font-normal text-muted-foreground ml-2 text-[0.6875rem]">
                {formatTime(msg.received_at)}
              </span>
              {!msg.outgoing && msg.paths && msg.paths.length > 0 && (
                <HopCountBadge paths={msg.paths} variant="header" onClick={openIncomingPath} />
              )}
              {msg.region && <RegionBadge region={msg.region} />}
            </div>
          )}
          <div className="break-words whitespace-pre-wrap">
            {(renderRichPayloads &&
              renderMeshcoreOpenPayload(content, radioName, onChannelReferenceClick)) ||
              content.split('\n').map((line, i, arr) => (
                <span key={i}>
                  {renderTextWithMentions(line, radioName, onChannelReferenceClick)}
                  {i < arr.length - 1 && <br />}
                </span>
              ))}
            {!showAvatar && (
              <>
                <span className="text-[0.625rem] text-muted-foreground ml-2">
                  {formatTime(msg.received_at)}
                </span>
                {!msg.outgoing && msg.paths && msg.paths.length > 0 && (
                  <HopCountBadge paths={msg.paths} variant="inline" onClick={openIncomingPath} />
                )}
                {msg.region && <RegionBadge region={msg.region} />}
              </>
            )}
            {msg.pending && (
              <span className="text-muted-foreground" title="Queued, waiting for the radio">
                {' '}
                …
              </span>
            )}
            {msg.outgoing &&
              !msg.pending &&
              (msg.acked > 0 ? (
                msg.paths && msg.paths.length > 0 ? (
                  <span
                    className="text-muted-foreground cursor-pointer hover:text-primary"
                    role="button"
                    tabIndex={0}
                    onKeyDown={handleKeyboardActivate}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPath({
                        paths: msg.paths!,
                        senderInfo: selfSenderInfo,
                        messageId: msg.id,
                        packetId: msg.packet_id,
                        isOutgoingChan: msg.type === 'CHAN' && canResendChannel,
                      });
                    }}
                    title="View echo paths"
                    aria-label={`Acknowledged, ${msg.acked} echo${msg.acked !== 1 ? 's' : ''} — view paths`}
                  >{` ✓${msg.acked > 1 ? msg.acked : ''}`}</span>
                ) : (
                  <span className="text-muted-foreground">{` ✓${msg.acked > 1 ? msg.acked : ''}`}</span>
                )
              ) : canResendChannel && msg.type === 'CHAN' ? (
                <span
                  className="text-muted-foreground cursor-pointer hover:text-primary"
                  role="button"
                  tabIndex={0}
                  onKeyDown={handleKeyboardActivate}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPath({
                      paths: [],
                      senderInfo: selfSenderInfo,
                      messageId: msg.id,
                      packetId: msg.packet_id,
                      isOutgoingChan: true,
                    });
                  }}
                  title="Message status"
                  aria-label="No echoes yet — view message status"
                >
                  {' '}
                  ?
                </span>
              ) : (
                <span className="text-muted-foreground" title="No repeats heard yet">
                  {' '}
                  ?
                </span>
              ))}
          </div>
        </div>
        {/* Gated on the rich-payload pref: with it off the reaction you
            just sent would render back to you as raw "r:..." text. */}
        {onSendReaction && renderRichPayloads && msg.sender_timestamp != null && (
          <ReactionPicker message={msg} radioName={radioName} onSendReaction={onSendReaction} />
        )}
      </div>
    </div>
  );
});

/**
 * True when `next` is `prev` with rows added only at the start: older history
 * loaded at the top. That is the one change Virtua's `shift` is for, and the one
 * change the anchor below must leave alone.
 */
export function isPrependOf(prev: readonly Message[], next: readonly Message[]): boolean {
  const added = next.length - prev.length;
  return (
    added > 0 &&
    prev.length > 0 &&
    next[added].id === prev[0].id &&
    next[next.length - 1].id === prev[prev.length - 1].id
  );
}

export function MessageList({
  messages,
  contacts,
  channels = [],
  loading,
  loadingOlder = false,
  hasOlderMessages = false,
  unreadMarkerMessageId,
  onDismissUnreadMarker,
  onNavigateToUnread,
  onSenderClick,
  onLoadOlder,
  onResendChannelMessage,
  onChannelReferenceClick,
  radioName,
  config,
  onOpenContactInfo,
  targetMessageId,
  onTargetReached,
  hasNewerMessages = false,
  loadingNewer = false,
  onLoadNewer,
  onJumpToBottom,
  preSorted = false,
  onSendReaction,
}: MessageListProps) {
  const { renderRichPayloads } = useRichPayloads();
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizerRef = useRef<VirtualizerHandle>(null);
  // Whether the reader is at the newest message. New rows follow only then.
  const atBottomRef = useRef(true);
  // The top visible message and how far into it the viewport starts, recorded on
  // every scroll. Lets an in-place change (a block filter, an unblock merge) put
  // the reader back on the same message instead of on the same pixel offset.
  const anchorRef = useRef<{ id: number; delta: number } | null>(null);
  // The list as last committed; compared against to classify each change.
  const committedMessagesRef = useRef<Message[]>([]);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [selectedPath, setSelectedPath] = useState<SelectedPath | null>(null);
  const [resendableIds, setResendableIds] = useState<Set<number>>(new Set());
  const resendTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const packetCacheRef = useRef<Map<number, RawPacket>>(new Map());
  const packetSignalOverrideRef = useRef<{ rssi: number | null; snr: number | null } | undefined>(
    undefined
  );
  const [packetInspectorSource, setPacketInspectorSource] = useState<
    | { kind: 'packet'; packet: RawPacket }
    | { kind: 'loading'; message: string }
    | { kind: 'unavailable'; message: string }
    | null
  >(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [showJumpToUnread, setShowJumpToUnread] = useState(false);
  const [jumpToUnreadDismissed, setJumpToUnreadDismissed] = useState(false);
  // The target id we already jumped to. Comparing ids (rather than a boolean reset
  // by a passive effect) matters: that effect also ran on mount, after the jump,
  // and re-armed it so the next list change yanked the reader back to the target.
  const scrolledTargetRef = useRef<number | null>(null);
  const unreadMarkerRef = useRef<HTMLButtonElement | HTMLDivElement | null>(null);

  const handleAnalyzePacket = useCallback(async (message: Message) => {
    // Extract signal from the first path if available
    const firstPath = message.paths?.[0];
    packetSignalOverrideRef.current =
      firstPath && (firstPath.rssi != null || firstPath.snr != null)
        ? { rssi: firstPath.rssi ?? null, snr: firstPath.snr ?? null }
        : undefined;

    if (message.packet_id == null) {
      setPacketInspectorSource({
        kind: 'unavailable',
        message:
          'No archival raw packet is available for this message, so packet analysis cannot be shown.',
      });
      return;
    }

    const cached = packetCacheRef.current.get(message.packet_id);
    if (cached) {
      setPacketInspectorSource({ kind: 'packet', packet: cached });
      return;
    }

    setPacketInspectorSource({ kind: 'loading', message: 'Loading packet analysis...' });

    try {
      const packet = await api.getPacket(message.packet_id);
      packetCacheRef.current.set(message.packet_id, packet);
      setPacketInspectorSource({ kind: 'packet', packet });
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Unknown error';
      const isMissing = error instanceof Error && /not found/i.test(error.message);
      if (!isMissing) {
        toast.error('Failed to load raw packet', { description });
      }
      setPacketInspectorSource({
        kind: 'unavailable',
        message: isMissing
          ? 'The archival raw packet for this message is no longer available. It may have been purged from Settings > Database, so only the stored message and merged route history remain.'
          : `Could not load the archival raw packet for this message: ${description}`,
      });
    }
  }, []);

  // Sort messages by received_at ascending (oldest first)
  // Note: Deduplication is handled by useConversationMessages.observeMessage()
  // and the database UNIQUE constraint on (type, conversation_key, text, sender_timestamp)
  const sortedMessages = useMemo(
    () =>
      preSorted
        ? messages
        : [...messages].sort((a, b) => a.received_at - b.received_at || a.id - b.id),
    [messages, preSorted]
  );
  const sortedMessagesRef = useRef(sortedMessages);
  sortedMessagesRef.current = sortedMessages;

  const contactLookup = useMemo(() => buildContactLookup(contacts), [contacts]);

  // One pass per list change, not one per row per render: each row needs to know
  // whether it starts a sender group, which depends on the row before it.
  const groupStarts = useMemo(() => {
    let prevKey: string | null = null;
    return sortedMessages.map((msg) => {
      const key = getSenderGroupKey(msg, contactLookup);
      const starts = key !== prevKey;
      prevKey = key;
      return starts;
    });
  }, [sortedMessages, contactLookup]);

  // Read during render on purpose: Virtua consumes `shift` in the same render that
  // changes the item count. The ref is only written after commit, so a discarded
  // or repeated render (StrictMode) sees the same answer.
  const shift = isPrependOf(committedMessagesRef.current, sortedMessages);

  const isNearBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) return true;
    return list.scrollHeight - list.scrollTop - list.clientHeight < EDGE_THRESHOLD;
  }, []);

  const scrollToIndex = useCallback(
    (index: number, align: 'start' | 'center' | 'end', offset = 0) => {
      if (index < 0) return;
      virtualizerRef.current?.scrollToIndex(index, { align, offset });
    },
    []
  );

  const hasNewerMessagesRef = useRef(hasNewerMessages);
  hasNewerMessagesRef.current = hasNewerMessages;
  const targetMessageIdRef = useRef(targetMessageId);
  targetMessageIdRef.current = targetMessageId;

  /**
   * Keeps the viewport where the reader expects it after the list changes.
   * Virtua does the hard parts: `shift` holds position across a prepend, and
   * scrollToIndex keeps correcting itself while the rows it lands on are measured.
   * What is left is deciding which of three things a change calls for.
   */
  useLayoutEffect(() => {
    const prev = committedMessagesRef.current;
    committedMessagesRef.current = sortedMessages;
    const last = sortedMessages.length - 1;
    if (!virtualizerRef.current || last < 0) return;

    // A pending jump-to-message owns the scroll; the target effect handles it.
    const targetPending =
      !!targetMessageIdRef.current && scrolledTargetRef.current !== targetMessageIdRef.current;

    if (prev.length === 0) {
      // First rows of this conversation: open at the newest message.
      if (!targetPending) {
        atBottomRef.current = true;
        scrollToIndex(last, 'end');
      }
      return;
    }
    if (isPrependOf(prev, sortedMessages)) return; // `shift` holds the position.

    if (atBottomRef.current && !hasNewerMessagesRef.current && !targetPending) {
      // Follow new messages (including sent ones). Skipped while browsing
      // mid-history, where forward pagination must append in place.
      if (sortedMessages[last].id !== prev[prev.length - 1].id || last !== prev.length - 1) {
        scrollToIndex(last, 'end');
      }
      return;
    }

    // In-place change: rows were removed (block) or inserted (unblock, reconnect
    // gap fill) somewhere above. Put the top visible message back where it was.
    const anchor = anchorRef.current;
    if (!anchor) return;
    const nextIndex = sortedMessages.findIndex((msg) => msg.id === anchor.id);
    // ponytail: if the anchor row itself was removed the view keeps its pixel
    // offset; walk to the next surviving row if that ever matters.
    if (nextIndex === -1) return;
    if (prev.findIndex((msg) => msg.id === anchor.id) !== nextIndex) {
      scrollToIndex(nextIndex, 'start', anchor.delta);
    }
  }, [sortedMessages, scrollToIndex]);

  // Scroll to target message and highlight it
  useLayoutEffect(() => {
    if (!targetMessageId) {
      scrolledTargetRef.current = null; // cleared: a later jump to the same id runs again
      return;
    }
    if (scrolledTargetRef.current === targetMessageId || sortedMessages.length === 0) return;
    const targetIndex = sortedMessages.findIndex((msg) => msg.id === targetMessageId);
    if (targetIndex === -1) return;

    atBottomRef.current = false;
    scrollToIndex(targetIndex, 'center');
    setHighlightedMessageId(targetMessageId);
    scrolledTargetRef.current = targetMessageId;
    onTargetReached?.();
  }, [sortedMessages, targetMessageId, onTargetReached, scrollToIndex]);

  // Track resendable outgoing CHAN messages (within 30s window)
  useEffect(() => {
    if (!onResendChannelMessage) return;

    const now = Math.floor(Date.now() / 1000);
    const newResendable = new Set<number>();
    const timers = resendTimersRef.current;

    for (const msg of messages) {
      if (!msg.outgoing || msg.type !== 'CHAN' || msg.sender_timestamp === null) continue;
      const remaining = RESEND_WINDOW_SECONDS - (now - msg.sender_timestamp);
      if (remaining <= 0) continue;

      newResendable.add(msg.id);

      // Schedule removal if not already tracked
      if (!timers.has(msg.id)) {
        const timer = setTimeout(() => {
          setResendableIds((prev) => {
            const next = new Set(prev);
            next.delete(msg.id);
            return next;
          });
          timers.delete(msg.id);
        }, remaining * 1000);
        timers.set(msg.id, timer);
      }
    }

    setResendableIds((prev) => {
      if (prev.size === newResendable.size) {
        let changed = false;
        for (const id of newResendable) {
          if (!prev.has(id)) {
            changed = true;
            break;
          }
        }
        if (!changed) {
          return prev;
        }
      }

      return newResendable;
    });

    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [messages, onResendChannelMessage]);

  /**
   * Located by message id, not by timestamp. The previous `received_at > boundary`
   * scan returned 0 — the top of the loaded window — whenever the real boundary was
   * further back than anything loaded, so the divider silently pointed at the wrong
   * message. Matching on identity returns -1 in that case, which is the truth: the
   * boundary is elsewhere, and `boundaryOutsideWindow` below offers to go to it.
   */
  const unreadMarkerIndex = useMemo(() => {
    if (unreadMarkerMessageId == null) return -1;
    return sortedMessages.findIndex((msg) => msg.id === unreadMarkerMessageId);
  }, [sortedMessages, unreadMarkerMessageId]);

  // Unread exists, but the message it starts at has not been loaded.
  const boundaryOutsideWindow = unreadMarkerMessageId != null && unreadMarkerIndex === -1;

  const syncJumpToUnreadVisibility = useCallback(() => {
    if (jumpToUnreadDismissed) {
      setShowJumpToUnread(false);
      return;
    }
    // Boundary is real but out of the loaded window: always offer the jump.
    if (boundaryOutsideWindow) {
      setShowJumpToUnread(true);
      return;
    }
    if (unreadMarkerIndex === -1) {
      setShowJumpToUnread(false);
      return;
    }

    const marker = unreadMarkerRef.current;
    const list = listRef.current;
    if (!marker || !list) {
      setShowJumpToUnread(true);
      return;
    }

    const markerRect = marker.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();

    if (
      markerRect.width === 0 ||
      markerRect.height === 0 ||
      listRect.width === 0 ||
      listRect.height === 0
    ) {
      setShowJumpToUnread(true);
      return;
    }

    const markerVisible =
      markerRect.top >= listRect.top &&
      markerRect.bottom <= listRect.bottom &&
      markerRect.left >= listRect.left &&
      markerRect.right <= listRect.right;

    setShowJumpToUnread(!markerVisible);
  }, [jumpToUnreadDismissed, unreadMarkerIndex, boundaryOutsideWindow]);

  // Refs for scroll handler to read without causing callback recreation
  const onLoadOlderRef = useRef(onLoadOlder);
  const loadingOlderRef = useRef(loadingOlder);
  const hasOlderMessagesRef = useRef(hasOlderMessages);
  const onLoadNewerRef = useRef(onLoadNewer);
  const loadingNewerRef = useRef(loadingNewer);
  onLoadOlderRef.current = onLoadOlder;
  loadingOlderRef.current = loadingOlder;
  hasOlderMessagesRef.current = hasOlderMessages;
  onLoadNewerRef.current = onLoadNewer;
  loadingNewerRef.current = loadingNewer;

  const setUnreadMarkerElement = useCallback(
    (node: HTMLButtonElement | HTMLDivElement | null) => {
      unreadMarkerRef.current = node;
      syncJumpToUnreadVisibility();
    },
    [syncJumpToUnreadVisibility]
  );

  useEffect(() => {
    setJumpToUnreadDismissed(false);
  }, [unreadMarkerIndex]);

  useLayoutEffect(() => {
    syncJumpToUnreadVisibility();
  }, [messages, syncJumpToUnreadVisibility]);

  // Stable: reads changing values from refs, so the virtualizer never re-subscribes.
  // Only reads scroll state here. Writing scrollTop from a scroll handler is what
  // fights iOS momentum scrolling; all position corrections are left to Virtua.
  const handleScroll = useCallback(
    (offset: number) => {
      const handle = virtualizerRef.current;
      if (handle) {
        const index = handle.findItemIndex(offset);
        const msg = sortedMessagesRef.current[index];
        anchorRef.current = msg
          ? { id: msg.id, delta: offset - TOP_SLOT_HEIGHT - handle.getItemOffset(index) }
          : null;
      }

      const nearBottom = isNearBottom();
      atBottomRef.current = nearBottom;
      setShowScrollToBottom(!nearBottom);

      if (
        onLoadOlderRef.current &&
        !loadingOlderRef.current &&
        hasOlderMessagesRef.current &&
        offset < EDGE_THRESHOLD
      ) {
        onLoadOlderRef.current();
      }

      if (
        onLoadNewerRef.current &&
        !loadingNewerRef.current &&
        hasNewerMessagesRef.current &&
        nearBottom
      ) {
        onLoadNewerRef.current();
      }
      syncJumpToUnreadVisibility();
    },
    [isNearBottom, syncJumpToUnreadVisibility]
  );

  // Scroll to bottom handler (or jump to bottom if viewing historical messages)
  const scrollToBottom = useCallback(() => {
    if (hasNewerMessages && onJumpToBottom) {
      onJumpToBottom();
      return;
    }
    atBottomRef.current = true;
    scrollToIndex(sortedMessages.length - 1, 'end');
  }, [hasNewerMessages, onJumpToBottom, scrollToIndex, sortedMessages.length]);

  // Sender info for outgoing messages (used by path modal on own messages)
  const selfSenderInfo = useMemo<SenderInfo>(
    () => ({
      name: config?.name || 'Unknown',
      publicKeyOrPrefix: config?.public_key || '',
      lat: config?.lat ?? null,
      lon: config?.lon ?? null,
      pathHashMode: config?.path_hash_mode ?? null,
    }),
    [config?.name, config?.public_key, config?.lat, config?.lon, config?.path_hash_mode]
  );

  // Derive live so the byte-perfect button disables if the 30s window expires while modal is open
  const isSelectedMessageResendable =
    selectedPath?.messageId !== undefined && resendableIds.has(selectedPath.messageId);

  if (loading) {
    return (
      <MessageListSkeleton label="Loading messages..." className="flex-1 overflow-hidden p-4" />
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-5 text-center text-muted-foreground">
        No messages yet
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden relative">
      <div className="h-full overflow-y-auto px-4" ref={listRef}>
        <div className="flex items-center justify-center" style={{ height: TOP_SLOT_HEIGHT }}>
          {loadingOlder ? (
            <LoadingIndicator label="Loading older messages..." className="text-sm" />
          ) : hasOlderMessages ? (
            <span className="text-muted-foreground text-xs">Scroll up for older messages</span>
          ) : null}
        </div>
        <Virtualizer
          ref={virtualizerRef}
          scrollRef={listRef}
          data={sortedMessages}
          startMargin={TOP_SLOT_HEIGHT}
          shift={shift}
          onScroll={handleScroll}
        >
          {(msg, index) => (
            <MessageRow
              key={msg.id}
              msg={msg}
              isFirstMessage={index === 0}
              isFirstInGroup={groupStarts[index]}
              showUnreadMarker={unreadMarkerIndex === index}
              isHighlighted={highlightedMessageId === msg.id}
              lookup={contactLookup}
              radioName={radioName}
              renderRichPayloads={renderRichPayloads}
              selfSenderInfo={selfSenderInfo}
              canResendChannel={!!onResendChannelMessage}
              onSelectPath={setSelectedPath}
              onSenderClick={onSenderClick}
              onChannelReferenceClick={onChannelReferenceClick}
              onOpenContactInfo={onOpenContactInfo}
              onSendReaction={onSendReaction}
              onDismissUnreadMarker={onDismissUnreadMarker}
              setUnreadMarkerElement={setUnreadMarkerElement}
            />
          )}
        </Virtualizer>
        <div className="pb-4">
          {loadingNewer && (
            <LoadingIndicator label="Loading newer messages..." className="py-2 text-sm" />
          )}
          {!loadingNewer && hasNewerMessages && (
            <div className="text-center py-2 text-muted-foreground text-xs">
              Scroll down for newer messages
            </div>
          )}
        </div>
      </div>

      {/* Scroll to bottom button */}
      {showJumpToUnread && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
          <div className="pointer-events-auto flex h-9 items-center overflow-hidden rounded-full border border-border bg-card shadow-lg transition-all hover:scale-105">
            <button
              type="button"
              onClick={() => {
                if (boundaryOutsideWindow && unreadMarkerMessageId != null) {
                  // Not in loaded history: hand off to the jump-to-message path,
                  // which loads a window around the boundary instead of paging
                  // everything between here and there.
                  onNavigateToUnread?.(unreadMarkerMessageId);
                } else if (unreadMarkerRef.current?.scrollIntoView) {
                  unreadMarkerRef.current.scrollIntoView({ block: 'center' });
                } else {
                  // The marker row is outside the rendered window — scroll by index.
                  scrollToIndex(unreadMarkerIndex, 'center');
                }
                setJumpToUnreadDismissed(true);
                setShowJumpToUnread(false);
              }}
              className="h-full px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Jump to unread
            </button>
            <button
              type="button"
              onClick={() => {
                setJumpToUnreadDismissed(true);
                setShowJumpToUnread(false);
              }}
              className="flex h-full w-9 items-center justify-center border-l border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Dismiss jump to unread"
              title="Dismiss jump to unread"
            >
              ×
            </button>
          </div>
        </div>
      )}
      {showScrollToBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 w-9 h-9 rounded-full bg-card hover:bg-accent border border-border flex items-center justify-center shadow-lg transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}

      {/* Path modal */}
      {selectedPath && (
        <PathModal
          open={true}
          onClose={() => setSelectedPath(null)}
          paths={selectedPath.paths}
          senderInfo={selectedPath.senderInfo}
          contacts={contacts}
          config={config ?? null}
          messageId={selectedPath.messageId}
          packetId={selectedPath.packetId}
          isOutgoingChan={selectedPath.isOutgoingChan}
          isResendable={isSelectedMessageResendable}
          onResend={onResendChannelMessage}
          onAnalyzePacket={
            selectedPath.packetId != null
              ? () => {
                  const message = messages.find((entry) => entry.id === selectedPath.messageId);
                  if (message) {
                    void handleAnalyzePacket(message);
                  }
                }
              : undefined
          }
        />
      )}
      {packetInspectorSource && (
        <RawPacketInspectorDialog
          open={packetInspectorSource !== null}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setPacketInspectorSource(null);
              packetSignalOverrideRef.current = undefined;
            }
          }}
          channels={channels}
          source={packetInspectorSource}
          title="Analyze Packet"
          description="On-demand raw packet analysis for a message-backed archival packet."
          notice={ANALYZE_PACKET_NOTICE}
          signalOverride={packetSignalOverrideRef.current}
        />
      )}
    </div>
  );
}
