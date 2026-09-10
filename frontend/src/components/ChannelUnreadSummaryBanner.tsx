import { useEffect, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import { Button } from './ui/button';

interface ChannelUnreadSummaryBannerProps {
  /** Channel to summarize, and the read boundary to summarize from. */
  channelKey: string;
  after: number;
}

/**
 * Catch-up summary shown when opening a channel with unread messages. The
 * server decides whether summaries are configured at all, so an unconfigured
 * install just gets an empty response and renders nothing.
 */
export function ChannelUnreadSummaryBanner({ channelKey, after }: ChannelUnreadSummaryBannerProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setMessageCount(0);
    setDismissed(false);
    setLoading(true);

    api
      .summarizeChannelUnread(channelKey, after)
      .then((result) => {
        if (cancelled) return;
        setSummary(result.summary);
        setMessageCount(result.message_count);
      })
      .catch(() => {
        // A missed summary is not worth a toast — the messages are right there.
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [channelKey, after]);

  if (dismissed || (!loading && !summary)) return null;

  return (
    <div className="mx-4 mt-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-foreground">
              Unread summary
              {messageCount > 0 && (
                <span className="ml-1.5 font-normal text-muted-foreground">
                  ({messageCount} message{messageCount === 1 ? '' : 's'})
                </span>
              )}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss unread summary"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {loading ? (
            <p className="flex items-center gap-2 text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Summarizing unread messages…
            </p>
          ) : (
            <p className="whitespace-pre-wrap text-foreground/90">{summary}</p>
          )}
        </div>
      </div>
    </div>
  );
}
