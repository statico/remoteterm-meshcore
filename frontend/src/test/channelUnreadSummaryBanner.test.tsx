import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelUnreadSummaryBanner } from '../components/ChannelUnreadSummaryBanner';
import { api } from '../api';

vi.mock('../api', () => ({
  api: { summarizeChannelUnread: vi.fn() },
}));

const mockedSummarize = vi.mocked(api.summarizeChannelUnread);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChannelUnreadSummaryBanner', () => {
  it('summarizes from the supplied read boundary and shows the result', async () => {
    mockedSummarize.mockResolvedValue({
      summary: 'Net at noon.',
      message_count: 3,
      reason: null,
    });

    render(<ChannelUnreadSummaryBanner channelKey="ab12" after={1700000000} />);

    expect(await screen.findByText('Net at noon.')).toBeInTheDocument();
    expect(screen.getByText('(3 messages)')).toBeInTheDocument();
    expect(mockedSummarize).toHaveBeenCalledWith('ab12', 1700000000);
  });

  it('renders nothing when the server produced no summary', async () => {
    mockedSummarize.mockResolvedValue({ summary: null, message_count: 0, reason: 'No unread' });

    const { container } = render(<ChannelUnreadSummaryBanner channelKey="ab12" after={0} />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('stays quiet when summarizing fails', async () => {
    mockedSummarize.mockRejectedValue(new Error('boom'));

    const { container } = render(<ChannelUnreadSummaryBanner channelKey="ab12" after={0} />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('can be dismissed', async () => {
    mockedSummarize.mockResolvedValue({ summary: 'Net at noon.', message_count: 1, reason: null });

    render(<ChannelUnreadSummaryBanner channelKey="ab12" after={0} />);
    fireEvent.click(await screen.findByLabelText('Dismiss unread summary'));

    await waitFor(() => expect(screen.queryByText('Net at noon.')).not.toBeInTheDocument());
  });
});
