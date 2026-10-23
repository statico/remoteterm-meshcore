import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isAbortError } from '../api';
import type { Channel, Contact, Message } from '../types';
import { getStateKey } from '../utils/conversationState';
import { formatShortAgo, formatTime } from '../utils/messageParser';
import { ListSkeleton } from './LoadingSkeletons';
import { renderTextWithMentions } from './MessageList';
import type { SearchNavigateTarget } from './SearchView';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

export interface MentionsViewProps {
  contacts: Contact[];
  channels: Channel[];
  myName: string | null;
  /** stateKey -> conversation still has an unread mention */
  mentions: Record<string, boolean>;
  lastReadAts: Record<string, number | null>;
  /** Bumps when a new mention arrives, to refetch. */
  refreshNonce: number;
  onNavigateToMessage: (target: SearchNavigateTarget) => void;
}

export function MentionsView({
  contacts,
  channels,
  myName,
  mentions,
  lastReadAts,
  refreshNonce,
  onNavigateToMessage,
}: MentionsViewProps) {
  const [results, setResults] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback((offset: number) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    api
      .getMessages({ mentions: true, limit: PAGE_SIZE, offset }, controller.signal)
      .then((data) => {
        setResults((prev) => {
          if (offset === 0) return data;
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...data.filter((m) => !seen.has(m.id))];
        });
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch((err) => {
        if (!isAbortError(err)) console.error('Failed to load mentions:', err);
      })
      .finally(() => {
        if (abortRef.current === controller) setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchPage(0);
  }, [fetchPage, refreshNonce, myName]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const getConversationName = useCallback(
    (msg: Message): string => {
      if (msg.type === 'CHAN') {
        const channel = channels.find(
          (c) => c.key.toUpperCase() === msg.conversation_key.toUpperCase()
        );
        return channel?.name || msg.conversation_key.slice(0, 8);
      }
      const contact = contacts.find(
        (c) => c.public_key.toLowerCase() === msg.conversation_key.toLowerCase()
      );
      return contact?.name || msg.conversation_key.slice(0, 12);
    },
    [contacts, channels]
  );

  // Unread until the conversation is opened: the mention flag clears locally
  // on open, and last_read_at covers mentions older than the last visit.
  const isUnread = (msg: Message): boolean => {
    const key = getStateKey(msg.type === 'CHAN' ? 'channel' : 'contact', msg.conversation_key);
    return !!mentions[key] && msg.received_at > (lastReadAts[key] ?? 0);
  };

  const open = (msg: Message) =>
    onNavigateToMessage({
      id: msg.id,
      type: msg.type,
      conversation_key: msg.conversation_key,
      conversation_name: getConversationName(msg),
    });

  const token = myName ? `@[${myName}]` : null;
  const unreadCount = results.filter(isUnread).length;

  return (
    <div className="flex flex-col h-full min-h-0">
      <h2 className="flex items-center gap-2 px-4 py-2.5 border-b border-border font-semibold text-base">
        Mentions
        {unreadCount > 0 && (
          <span className="text-[0.625rem] font-medium px-1.5 py-0.5 rounded-full bg-badge-mention text-badge-mention-foreground">
            {unreadCount} new
          </span>
        )}
      </h2>

      <div className="flex-1 overflow-y-auto">
        {loading && results.length === 0 && <ListSkeleton label="Loading mentions..." />}

        {!loading && results.length === 0 && (
          <div className="p-8 text-center text-muted-foreground text-sm">
            <p>No mentions yet.</p>
            <p className="mt-2 text-xs">
              Messages that mention you{token ? ` (${token})` : ''} in channels and rooms show up
              here, newest first.
            </p>
          </div>
        )}

        {results.map((msg) => {
          const unread = isUnread(msg);
          const body =
            msg.sender_name && msg.text.startsWith(`${msg.sender_name}: `)
              ? msg.text.slice(msg.sender_name.length + 2)
              : msg.text;
          return (
            <div
              key={msg.id}
              className={cn(
                'px-4 py-3 border-b border-border/50 border-l-2 cursor-pointer hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                unread ? 'border-l-badge-mention bg-badge-mention/5' : 'border-l-transparent'
              )}
              role="button"
              tabIndex={0}
              aria-label={`${unread ? 'Unread mention' : 'Mention'} in ${getConversationName(msg)}`}
              onClick={() => open(msg)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  open(msg);
                }
              }}
            >
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="text-[0.8125rem] font-semibold text-foreground truncate">
                  {msg.sender_name || getConversationName(msg)}
                </span>
                {msg.sender_name && (
                  <span className="text-[0.6875rem] text-muted-foreground truncate">
                    in {getConversationName(msg)}
                  </span>
                )}
                <span
                  className="text-[0.6875rem] text-muted-foreground ml-auto flex-shrink-0"
                  title={formatTime(msg.received_at)}
                >
                  {formatShortAgo(msg.received_at)}
                </span>
              </div>
              <div
                className={cn(
                  'break-words whitespace-pre-wrap line-clamp-3',
                  !unread && 'text-foreground/80'
                )}
              >
                {body.split('\n').map((line, i, arr) => (
                  <span key={i}>
                    {renderTextWithMentions(line, myName ?? undefined)}
                    {i < arr.length - 1 && <br />}
                  </span>
                ))}
              </div>
            </div>
          );
        })}

        {loading && results.length > 0 && (
          <div className="p-4 text-center text-muted-foreground text-sm" role="status">
            Loading...
          </div>
        )}

        {hasMore && !loading && (
          <div className="p-4 text-center">
            <Button variant="outline" size="sm" onClick={() => fetchPage(results.length)}>
              Load older mentions
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
