import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const data = [
  { name: "Jan", tvl: 1200000 },
  { name: "Feb", tvl: 1800000 },
  { name: "Mar", tvl: 2400000 },
  { name: "Apr", tvl: 2100000 },
  { name: "May", tvl: 3200000 },
  { name: "Jun", tvl: 4100000 },
  { name: "Jul", tvl: 3800000 },
  { name: "Aug", tvl: 5200000 },
  { name: "Sep", tvl: 6100000 },
  { name: "Oct", tvl: 7400000 },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="glass-card p-3 text-sm">
        <p className="text-muted-foreground">{label}</p>
        <p className="font-bold text-primary">${(payload[0].value / 1e6).toFixed(2)}M</p>
      </div>
    );
  }
  return null;
};

export function TVLChart() {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="tvlGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(185, 70%, 45%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(185, 70%, 45%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="name" stroke="hsl(220, 10%, 35%)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis
          stroke="hsl(220, 10%, 35%)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="tvl"
          stroke="hsl(185, 70%, 45%)"
          strokeWidth={2}
          fill="url(#tvlGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
