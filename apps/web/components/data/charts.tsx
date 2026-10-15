"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import type * as React from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatNumber, minorPerUnit } from "@/lib/format";
import { useLocale } from "@/components/i18n/locale-provider";
import { useTranslate } from "@/components/i18n/localized-text";
import type { Locale } from "@pos/shared/locale";

const axisTick = (minor: number, locale: Locale) => { const major = minor / minorPerUnit(); return Math.abs(major) >= 1000 ? `${formatNumber(Math.round(major / 100) / 10, locale)}k` : formatNumber(Math.round(major), locale); };

const COLORS = ["var(--primary)", "var(--success)", "var(--warning)", "var(--info)"];
function EmptyChart({ children }: { children: React.ReactNode }) {
  return <div className="grid h-28 place-items-center px-6 text-center text-sm text-muted-foreground">{children}</div>;
}
const axis = { stroke: "var(--muted-foreground)", fontSize: 12, tickLine: false, axisLine: false } as const;

export function TrendChart({ data }: { data: { day: string; sales: number }[] }) {
  const { locale } = useLocale();
  const t = useTranslate();
  return (
    <Card><CardHeader><CardTitle><LocalizedText value={"Sales, last 7 days"} /></CardTitle></CardHeader>
      <CardContent>{!data.length || data.every((d) => !d.sales) ? <EmptyChart><LocalizedText value={"No sales recorded in the last 7 days."} /></EmptyChart> : <div className="h-48" role="img" aria-label={t("Line chart of daily sales for the last seven days")}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={data}>
          <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="day" {...axis} /><YAxis {...axis} width={48} tickFormatter={(v) => axisTick(Number(v), locale)} />
          <Tooltip formatter={(v) => formatMoney(Number(v), locale)} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
          <Line type="monotone" dataKey="sales" stroke="var(--primary)" strokeWidth={2} dot={false} />
        </LineChart></ResponsiveContainer></div>}</CardContent></Card>
  );
}

export function HourChart({ data }: { data: { hour: string; sales: number }[] }) {
  const t = useTranslate();
  const { locale } = useLocale();
  return (
    <Card><CardHeader><CardTitle><LocalizedText value={"Sales by hour, today"} /></CardTitle></CardHeader>
      <CardContent>{!data.length || data.every((d) => !d.sales) ? <EmptyChart><LocalizedText value={"No sales recorded yet today."} /></EmptyChart> : <div className="h-48" role="img" aria-label={t("Bar chart of sales by hour today")}>
        <ResponsiveContainer width="100%" height="100%"><BarChart data={data}>
          <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="hour" {...axis} /><YAxis {...axis} width={48} tickFormatter={(v) => axisTick(Number(v), locale)} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
          <Bar dataKey="sales" fill="var(--primary)" radius={[4, 4, 0, 0]} />
        </BarChart></ResponsiveContainer></div>}</CardContent></Card>
  );
}

export function TenderChart({ data }: { data: { name: string; value: number }[] }) {
  const t = useTranslate();
  const { locale } = useLocale();
  return (
    <Card><CardHeader><CardTitle><LocalizedText value={"Tender mix"} /></CardTitle></CardHeader>
      <CardContent>
        {!data.length ? <EmptyChart><LocalizedText value={"No payments recorded yet."} /></EmptyChart> : <div className="flex items-center gap-4">
          <div className="h-40 w-40 shrink-0" role="img" aria-label={`${t("Tender mix")}: ${data.map((d) => `${t(d.name)} ${formatNumber(d.value, locale)}%`).join(", ")}`}>
            <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" innerRadius={42} outerRadius={70} paddingAngle={2}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie></PieChart></ResponsiveContainer>
          </div>
          <ul className="grid gap-1.5 text-sm">{data.map((d, i) => <li key={d.name} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />{t(d.name)}<span className="tabular ms-auto ps-4 text-muted-foreground">{formatNumber(d.value, locale)}%</span></li>)}</ul>
        </div>}
      </CardContent></Card>
  );
}
