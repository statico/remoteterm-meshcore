import { lazy, useEffect, useCallback, useRef, useState, useMemo, type MouseEvent } from 'react';
import { api } from './api';
import { takePrefetchOrFetch } from './prefetch';
import { useWebSocket } from './useWebSocket';
import { useAppShell } from './hooks/useAppShell';
import { useUnreadCounts } from './hooks/useUnreadCounts';
import { useConversationMessages } from './hooks/useConversationMessages';
import { useRadioControl } from './hooks/useRadioControl';
import { useAppSettings } from './hooks/useAppSettings';
import { useConversationRouter } from './hooks/useConversationRouter';
import { useContactsAndChannels } from './hooks/useContactsAndChannels';
import { useConversationActions } from './hooks/useConversationActions';
import { useConversationNavigation } from './hooks/useConversationNavigation';
import { useRealtimeAppState } from './hooks/useRealtimeAppState';
import { useBrowserNotifications } from './hooks/useBrowserNotifications';
import { useFaviconBadge, useUnreadTitle } from './hooks/useFaviconBadge';
import { toast } from './components/ui/sonner';
import { AppShell } from './components/AppShell';
import { getHealth, useRadioConnected } from './stores/healthStore';
import { StatusBar } from './components/StatusBar';
import { Sidebar } from './components/Sidebar';
import { ConversationPane } from './components/ConversationPane';
import { NewMessageModal } from './components/NewMessageModal';
import { BulkAddChannelResultModal } from './components/BulkAddChannelResultModal';
import { CommandPalette } from './components/CommandPalette';
import { SecurityWarningModal } from './components/SecurityWarningModal';
import type { SettingsSection } from './components/settings/settingsConstants';
import type { MessageInputHandle } from './components/MessageInput';
import { usePush } from './contexts/PushSubscriptionContext';
import { messageContainsMention } from './utils/messageParser';
import { getStateKey } from './utils/conversationState';
import type {
  AppSettings,
  BulkCreateHashtagChannelsResult,
  Channel,
  Contact,
  Conversation,
  Message,
} from './types';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM } from './types';
import { shouldAutoFocusInput } from './utils/autoFocusInput';
import { getContactDisplayName } from './utils/pubkey';

const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const CrackerPanel = lazy(() =>
  import('./components/CrackerPanel').then((m) => ({ default: m.CrackerPanel }))
);
const SearchView = lazy(() =>
  import('./components/SearchView').then((m) => ({ default: m.SearchView }))
);
// Info panes pull in recharts; keep them out of the main chunk until first opened.
const ContactInfoPane = lazy(() =>
  import('./components/ContactInfoPane').then((m) => ({ default: m.ContactInfoPane }))
);
const ChannelInfoPane = lazy(() =>
  import('./components/ChannelInfoPane').then((m) => ({ default: m.ChannelInfoPane }))
);

/** Stable fallback so memoized children don't see a new [] before settings load. */
const NO_STRINGS: string[] = [];

interface ChannelUnreadMarker {
  channelId: string;
  /** Id of the oldest unread message, straight from the server. */
  messageId: number | null;
  /**
   * The channel's last_read_at as it stood when the channel was opened. Opening
   * also marks the channel read, so this is captured with the marker — reading
   * it later would race with mark-read and leave nothing to summarize.
   */
  summarizeAfter: number;
}

interface NewMessagePrefillRequest {
  tab: 'hashtag';
  hashtagName: string;
  nonce: number;
}

/**
 * Which message the unread divider should sit on.
 *
 * Normally the server's first-unread id. The exception is a channel that has
 * never been read: its true boundary is the first message ever sent there, so
 * offering to jump would haul the reader to the start of history for no gain.
 * Everything loaded is unread in that case, so the divider belongs at the top of
 * the window — which is what the pre-id behaviour did, and it is genuinely the
 * more useful answer.
 */
export function resolveUnreadMarkerId(
  boundaryId: number | null,
  lastReadAt: number | null,
  messages: Message[]
): number | null {
  if (boundaryId === null) return null;
  if (lastReadAt !== null) return boundaryId;
  if (messages.length === 0) return boundaryId;
  if (messages.some((msg) => msg.id === boundaryId)) return boundaryId;

  const oldestLoaded = messages.reduce((oldest, msg) => {
    if (msg.received_at < oldest.received_at) return msg;
    if (msg.received_at === oldest.received_at && msg.id < oldest.id) return msg;
    return oldest;
  }, messages[0]);
  return oldestLoaded.id;
}

