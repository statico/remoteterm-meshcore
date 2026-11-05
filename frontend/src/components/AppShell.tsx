import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSwipeable } from 'react-swipeable';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import {
  SETTINGS_SECTION_ICONS,
  SETTINGS_SECTION_LABELS,
  SETTINGS_SECTION_ORDER,
  type SettingsSection,
} from './settings/settingsConstants';
import { getContrastTextColor, type LocalLabel } from '../utils/localLabel';
import type { Conversation } from '../types';
import { Toaster } from './ui/sonner';
import { cn } from '@/lib/utils';

/** True from the first render where `flag` is set, for good. */
function useMountedOnce(flag: boolean): boolean {
  const mounted = useRef(false);
  if (flag) mounted.current = true;
  return mounted.current;
}

/**
 * Shell layout only: App builds every pane and passes it in as an element, so
 * the shell never needs to know their props. It decides where panes sit, which
 * one shows, and keeps lazy panes unmounted until first use (then mounted, so
 * close animations and pane state survive).
 */
interface AppShellProps {
  localLabel: LocalLabel;
  activeConversation: Conversation | null;
  showSettings: boolean;
  settingsSection: SettingsSection;
  sidebarOpen: boolean;
  showCracker: boolean;
  contactInfoOpen: boolean;
  channelInfoOpen: boolean;
  onSettingsSectionChange: (section: SettingsSection) => void;
  onSidebarOpenChange: (open: boolean) => void;
  onCloseSettingsView: () => void;
  statusBar: ReactNode;
  sidebar: ReactNode;
  conversationPane: ReactNode;
  searchView: ReactNode;
  settingsView: ReactNode;
  crackerPanel: ReactNode;
  contactInfoPane: ReactNode;
  channelInfoPane: ReactNode;
  /** Modals and other overlays, rendered as-is. */
  children?: ReactNode;
}

