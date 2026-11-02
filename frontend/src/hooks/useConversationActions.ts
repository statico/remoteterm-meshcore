import { useCallback, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { api } from '../api';
import { toast } from '../components/ui/sonner';
import type { MessageInputHandle } from '../components/MessageInput';
import type { Channel, Contact, Conversation, Message, PathDiscoveryResponse } from '../types';
import { mergeContactIntoList } from '../utils/contactMerge';

interface UseConversationActionsArgs {
  activeConversation: Conversation | null;
  activeConversationRef: MutableRefObject<Conversation | null>;
  setContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>;
  observeMessage: (msg: Message) => { added: boolean; activeConversation: boolean };
  messageInputRef: RefObject<MessageInputHandle | null>;
  senderName?: string;
}

interface UseConversationActionsResult {
  /** Sends accepted locally but not yet confirmed by the radio, oldest first. */
  pendingMessages: Message[];
  handleSendMessage: (text: string) => Promise<void>;
  handleResendChannelMessage: (messageId: number, newTimestamp?: boolean) => Promise<void>;
  handleSetChannelFloodScopeOverride: (
    channelKey: string,
    floodScopeOverride: string
  ) => Promise<void>;
  handleSetContactFloodScopeOverride: (
    publicKey: string,
    floodScopeOverride: string
  ) => Promise<void>;
  handleSetChannelPathHashModeOverride: (
    channelKey: string,
    pathHashModeOverride: number | null
  ) => Promise<void>;
  handleSenderClick: (sender: string) => void;
  handleTrace: () => Promise<void>;
  handlePathDiscovery: (publicKey: string) => Promise<PathDiscoveryResponse>;
}

export function useConversationActions({
  activeConversation,
  activeConversationRef,
  setContacts,
  setChannels,
  observeMessage,
  messageInputRef,
  senderName,
}: UseConversationActionsArgs): UseConversationActionsResult {
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  // Sends go out one at a time, in the order typed; the backend paces the radio.
  const sendChainRef = useRef<Promise<unknown>>(Promise.resolve());
  // Negative so they never collide with stored ids; increasing so ties on
  // received_at keep send order.
  const nextPendingIdRef = useRef(-1_000_000_000);

  const mergeChannelIntoList = useCallback(
    (updated: Channel) => {
      setChannels((prev) => {
        const existingIndex = prev.findIndex((channel) => channel.key === updated.key);
        if (existingIndex === -1) {
          return [...prev, updated].sort((a, b) => a.name.localeCompare(b.name));
        }
        const next = [...prev];
        next[existingIndex] = updated;
        return next;
      });
    },
    [setChannels]
  );

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!activeConversation) return;

      const conversationId = activeConversation.id;
      const isChannel = activeConversation.type === 'channel';
      const pending: Message = {
        id: nextPendingIdRef.current++,
        type: isChannel ? 'CHAN' : 'PRIV',
        conversation_key: conversationId,
        // Stored channel messages carry a "name: " prefix the list strips off.
        text: isChannel && senderName ? `${senderName}: ${text}` : text,
        sender_timestamp: null,
        received_at: Math.floor(Date.now() / 1000),
        paths: null,
        txt_type: 0,
        signature: null,
        sender_key: null,
        outgoing: true,
        acked: 0,
        sender_name: null,
        pending: true,
      };
      setPendingMessages((prev) => [...prev, pending]);

      const send = sendChainRef.current.then(() =>
        isChannel
          ? api.sendChannelMessage(conversationId, text)
          : api.sendDirectMessage(conversationId, text)
      );
      sendChainRef.current = send.catch(() => undefined);

      try {
        const sent = await send;
        if (activeConversationRef.current?.id === conversationId) {
          observeMessage(sent);
        }
      } finally {
        setPendingMessages((prev) => prev.filter((m) => m.id !== pending.id));
      }
    },
    [activeConversation, activeConversationRef, observeMessage, senderName]
  );

  const handleResendChannelMessage = useCallback(
    async (messageId: number, newTimestamp?: boolean) => {
      try {
        const resent = await api.resendChannelMessage(messageId, newTimestamp);
        const resentMessage = resent.message;
        if (
          newTimestamp &&
          resentMessage &&
          activeConversationRef.current?.type === 'channel' &&
          activeConversationRef.current.id === resentMessage.conversation_key
        ) {
          observeMessage(resentMessage);
        }
        toast.success(newTimestamp ? 'Message resent with new timestamp' : 'Message resent');
      } catch (err) {
        toast.error('Failed to resend', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    [activeConversationRef, observeMessage]
  );

  const handleSetChannelFloodScopeOverride = useCallback(
    async (channelKey: string, floodScopeOverride: string) => {
      try {
        const updated = await api.setChannelFloodScopeOverride(channelKey, floodScopeOverride);
        mergeChannelIntoList(updated);
        toast.success(
          updated.flood_scope_override ? 'Regional override saved' : 'Regional override cleared'
        );
      } catch (err) {
        toast.error('Failed to update regional override', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    [mergeChannelIntoList]
  );

  const handleSetContactFloodScopeOverride = useCallback(
    async (publicKey: string, floodScopeOverride: string) => {
      try {
        const updated = await api.setContactFloodScopeOverride(publicKey, floodScopeOverride);
        setContacts((prev) => mergeContactIntoList(prev, updated));
        toast.success(
          updated.flood_scope_override ? 'Regional override saved' : 'Regional override cleared'
        );
      } catch (err) {
        toast.error('Failed to update regional override', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    [setContacts]
  );

  const handleSetChannelPathHashModeOverride = useCallback(
    async (channelKey: string, pathHashModeOverride: number | null) => {
      try {
        const updated = await api.setChannelPathHashModeOverride(channelKey, pathHashModeOverride);
        mergeChannelIntoList(updated);
        toast.success(
          updated.path_hash_mode_override != null
            ? 'Path hop width override saved'
            : 'Path hop width override cleared'
        );
      } catch (err) {
        toast.error('Failed to update path hop width override', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    [mergeChannelIntoList]
  );

  const handleSenderClick = useCallback(
    (sender: string) => {
      messageInputRef.current?.appendText(`@[${sender}] `);
    },
    [messageInputRef]
  );

  const handleTrace = useCallback(async () => {
    if (!activeConversation || activeConversation.type !== 'contact') return;
    toast('Trace started...');
    try {
      const result = await api.requestTrace(activeConversation.id);
      const parts: string[] = [];
      if (result.remote_snr !== null) parts.push(`Remote SNR: ${result.remote_snr.toFixed(1)} dB`);
      if (result.local_snr !== null) parts.push(`Local SNR: ${result.local_snr.toFixed(1)} dB`);
      const detail = parts.join(', ');
      toast.success(detail ? `Trace complete! ${detail}` : 'Trace complete!');
    } catch (err) {
      toast.error('Trace failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [activeConversation]);

  const handlePathDiscovery = useCallback(
    async (publicKey: string) => {
      const result = await api.requestPathDiscovery(publicKey);
      setContacts((prev) => mergeContactIntoList(prev, result.contact));
      return result;
    },
    [setContacts]
  );

  return {
    pendingMessages,
    handleSendMessage,
    handleResendChannelMessage,
    handleSetChannelFloodScopeOverride,
    handleSetContactFloodScopeOverride,
    handleSetChannelPathHashModeOverride,
    handleSenderClick,
    handleTrace,
    handlePathDiscovery,
  };
}