export function App() {
  const quoteSearchOperatorValue = useCallback((value: string) => {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }, []);

  const messageInputRef = useRef<MessageInputHandle>(null);
  const [channelUnreadMarker, setChannelUnreadMarker] = useState<ChannelUnreadMarker | null>(null);
  const [newMessagePrefillRequest, setNewMessagePrefillRequest] =
    useState<NewMessagePrefillRequest | null>(null);
  const [showBulkAddChannelTab, setShowBulkAddChannelTab] = useState(false);
  const [bulkAddResult, setBulkAddResult] = useState<BulkCreateHashtagChannelsResult | null>(null);
  const [repeaterAutoLoginKey, setRepeaterAutoLoginKey] = useState<string | null>(null);
  const [visibilityVersion, setVisibilityVersion] = useState(0);
  const {
    notificationsSupported,
    notificationsPermission,
    isConversationNotificationsEnabled,
    toggleConversationNotifications,
    notifyIncomingMessage,
  } = useBrowserNotifications();
  const pushSubscription = usePush();
  const {
    showNewMessage,
    showSettings,
    settingsSection,
    sidebarOpen,
    showCracker,
    crackerRunning,
    localLabel,
    setSettingsSection,
    setSidebarOpen,
    setCrackerRunning,
    setLocalLabel,
    handleCloseSettingsView,
    handleToggleSettingsView,
    handleOpenNewMessage: openNewMessageModal,
    handleCloseNewMessage: closeNewMessageModal,
    handleToggleCracker,
  } = useAppShell();

  // Shared refs between useConversationRouter and useContactsAndChannels
  const pendingDeleteFallbackRef = useRef(false);
  const hasSetDefaultConversation = useRef(false);

  // Stable ref bridge: useContactsAndChannels needs setActiveConversation from
  // useConversationRouter, but useConversationRouter needs channels/contacts from
  // useContactsAndChannels. We break the cycle with a ref-based indirection.
  const setActiveConversationRef = useRef<(conv: Conversation | null) => void>(() => {});
  const removeConversationMessagesRef = useRef<(conversationId: string) => void>(() => {});

  // --- Extracted hooks ---

  const radioConnected = useRadioConnected();

  const {
    setHealth,
    config,
    prevHealthRef,
    fetchConfig,
    handleSaveConfig,
    handleSetPrivateKey,
    handleReboot,
    handleDisconnect,
    handleReconnect,
    handleAdvertise,
    meshDiscovery,
    meshDiscoveryLoadingTarget,
    handleDiscoverMesh,
    regionDiscovery,
    regionDiscoveryLoading,
    handleDiscoverRegions,
    handleHealthRefresh,
  } = useRadioControl();

  const {
    appSettings,
    fetchAppSettings,
    handleSaveAppSettings,
    handleToggleBlockedKey,
    handleToggleBlockedName,
    handleToggleTrackedTelemetry,
    handleToggleTrackedTelemetryContact,
  } = useAppSettings();

  // Keep user's name in ref for mention detection in WebSocket callback
  const myNameRef = useRef<string | null>(null);
  useEffect(() => {
    myNameRef.current = config?.name ?? null;
  }, [config?.name]);

  // Keep block lists in refs for WS callback filtering
  const blockedKeysRef = useRef<string[]>([]);
  const blockedNamesRef = useRef<string[]>([]);
  useEffect(() => {
    blockedKeysRef.current = appSettings?.blocked_keys ?? [];
    blockedNamesRef.current = appSettings?.blocked_names ?? [];
  }, [appSettings?.blocked_keys, appSettings?.blocked_names]);

  // Check if a message mentions the user; a hit also refreshes the Mentions view.
  const [mentionNonce, setMentionNonce] = useState(0);
  const checkMention = useCallback((text: string): boolean => {
    const hit = messageContainsMention(text, myNameRef.current);
    if (hit) setMentionNonce((n) => n + 1);
    return hit;
  }, []);

  // useContactsAndChannels is called first — it uses the ref bridge for setActiveConversation
  const {
    contacts,
    contactsLoaded,
    channels,
    channelsLoaded,
    undecryptedCount,
    setContacts,
    setContactsLoaded,
    setChannels,
    setChannelsLoaded,
    fetchAllContacts,
    fetchUndecryptedCount,
    handleCreateContact,
    handleCreateChannel,
    handleCreateHashtagChannel,
    handleBulkCreateHashtagChannels,
    handleDeleteChannel,
    handleDeleteContact,
  } = useContactsAndChannels({
    setActiveConversation: (conv) => setActiveConversationRef.current(conv),
    pendingDeleteFallbackRef,
    hasSetDefaultConversation,
    removeConversationMessages: (conversationId) =>
      removeConversationMessagesRef.current(conversationId),
  });

  // Keep channels in a ref for WS callback mute filtering
  const channelsRef = useRef<Channel[]>([]);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  const handleToggleFavorite = useCallback(
    async (type: 'channel' | 'contact', id: string) => {
      // Optimistically toggle the favorite flag
      if (type === 'contact') {
        setContacts((prev) =>
          prev.map((c) => (c.public_key === id ? { ...c, favorite: !c.favorite } : c))
        );
      } else {
        setChannels((prev) =>
          prev.map((c) => (c.key === id ? { ...c, favorite: !c.favorite } : c))
        );
      }

      try {
        await api.toggleFavorite(type, id);
      } catch {
        // Revert on failure
        if (type === 'contact') {
          setContacts((prev) =>
            prev.map((c) => (c.public_key === id ? { ...c, favorite: !c.favorite } : c))
          );
        } else {
          setChannels((prev) =>
            prev.map((c) => (c.key === id ? { ...c, favorite: !c.favorite } : c))
          );
        }
        toast.error('Failed to update favorite');
      }
    },
    [setContacts, setChannels]
  );

  // useConversationRouter is called second — it receives channels/contacts as inputs
  const {
    activeConversation,
    setActiveConversation,
    activeConversationRef,
    handleSelectConversation,
  } = useConversationRouter({
    channels,
    contacts,
    contactsLoaded,
    suspendHashSync: showSettings,
    setSidebarOpen,
    pendingDeleteFallbackRef,
    hasSetDefaultConversation,
  });

  // Wire up the ref bridge so useContactsAndChannels handlers reach the real setter
  setActiveConversationRef.current = setActiveConversation;

  const {
    targetMessageId,
    setTargetMessageId,
    infoPaneContactKey,
    infoPaneFromChannel,
    infoPaneChannelKey,
    searchPrefillRequest,
    handleOpenContactInfo,
    handleCloseContactInfo,
    handleOpenChannelInfo,
    handleCloseChannelInfo,
    handleSelectConversationWithTargetReset,
    handleNavigateToChannel,
    handleNavigateToMessage,
    handleOpenSearchWithQuery,
  } = useConversationNavigation({
    channels,
    handleSelectConversation,
  });

  // Custom hooks for conversation-specific functionality
  const {
    messages,
    messagesLoading,
    loadingOlder,
    hasOlderMessages,
    hasNewerMessages,
    loadingNewer,
    fetchOlderMessages,
    fetchNewerMessages,
    jumpToBottom,
    observeMessage,
    receiveMessageAck,
    reconcileOnReconnect,
    renameConversationMessages,
    removeConversationMessages,
    applyBlockListChange,
  } = useConversationMessages(activeConversation, targetMessageId);
  removeConversationMessagesRef.current = removeConversationMessages;

  // Auto-focus the message input on conversation change (desktop only by default)
  useEffect(() => {
    if (!activeConversation) return;
    if (activeConversation.type !== 'channel' && activeConversation.type !== 'contact') return;
    // Repeaters show a login form, not a message input
    if (activeConversation.type === 'contact') {
      const contact = contacts.find((c) => c.public_key === activeConversation.id);
      if (contact?.type === CONTACT_TYPE_REPEATER) return;
    }
    if (!shouldAutoFocusInput()) return;
    // Defer to let the input mount/render first
    const raf = requestAnimationFrame(() => messageInputRef.current?.focus?.());
    return () => cancelAnimationFrame(raf);
  }, [activeConversation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Room servers replay stored history as a burst of DMs, all arriving with similar received_at
  // but spanning a wide range of sender_timestamps. Sort by sender_timestamp for room contacts
  // so the display reflects the original send order rather than our radio's receipt order.
  const activeContactIsRoom =
    activeConversation?.type === 'contact' &&
    contacts.find((c) => c.public_key === activeConversation.id)?.type === CONTACT_TYPE_ROOM;
  const sortedMessages = useMemo(() => {
    if (!activeContactIsRoom || messages.length === 0) return messages;
    return [...messages].sort((a, b) => {
      const aTs = a.sender_timestamp ?? a.received_at;
      const bTs = b.sender_timestamp ?? b.received_at;
      return aTs !== bTs ? aTs - bTs : a.id - b.id;
    });
  }, [activeContactIsRoom, messages]);

  const {
    unreadCounts,
    mentions,
    lastMessageTimes,
    unreadLastReadAts,
    firstUnreadIds,
    recordMessageEvent,
    renameConversationState,
    removeConversationState,
    markAllRead,
    refreshUnreads,
  } = useUnreadCounts(channels, contacts, activeConversation, contactsLoaded && channelsLoaded);
  useFaviconBadge(unreadCounts, mentions, channels);
  useUnreadTitle(unreadCounts, contacts, channels);

  const handleToggleMute = useCallback(
    async (key: string) => {
      setChannels((prev) => prev.map((c) => (c.key === key ? { ...c, muted: !c.muted } : c)));
      try {
        await api.toggleChannelMute(key);
        await refreshUnreads();
      } catch {
        setChannels((prev) => prev.map((c) => (c.key === key ? { ...c, muted: !c.muted } : c)));
        toast.error('Failed to update mute');
      }
    },
    [setChannels, refreshUnreads]
  );

  useEffect(() => {
    if (activeConversation?.type !== 'channel') {
      setChannelUnreadMarker(null);
      return;
    }

    const activeChannelId = activeConversation.id;
    const activeChannelUnreadCount = unreadCounts[getStateKey('channel', activeChannelId)] ?? 0;

    const boundaryId = firstUnreadIds[getStateKey('channel', activeChannelId)] ?? null;
    const summarizeAfter = unreadLastReadAts[getStateKey('channel', activeChannelId)] ?? 0;

    setChannelUnreadMarker((prev) => {
      if (prev?.channelId === activeChannelId) {
        // Same channel: hold the marker steady so it does not move under the
        // reader, except to fill in a boundary we did not have yet. A marker
        // created before /unreads resolved would otherwise stay blank for as long
        // as the user stays put.
        if (prev.messageId === null && boundaryId !== null) {
          return { ...prev, messageId: boundaryId };
        }
        return prev;
      }
      if (activeChannelUnreadCount <= 0) {
        return null;
      }
      return { channelId: activeChannelId, messageId: boundaryId, summarizeAfter };
    });
  }, [activeConversation, unreadCounts, firstUnreadIds, unreadLastReadAts]);

  const wsHandlers = useRealtimeAppState({
    prevHealthRef,
    setHealth,
    fetchConfig,
    reconcileOnReconnect,
    refreshUnreads,
    setChannels,
    fetchAllContacts,
    setContacts,
    blockedKeysRef,
    blockedNamesRef,
    channelsRef,
    activeConversationRef,
    observeMessage,
    recordMessageEvent,
    renameConversationState,
    removeConversationState,
    checkMention,
    pendingDeleteFallbackRef,
    setActiveConversation,
    renameConversationMessages,
    removeConversationMessages,
    receiveMessageAck,
    notifyIncomingMessage,
  });
  // Block/unblock edits the open conversation in place (no reload) so the
  // reader keeps their scroll position; an unblock refetches in the background.
  const handleVisibilityPolicyChanged = useCallback(
    (prevKeys: string[], prevNames: string[], settings: AppSettings | null) => {
      if (settings) {
        const keys = settings.blocked_keys ?? [];
        const names = settings.blocked_names ?? [];
        const unblocked =
          prevKeys.some((k) => !keys.includes(k)) || prevNames.some((n) => !names.includes(n));
        applyBlockListChange(keys, names, unblocked);
      }
      void refreshUnreads();
      setVisibilityVersion((current) => current + 1);
    },
    [applyBlockListChange, refreshUnreads]
  );

  const handleBlockKey = useCallback(
    async (key: string) => {
      const prevKeys = blockedKeysRef.current;
      const prevNames = blockedNamesRef.current;
      handleVisibilityPolicyChanged(prevKeys, prevNames, await handleToggleBlockedKey(key));
    },
    [handleToggleBlockedKey, handleVisibilityPolicyChanged]
  );

  const handleBlockName = useCallback(
    async (name: string) => {
      const prevKeys = blockedKeysRef.current;
      const prevNames = blockedNamesRef.current;
      handleVisibilityPolicyChanged(prevKeys, prevNames, await handleToggleBlockedName(name));
    },
    [handleToggleBlockedName, handleVisibilityPolicyChanged]
  );
  const {
    pendingMessages,
    handleSendMessage,
    handleResendChannelMessage,
    handleSetChannelFloodScopeOverride,
    handleSetContactFloodScopeOverride,
    handleSetChannelPathHashModeOverride,
    handleSenderClick,
    handleTrace,
    handlePathDiscovery,
  } = useConversationActions({
    activeConversation,
    activeConversationRef,
    setContacts,
    setChannels,
    observeMessage,
    messageInputRef,
    senderName: config?.name,
  });
  const handleCreateCrackedChannel = useCallback(
    async (name: string, key: string) => {
      const created = await api.createChannel(name, key);
      const updatedChannels = await api.getChannels();
      setChannels(updatedChannels);
      await api.decryptHistoricalPackets({
        key_type: 'channel',
        channel_key: created.key,
      });
      void fetchUndecryptedCount().catch((error) => {
        console.error('Failed to refresh undecrypted count after cracked channel create:', error);
      });
    },
    [fetchUndecryptedCount, setChannels]
  );

  const handleRepeaterAutoLogin = useCallback(
    (publicKey: string, displayName: string) => {
      handleSelectConversationWithTargetReset({
        type: 'contact',
        id: publicKey,
        name: displayName,
      });
      setRepeaterAutoLoginKey(publicKey);
    },
    [handleSelectConversationWithTargetReset]
  );

  const handleOpenNewMessage = useCallback(
    (event?: MouseEvent<HTMLButtonElement>) => {
      setNewMessagePrefillRequest(null);
      setShowBulkAddChannelTab(event?.altKey === true);
      openNewMessageModal();
    },
    [openNewMessageModal]
  );

  const handleCloseNewMessage = useCallback(() => {
    setNewMessagePrefillRequest(null);
    setShowBulkAddChannelTab(false);
    closeNewMessageModal();
  }, [closeNewMessageModal]);

  const handleCloseBulkAddResults = useCallback(() => {
    setBulkAddResult(null);
  }, []);

  const handleChannelReferenceClick = useCallback(
    (channelName: string) => {
      const existingChannel = channels.find((channel) => channel.name === channelName);
      if (existingChannel) {
        handleNavigateToChannel(existingChannel.key);
        return;
      }

      setNewMessagePrefillRequest((previous) => ({
        tab: 'hashtag',
        hashtagName: channelName.slice(1),
        nonce: (previous?.nonce ?? 0) + 1,
      }));
      setShowBulkAddChannelTab(false);
      openNewMessageModal();
    },
    [channels, handleNavigateToChannel, openNewMessageModal]
  );

  const handleBulkAddChannels = useCallback(
    async (channelNames: string[], tryHistorical: boolean) => {
      const result = await handleBulkCreateHashtagChannels(channelNames, tryHistorical);
      setBulkAddResult(result);
    },
    [handleBulkCreateHashtagChannels]
  );

  const blockedKeys = appSettings?.blocked_keys ?? NO_STRINGS;
  const blockedNames = appSettings?.blocked_names ?? NO_STRINGS;
  const trackedTelemetryRepeaters = appSettings?.tracked_telemetry_repeaters ?? NO_STRINGS;
  const trackedTelemetryContacts = appSettings?.tracked_telemetry_contacts ?? NO_STRINGS;
  const handleOpenSettings = useCallback(
    (section: SettingsSection) => {
      setSettingsSection(section);
      if (!showSettings) handleToggleSettingsView();
    },
    [setSettingsSection, showSettings, handleToggleSettingsView]
  );
  const activeId = activeConversation?.id;
  const activeType = activeConversation?.type === 'channel' ? 'CHAN' : 'PRIV';
  // Memoized so the open MessageList (memo) sees the same array across App
  // re-renders that don't touch this conversation, e.g. unread bumps elsewhere.
  const paneMessages = useMemo(() => {
    const pending = pendingMessages.filter(
      (m) => m.conversation_key === activeId && m.type === activeType
    );
    return pending.length ? [...sortedMessages, ...pending] : sortedMessages;
  }, [pendingMessages, activeId, activeType, sortedMessages]);
  const handleNavigateToUnread = useCallback(
    (messageId: number) => setTargetMessageId(messageId),
    [setTargetMessageId]
  );
  const handleTargetReached = useCallback(() => setTargetMessageId(null), [setTargetMessageId]);
  const handleDismissUnreadMarker = useCallback(() => setChannelUnreadMarker(null), []);

  // Connect to WebSocket
  useWebSocket(wsHandlers);

  // Initial fetch for config, settings, and data
  useEffect(() => {
    fetchConfig();
    fetchAppSettings();
    fetchUndecryptedCount();

    // Fetch contacts and channels via REST (parallel, faster than WS serial push)
    takePrefetchOrFetch('channels', api.getChannels)
      .then(setChannels)
      .catch(console.error)
      .finally(() => setChannelsLoaded(true));
    fetchAllContacts()
      .then((data) => {
        setContacts(data);
        setContactsLoaded(true);
      })
      .catch((err) => {
        console.error(err);
        setContactsLoaded(true);
      });
  }, [
    fetchConfig,
    fetchAppSettings,
    fetchUndecryptedCount,
    fetchAllContacts,
    setChannels,
    setContacts,
    setContactsLoaded,
    setChannelsLoaded,
  ]);
  return (
    <AppShell
      localLabel={localLabel}
      activeConversation={activeConversation}
      showSettings={showSettings}
      settingsSection={settingsSection}
      sidebarOpen={sidebarOpen}
      showCracker={showCracker}
      contactInfoOpen={infoPaneContactKey !== null}
      channelInfoOpen={infoPaneChannelKey !== null}
      onSettingsSectionChange={setSettingsSection}
      onSidebarOpenChange={setSidebarOpen}
      onCloseSettingsView={handleCloseSettingsView}
      statusBar={
        <StatusBar
          config={config}
          settingsMode={showSettings}
          onSettingsClick={handleToggleSettingsView}
          onMenuClick={showSettings ? undefined : () => setSidebarOpen(true)}
        />
      }
      sidebar={
        <Sidebar
          contacts={contacts}
          channels={channels}
          loaded={contactsLoaded && channelsLoaded}
          activeConversation={activeConversation}
          onSelectConversation={handleSelectConversationWithTargetReset}
          onNewMessage={handleOpenNewMessage}
          lastMessageTimes={lastMessageTimes}
          unreadCounts={unreadCounts}
          mentions={mentions}
          showCracker={showCracker}
          crackerRunning={crackerRunning}
          onToggleCracker={handleToggleCracker}
          onMarkAllRead={markAllRead}
          isConversationNotificationsEnabled={isConversationNotificationsEnabled}
          blockedKeys={blockedKeys}
          blockedNames={blockedNames}
        />
      }
      conversationPane={
        <ConversationPane
          activeConversation={activeConversation}
          contacts={contacts}
          channels={channels}
          contactsLoaded={contactsLoaded}
          dataLoaded={contactsLoaded && channelsLoaded}
          config={config}
          // Reads only radio_connected; App re-renders on that flip alone.
          health={radioConnected ? getHealth() : null}
          messages={paneMessages}
          preSorted={activeContactIsRoom}
          messagesLoading={messagesLoading}
          loadingOlder={loadingOlder}
          hasOlderMessages={hasOlderMessages}
          unreadMarkerMessageId={
            activeConversation?.type === 'channel' &&
            channelUnreadMarker?.channelId === activeConversation.id
              ? resolveUnreadMarkerId(
                  channelUnreadMarker.messageId,
                  unreadLastReadAts[getStateKey('channel', activeConversation.id)] ?? null,
                  messages
                )
              : undefined
          }
          unreadSummaryAfter={
            activeConversation?.type === 'channel' &&
            channelUnreadMarker?.channelId === activeConversation.id &&
            appSettings?.ollama_enabled
              ? channelUnreadMarker.summarizeAfter
              : null
          }
          onNavigateToUnread={handleNavigateToUnread}
          targetMessageId={targetMessageId}
          hasNewerMessages={hasNewerMessages}
          loadingNewer={loadingNewer}
          messageInputRef={messageInputRef}
          onTrace={handleTrace}
          onRunTracePath={api.requestRadioTrace}
          onPathDiscovery={handlePathDiscovery}
          onToggleFavorite={handleToggleFavorite}
          onToggleMute={handleToggleMute}
          onDeleteContact={handleDeleteContact}
          onDeleteChannel={handleDeleteChannel}
          onSetChannelFloodScopeOverride={handleSetChannelFloodScopeOverride}
          onSetContactFloodScopeOverride={handleSetContactFloodScopeOverride}
          onSetChannelPathHashModeOverride={handleSetChannelPathHashModeOverride}
          onSelectConversation={handleSelectConversationWithTargetReset}
          onOpenContactInfo={handleOpenContactInfo}
          onOpenChannelInfo={handleOpenChannelInfo}
          onSenderClick={handleSenderClick}
          onChannelReferenceClick={handleChannelReferenceClick}
          onLoadOlder={fetchOlderMessages}
          onResendChannelMessage={handleResendChannelMessage}
          onTargetReached={handleTargetReached}
          mentionsViewProps={{
            myName: config?.name ?? null,
            mentions,
            lastReadAts: unreadLastReadAts,
            refreshNonce: mentionNonce,
            onNavigateToMessage: handleNavigateToMessage,
          }}
          onLoadNewer={fetchNewerMessages}
          onJumpToBottom={jumpToBottom}
          onSendMessage={handleSendMessage}
          onDismissUnreadMarker={handleDismissUnreadMarker}
          notificationsSupported={notificationsSupported}
          notificationsPermission={notificationsPermission}
          notificationsEnabled={
            activeConversation?.type === 'contact' || activeConversation?.type === 'channel'
              ? isConversationNotificationsEnabled(activeConversation.type, activeConversation.id)
              : false
          }
          onToggleNotifications={() => {
            if (activeConversation?.type === 'contact' || activeConversation?.type === 'channel') {
              void toggleConversationNotifications(
                activeConversation.type,
                activeConversation.id,
                activeConversation.name
              );
            }
          }}
          pushSupported={pushSubscription.isSupported}
          pushSubscribed={pushSubscription.isSubscribed}
          pushEnabledForConversation={
            activeConversation?.type === 'contact' || activeConversation?.type === 'channel'
              ? pushSubscription.isConversationPushEnabled(
                  getStateKey(activeConversation.type, activeConversation.id)
                )
              : false
          }
          onTogglePush={async () => {
            if (
              !activeConversation ||
              (activeConversation.type !== 'contact' && activeConversation.type !== 'channel')
            )
              return;
            const key = getStateKey(activeConversation.type, activeConversation.id);
            const pushEnabled = pushSubscription.isConversationPushEnabled(key);

            if (!pushEnabled && !pushSubscription.isSubscribed) {
              const subscriptionId = await pushSubscription.subscribe();
              if (!subscriptionId) {
                return;
              }
            }

            await pushSubscription.toggleConversation(key);
          }}
          onOpenPushSettings={() => handleOpenSettings('local')}
          trackedTelemetryRepeaters={trackedTelemetryRepeaters}
          onToggleTrackedTelemetry={handleToggleTrackedTelemetry}
          repeaterAutoLoginKey={repeaterAutoLoginKey}
          onClearRepeaterAutoLogin={() => setRepeaterAutoLoginKey(null)}
          blockedKeys={appSettings?.blocked_keys}
          blockedNames={appSettings?.blocked_names}
        />
      }
      searchView={
        <SearchView
          contacts={contacts}
          channels={channels}
          visibilityVersion={visibilityVersion}
          onNavigateToMessage={handleNavigateToMessage}
          prefillRequest={searchPrefillRequest}
        />
      }
      settingsView={
        <SettingsModal
          config={config}
          appSettings={appSettings}
          onSave={handleSaveConfig}
          onSaveAppSettings={handleSaveAppSettings}
          onSetPrivateKey={handleSetPrivateKey}
          onReboot={handleReboot}
          onDisconnect={handleDisconnect}
          onReconnect={handleReconnect}
          onAdvertise={handleAdvertise}
          meshDiscovery={meshDiscovery}
          meshDiscoveryLoadingTarget={meshDiscoveryLoadingTarget}
          onDiscoverMesh={handleDiscoverMesh}
          regionDiscovery={regionDiscovery}
          regionDiscoveryLoading={regionDiscoveryLoading}
          onDiscoverRegions={handleDiscoverRegions}
          onHealthRefresh={handleHealthRefresh}
          onRefreshAppSettings={fetchAppSettings}
          blockedKeys={appSettings?.blocked_keys}
          blockedNames={appSettings?.blocked_names}
          onToggleBlockedKey={handleBlockKey}
          onToggleBlockedName={handleBlockName}
          contacts={contacts}
          channels={channels}
          onBulkDeleteContacts={(deletedKeys: string[]) => {
            const keySet = new Set(deletedKeys.map((k) => k.toLowerCase()));
            setContacts((prev) => prev.filter((c) => !keySet.has(c.public_key.toLowerCase())));
          }}
          trackedTelemetryRepeaters={trackedTelemetryRepeaters}
          onToggleTrackedTelemetry={handleToggleTrackedTelemetry}
          trackedTelemetryContacts={trackedTelemetryContacts}
          onToggleTrackedTelemetryContact={handleToggleTrackedTelemetryContact}
          open={showSettings}
          pageMode
          externalSidebarNav
          desktopSection={settingsSection}
          onClose={handleCloseSettingsView}
          onLocalLabelChange={setLocalLabel}
        />
      }
      crackerPanel={
        <CrackerPanel
          channels={channels}
          onChannelCreate={handleCreateCrackedChannel}
          visible={showCracker}
          onRunningChange={setCrackerRunning}
        />
      }
      contactInfoPane={
        <ContactInfoPane
          contactKey={infoPaneContactKey}
          fromChannel={infoPaneFromChannel}
          onClose={handleCloseContactInfo}
          contacts={contacts}
          config={config}
          onToggleFavorite={handleToggleFavorite}
          onOpenConversation={(contact: Contact) => {
            handleCloseContactInfo();
            handleSelectConversationWithTargetReset({
              type: 'contact',
              id: contact.public_key,
              name: getContactDisplayName(contact.name, contact.public_key, contact.last_advert),
            });
          }}
          onNavigateToChannel={handleNavigateToChannel}
          onSearchMessagesByKey={(publicKey: string) => {
            handleOpenSearchWithQuery(`user:${publicKey}`);
          }}
          onSearchMessagesByName={(name: string) => {
            handleOpenSearchWithQuery(`user:${quoteSearchOperatorValue(name)}`);
          }}
          onToggleBlockedKey={handleBlockKey}
          onToggleBlockedName={handleBlockName}
          blockedKeys={blockedKeys}
          blockedNames={blockedNames}
          trackedTelemetryContacts={trackedTelemetryContacts}
          onToggleTrackedTelemetryContact={handleToggleTrackedTelemetryContact}
        />
      }
      channelInfoPane={
        <ChannelInfoPane
          channelKey={infoPaneChannelKey}
          onClose={handleCloseChannelInfo}
          channels={channels}
          onToggleFavorite={handleToggleFavorite}
        />
      }
    >
      <NewMessageModal
        undecryptedCount={undecryptedCount}
        showBulkAddChannelTab={showBulkAddChannelTab}
        prefillRequest={newMessagePrefillRequest}
        onCreateContact={handleCreateContact}
        onCreateChannel={handleCreateChannel}
        onCreateHashtagChannel={handleCreateHashtagChannel}
        onBulkAddHashtagChannels={handleBulkAddChannels}
        open={showNewMessage}
        onClose={handleCloseNewMessage}
      />
      <BulkAddChannelResultModal
        result={bulkAddResult}
        open={bulkAddResult !== null}
        onClose={handleCloseBulkAddResults}
      />
      <CommandPalette
        contacts={contacts}
        channels={channels}
        onSelectConversation={handleSelectConversationWithTargetReset}
        onOpenSettings={handleOpenSettings}
        onRepeaterAutoLogin={handleRepeaterAutoLogin}
      />
      <SecurityWarningModal />
    </AppShell>
  );
}