export function AppShell({
  localLabel,
  activeConversation,
  showSettings,
  settingsSection,
  sidebarOpen,
  showCracker,
  contactInfoOpen,
  channelInfoOpen,
  onSettingsSectionChange,
  onSidebarOpenChange,
  onCloseSettingsView,
  statusBar,
  sidebar,
  conversationPane,
  searchView,
  settingsView,
  crackerPanel,
  contactInfoPane,
  channelInfoPane,
  children,
}: AppShellProps) {
  const swipeHandlers = useSwipeable({
    onSwipedRight: ({ initial }) => {
      if (initial[0] < 30 && !sidebarOpen && window.innerWidth < 768) {
        onSidebarOpenChange(true);
      }
    },
    trackTouch: true,
    trackMouse: false,
    preventScrollOnSwipe: true,
  });

  const closeSwipeHandlers = useSwipeable({
    onSwipedLeft: () => onSidebarOpenChange(false),
    trackTouch: true,
    trackMouse: false,
    preventScrollOnSwipe: false,
  });

  const searchActive = activeConversation?.type === 'search';
  const searchMounted = useMountedOnce(searchActive);
  const crackerMounted = useMountedOnce(showCracker);
  const contactInfoMounted = useMountedOnce(contactInfoOpen);
  const channelInfoMounted = useMountedOnce(channelInfoOpen);

  // Position toasts below the conversation header when in chat, otherwise below the status bar
  const TOAST_TOP_PADDING = 10;
  const [toastTopOffset, setToastTopOffset] = useState<number | undefined>(undefined);
  const hasLocalLabel = !!localLabel.text;
  const activeType = activeConversation?.type;
  const activeId = activeConversation?.id;
  useEffect(() => {
    const measure = () => {
      const anchor =
        document.querySelector('[data-toast-anchor="conversation"]') ??
        document.querySelector('[data-toast-anchor="statusbar"]');
      setToastTopOffset(
        anchor ? anchor.getBoundingClientRect().top + TOAST_TOP_PADDING : undefined
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [hasLocalLabel, activeType, activeId, showSettings]);

  const settingsSidebarContent = (
    <nav
      className="sidebar w-60 h-full min-h-0 overflow-hidden bg-card border-r border-border flex flex-col"
      aria-label="Settings"
    >
      <div className="flex justify-between items-center px-3 py-2.5 border-b border-border">
        <h2 className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
          Settings
        </h2>
        <button
          type="button"
          onClick={onCloseSettingsView}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-status-connected/15 border border-status-connected/30 text-status-connected hover:bg-status-connected/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Back to conversations"
          aria-label="Back to conversations"
        >
          &larr; Back to Chat
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1 [contain:layout_paint]">
        {SETTINGS_SECTION_ORDER.map((section) => {
          const Icon = SETTINGS_SECTION_ICONS[section];
          return (
            <button
              key={section}
              type="button"
              className={cn(
                'w-full px-3 py-2 text-left text-[0.8125rem] border-l-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset hover:bg-accent',
                settingsSection === section && 'bg-accent border-l-primary'
              )}
              aria-current={settingsSection === section ? 'true' : undefined}
              onClick={() => onSettingsSectionChange(section)}
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span>{SETTINGS_SECTION_LABELS[section]}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );

  const activeSidebarContent = showSettings ? settingsSidebarContent : sidebar;

  return (
    <div className="flex flex-col h-full" {...swipeHandlers}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-primary focus:text-primary-foreground"
      >
        Skip to content
      </a>
      {localLabel.text && (
        <div
          style={{
            backgroundColor: localLabel.color,
            color: getContrastTextColor(localLabel.color),
          }}
          className="px-4 py-1 text-center text-sm font-medium"
        >
          {localLabel.text}
        </div>
      )}

      {statusBar}
      <div data-toast-anchor="statusbar" aria-hidden="true" />

      <div className="flex flex-1 overflow-hidden">
        <div className="hidden md:block min-h-0 overflow-hidden">{activeSidebarContent}</div>

        <Sheet open={sidebarOpen} onOpenChange={onSidebarOpenChange}>
          <SheetContent
            side="left"
            className="w-[280px] p-0 flex flex-col"
            hideCloseButton
            onOpenAutoFocus={(event) => {
              event.preventDefault();
            }}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Sidebar navigation</SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-hidden" {...closeSwipeHandlers}>
              {activeSidebarContent}
            </div>
          </SheetContent>
        </Sheet>

        <main id="main-content" className="flex-1 flex flex-col bg-background min-w-0">
          <div
            className={cn(
              'flex-1 flex flex-col min-h-0',
              (showSettings || searchActive) && 'hidden'
            )}
          >
            {conversationPane}
          </div>

          {searchMounted && (
            <div
              className={cn(
                'flex-1 flex flex-col min-h-0',
                (!searchActive || showSettings) && 'hidden'
              )}
            >
              <Suspense
                fallback={
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    Loading search...
                  </div>
                }
              >
                {searchView}
              </Suspense>
            </div>
          )}

          {showSettings && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 min-h-0 overflow-hidden">
                <Suspense
                  fallback={
                    <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground">
                      Loading settings...
                    </div>
                  }
                >
                  {settingsView}
                </Suspense>
              </div>
            </div>
          )}
        </main>
      </div>

      <div
        className={cn(
          'border-t border-border bg-background transition-all duration-200 overflow-hidden',
          showCracker ? 'h-[275px]' : 'h-0'
        )}
      >
        {crackerMounted && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Loading channel finder...
              </div>
            }
          >
            {crackerPanel}
          </Suspense>
        )}
      </div>

      {children}
      {contactInfoMounted && <Suspense fallback={null}>{contactInfoPane}</Suspense>}
      {channelInfoMounted && <Suspense fallback={null}>{channelInfoPane}</Suspense>}
      <Toaster
        position="top-right"
        offset={toastTopOffset !== undefined ? { top: toastTopOffset } : undefined}
        mobileOffset={toastTopOffset !== undefined ? { top: toastTopOffset } : undefined}
      />
    </div>
  );
}
