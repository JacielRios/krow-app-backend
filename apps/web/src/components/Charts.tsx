'use client';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { money, type DayPoint } from './dashboard-data';

const C = {
  completed: '#0f3c76',
  cancelled: '#C2410C',
  revenue: '#2F5D8A',
  grid: '#E3E8E4',
  text: '#5B6B73',
};
const day = (value: unknown) => {
  const date = String(value ?? '');
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
};
const axis = {
  tick: { fill: C.text, fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const;

export function TripsTrendChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" tickFormatter={day} minTickGap={28} {...axis} />
        <YAxis {...axis} />
        <Tooltip labelFormatter={day} />
        <Area
          type="monotone"
          dataKey="completed"
          name="Realizados"
          stroke={C.completed}
          fill={C.completed}
          fillOpacity={0.15}
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="cancelled"
          name="Cancelados"
          stroke={C.cancelled}
          fill={C.cancelled}
          fillOpacity={0.15}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RevenueChart({ data }: { data: DayPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ left: -8, right: 8, top: 8 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" tickFormatter={day} minTickGap={28} {...axis} />
        <YAxis tickFormatter={(v: number) => money(v)} {...axis} />
        <Tooltip
          labelFormatter={day}
          formatter={(v) => [money(Number(v)), 'Importe comprometido']}
        />
        <Bar dataKey="revenue" fill={C.revenue} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
