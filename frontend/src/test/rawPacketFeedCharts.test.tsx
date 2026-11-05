import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RankedBarChart, TimelineBarChart } from '../components/RawPacketFeedCharts';

describe('RawPacketFeedCharts', () => {
  it('sizes the ranked bar chart from its row count', () => {
    const { container } = render(
      <RankedBarChart
        data={[
          { name: 'Advert', value: 3, detail: '3 · 60%', fill: '#0ea5e9' },
          { name: 'Ack', value: 2, detail: '2 · 40%', fill: '#10b981' },
        ]}
      />
    );
    const wrapper = container.querySelector('.recharts-responsive-container') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.height).toBe(`${2 * 28 + 8}px`);
  });

  it('renders the timeline chart container at a fixed height', () => {
    const { container } = render(
      <TimelineBarChart
        data={[{ label: '10:00', Advert: 1 }]}
        series={[{ type: 'Advert', fill: '#0ea5e9' }]}
      />
    );
    const wrapper = container.querySelector('.recharts-responsive-container') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.height).toBe('110px');
  });
});
