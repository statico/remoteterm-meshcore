/**
 * Tests for useContactsAndChannels hook.
 *
 * Focuses on pagination logic in fetchAllContacts (which fetches 1000 items
 * per page and continues until a page returns fewer than pageSize results).
 */

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useContactsAndChannels } from '../hooks/useContactsAndChannels';
import type { BulkCreateHashtagChannelsResult, Contact } from '../types';

// Mock api module
vi.mock('../api', () => ({
  api: {
    getContacts: vi.fn(),
    getChannels: vi.fn(),
    createContact: vi.fn(),
    createChannel: vi.fn(),
    bulkCreateHashtagChannels: vi.fn(),
    deleteContact: vi.fn(),
    deleteChannel: vi.fn(),
    decryptHistoricalPackets: vi.fn(),
    getUndecryptedPacketCount: vi.fn(),
  },
}));

// Mock prefetch — takePrefetchOrFetch calls the fetcher directly
vi.mock('../prefetch', () => ({
  takePrefetchOrFetch: vi.fn((_key: string, fetcher: () => Promise<unknown>) => fetcher()),
}));

// Mock sonner
vi.mock('../components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeContact(suffix: string): Contact {
  const key = suffix.padStart(64, '0');
  return {
    public_key: key,
    name: `Contact-${suffix}`,
    type: 1,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
  };
}

function makeContacts(count: number, startIndex = 0): Contact[] {
  return Array.from({ length: count }, (_, i) =>
    makeContact(String(startIndex + i).padStart(4, '0'))
  );
}

describe('useContactsAndChannels', () => {
  const setActiveConversation = vi.fn();
  const removeConversationMessages = vi.fn();
  const pendingDeleteFallbackRef = { current: false };
  const hasSetDefaultConversation = { current: false };

  beforeEach(() => {
    vi.clearAllMocks();
    pendingDeleteFallbackRef.current = false;
    hasSetDefaultConversation.current = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderUseContactsAndChannels() {
    return renderHook(() =>
      useContactsAndChannels({
        setActiveConversation,
        pendingDeleteFallbackRef,
        hasSetDefaultConversation,
        removeConversationMessages,
      })
    );
  }

  describe('fetchAllContacts pagination', () => {
    it('returns contacts directly when fewer than page size', async () => {
      const { api } = await import('../api');
      const contacts = makeContacts(50);
      vi.mocked(api.getContacts).mockResolvedValueOnce(contacts);

      const { result } = renderUseContactsAndChannels();

      let fetched: Contact[] = [];
      await act(async () => {
        fetched = await result.current.fetchAllContacts();
      });

      expect(fetched).toHaveLength(50);
      // Should only call once (no pagination needed)
      expect(api.getContacts).toHaveBeenCalledTimes(1);
      expect(api.getContacts).toHaveBeenCalledWith(1000, 0);
    });

    /** A backend holding `total` contacts; records how many pages are in flight. */
    async function serveContacts(total: number) {
      const { api } = await import('../api');
      const all = makeContacts(total, 0);
      const stats = { inFlight: 0, maxInFlight: 0 };
      vi.mocked(api.getContacts).mockImplementation(async (limit = 100, offset = 0) => {
        stats.inFlight++;
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        stats.inFlight--;
        return all.slice(offset, offset + limit);
      });
      return { api, all, stats };
    }

    async function fetchAll() {
      const { result } = renderUseContactsAndChannels();
      let fetched: Contact[] = [];
      await act(async () => {
        fetched = await result.current.fetchAllContacts();
      });
      return fetched;
    }

    it.each([1000, 1200, 2500, 3767, 4000, 5000, 9100])(
      'returns all %i contacts in order',
      async (total) => {
        const { all } = await serveContacts(total);
        const fetched = await fetchAll();
        expect(fetched.map((c) => c.public_key)).toEqual(all.map((c) => c.public_key));
      }
    );

    it('fetches the pages after the first in parallel, not one round trip each', async () => {
      const { api, stats } = await serveContacts(3767);
      await fetchAll();

      // Page 0, then offsets 1000-4000 together (the last one comes back empty).
      expect(api.getContacts).toHaveBeenCalledTimes(5);
      expect(stats.maxInFlight).toBe(4);
      expect(vi.mocked(api.getContacts).mock.calls.map(([, offset]) => offset)).toEqual([
        0, 1000, 2000, 3000, 4000,
      ]);
    });

    it('keeps going in further waves when every page of a wave is full', async () => {
      const { api } = await serveContacts(5000);
      await fetchAll();
      // 0, then 1000-4000 (all full), then 5000-8000.
      expect(api.getContacts).toHaveBeenCalledTimes(9);
    });
  });

  describe('bulk hashtag creation', () => {
    it('refreshes channels and returns the backend result', async () => {
      const { api } = await import('../api');
      const resultPayload: BulkCreateHashtagChannelsResult = {
        created_channels: [
          {
            key: 'AA'.repeat(16),
            name: '#ops',
            is_hashtag: true,
            on_radio: false,
            last_read_at: null,
            favorite: false,
            muted: false,
          },
        ],
        existing_count: 1,
        invalid_names: [],
        decrypt_started: true,
        decrypt_total_packets: 12,
        message: 'Created 1 room',
      };
      vi.mocked(api.bulkCreateHashtagChannels).mockResolvedValueOnce(resultPayload);
      vi.mocked(api.getChannels).mockResolvedValueOnce(resultPayload.created_channels);
      vi.mocked(api.getUndecryptedPacketCount).mockResolvedValueOnce({ count: 9 });

      const { result } = renderUseContactsAndChannels();

      let response: BulkCreateHashtagChannelsResult | null = null;
      await act(async () => {
        response = await result.current.handleBulkCreateHashtagChannels(['#ops'], true);
      });

      expect(api.bulkCreateHashtagChannels).toHaveBeenCalledWith(['#ops'], true);
      expect(api.getChannels).toHaveBeenCalled();
      expect(api.getUndecryptedPacketCount).toHaveBeenCalled();
      expect(response).toEqual(resultPayload);
    });
  });
});
