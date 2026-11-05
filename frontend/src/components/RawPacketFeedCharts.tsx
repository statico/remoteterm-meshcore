// recharts-backed bodies for the raw packet stats drawer. Lazy-loaded by
// RawPacketFeedView so recharts stays out of the main chunk.
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '6px',
    fontSize: '11px',
    color: 'hsl(var(--popover-foreground))',
  },
  itemStyle: { color: 'hsl(var(--popover-foreground))' },
  labelStyle: { color: 'hsl(var(--muted-foreground))' },
} as const;

export interface RankedBarDatum {
  name: string;
  value: number;
  detail: string;
  fill: string;
}

export function RankedBarChart({ data }: { data: RankedBarDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={data.length * 28 + 8}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 4, bottom: 0, left: 0 }}
        barCategoryGap="20%"
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
          width={80}
        />
        <RechartsTooltip
          {...TOOLTIP_STYLE}
          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(_v: any, _n: any, props: any) => [props.payload.detail, null]}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TimelineBarChart({
  data,
  series,
}: {
  data: Record<string, string | number>[];
  series: { type: string; fill: string }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={110}>
      <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <RechartsTooltip {...TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
        {series.map(({ type, fill }, i) => (
          <Bar
            key={type}
            dataKey={type}
            stackId="packets"
            fill={fill}
            radius={i === series.length - 1 ? [2, 2, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
