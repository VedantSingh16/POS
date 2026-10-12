"use client";
import type * as React from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";

const COLORS = ["var(--primary)", "var(--success)", "var(--warning)", "var(--info)"];
function EmptyChart({ children }: { children: React.ReactNode }) {
  return <div className="grid h-56 place-items-center px-6 text-center text-sm text-muted-foreground">{children}</div>;
}
const axis = { stroke: "var(--muted-foreground)", fontSize: 12, tickLine: false, axisLine: false } as const;

export function TrendChart({ data }: { data: { day: string; sales: number }[] }) {
  return (
    <Card><CardHeader><CardTitle>Sales, last 7 days</CardTitle></CardHeader>
      <CardContent>{!data.length || data.every((d) => !d.sales) ? <EmptyChart>No sales recorded in the last 7 days.</EmptyChart> : <div className="h-56" role="img" aria-label="Line chart of daily sales for the last seven days">
        <ResponsiveContainer width="100%" height="100%"><LineChart data={data}>
          <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="day" {...axis} /><YAxis {...axis} width={48} tickFormatter={(v) => `${v / 1000}k`} />
          <Tooltip formatter={(v) => formatMoney(Number(v) * 100)} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
          <Line type="monotone" dataKey="sales" stroke="var(--primary)" strokeWidth={2} dot={false} />
        </LineChart></ResponsiveContainer></div>}</CardContent></Card>
  );
}

export function HourChart({ data }: { data: { hour: string; sales: number }[] }) {
  return (
    <Card><CardHeader><CardTitle>Sales by hour, today</CardTitle></CardHeader>
      <CardContent>{!data.length || data.every((d) => !d.sales) ? <EmptyChart>No sales recorded yet today.</EmptyChart> : <div className="h-56" role="img" aria-label="Bar chart of sales by hour today">
        <ResponsiveContainer width="100%" height="100%"><BarChart data={data}>
          <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="hour" {...axis} /><YAxis {...axis} width={48} tickFormatter={(v) => `${v / 1000}k`} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
          <Bar dataKey="sales" fill="var(--primary)" radius={[4, 4, 0, 0]} />
        </BarChart></ResponsiveContainer></div>}</CardContent></Card>
  );
}

export function TenderChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <Card><CardHeader><CardTitle>Tender mix</CardTitle></CardHeader>
      <CardContent>
        {!data.length ? <EmptyChart>No payments recorded yet.</EmptyChart> : <div className="flex items-center gap-4">
          <div className="h-40 w-40 shrink-0" role="img" aria-label={`Tender mix: ${data.map((d) => `${d.name} ${d.value}%`).join(", ")}`}>
            <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" innerRadius={42} outerRadius={70} paddingAngle={2}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie></PieChart></ResponsiveContainer>
          </div>
          <ul className="grid gap-1.5 text-sm">{data.map((d, i) => <li key={d.name} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />{d.name}<span className="tabular ml-auto pl-4 text-muted-foreground">{d.value}%</span></li>)}</ul>
        </div>}
      </CardContent></Card>
  );
}
