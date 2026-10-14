import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service.js';
import { PosService } from './pos.service.js';

type StoreSettings = { storeCloseHour?: unknown };

@Injectable()
export class AlertScheduler {
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly pos: PosService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'pos-report-export-worker' })
  async processExports(): Promise<void> {
    await this.pos.processReportExportJobs();
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'pos-alert-sweep' })
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const organizations = await this.prisma.organization.findMany({ select: { id: true } });
      for (const organization of organizations) await this.sweepOrganization(organization.id);
    } finally {
      this.running = false;
    }
  }

  private async sweepOrganization(organizationId: string): Promise<void> {
    const settingsRow = await this.prisma.organizationSettings.findUnique({ where: { organizationId }, select: { settings: true } });
    const settings = (settingsRow?.settings ?? {}) as StoreSettings;
    const configuredCloseHour = Number(settings.storeCloseHour);
    const defaultCloseHour = Number.isInteger(configuredCloseHour) && configuredCloseHour >= 0 && configuredCloseHour <= 23 ? configuredCloseHour : 23;
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId, status: 'SELLABLE', location: { status: 'ACTIVE', storeId: { not: null } } },
      include: { location: { select: { id: true, storeId: true } }, variant: { select: { sku: true, name: true } } },
    });

    for (const balance of balances) {
      const threshold = Math.max(Number(balance.reorderPoint), Number(balance.safetyStock));
      const isLow = Number(balance.quantity) <= threshold;
      const referenceId = `${balance.locationId}:${balance.variantId}`;
      if (isLow) {
        const activeDedupeKey = this.dedupeKey(organizationId, balance.location.storeId!, 'LOW_STOCK', referenceId);
        await this.prisma.alert.upsert({
          where: { activeDedupeKey },
          create: {
          organizationId,
          storeId: balance.location.storeId,
          type: 'LOW_STOCK',
          severity: Number(balance.quantity) <= 0 ? 'HIGH' : 'MEDIUM',
          message: `${balance.variant.sku} · ${balance.variant.name} is at ${Number(balance.quantity)} units (threshold ${threshold})`,
          referenceId,
          activeDedupeKey,
          },
          update: { occurrenceCount: { increment: 1 }, lastSeenAt: new Date(), message: `${balance.variant.sku} · ${balance.variant.name} is at ${Number(balance.quantity)} units (threshold ${threshold})`, severity: Number(balance.quantity) <= 0 ? 'HIGH' : 'MEDIUM' },
        });
      }
      if (!isLow) await this.prisma.alert.updateMany({ where: { organizationId, type: 'LOW_STOCK', referenceId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: null, resolutionNote: 'Stock is above the configured threshold', activeDedupeKey: null } });
    }

    const openSessions = await this.prisma.registerSession.findMany({
      where: { organizationId, status: 'OPEN' },
      include: { store: { select: { id: true, timezone: true, closeHour: true } }, register: { select: { name: true, code: true } }, openedBy: { select: { firstName: true, lastName: true } } },
    });
    const openIds = openSessions.map((session) => session.id);
    await this.prisma.alert.updateMany({
      where: { organizationId, type: 'REGISTER_NOT_CLOSED', status: { in: ['OPEN', 'ACKNOWLEDGED'] }, ...(openIds.length ? { referenceId: { notIn: openIds } } : {}) },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolutionNote: 'Register session closed', activeDedupeKey: null },
    });
    const now = new Date();
    for (const session of openSessions) {
      const current = this.localParts(now, session.store.timezone);
      const opened = this.localParts(session.openedAt, session.store.timezone);
      const closeHour = session.store.closeHour ?? defaultCloseHour;
      const crossedClose = opened.date < current.date || (opened.date === current.date && current.hour >= closeHour && opened.hour < closeHour);
      if (!crossedClose) continue;
      const referenceId = session.id;
      const activeDedupeKey = this.dedupeKey(organizationId, session.storeId, 'REGISTER_NOT_CLOSED', referenceId);
      await this.prisma.alert.upsert({
        where: { activeDedupeKey },
        create: {
        organizationId,
        storeId: session.storeId,
        type: 'REGISTER_NOT_CLOSED',
        severity: 'HIGH',
        message: `${session.register.name || session.register.code} is still open after store close time; cashier ${session.openedBy.firstName} ${session.openedBy.lastName}`.trim(),
        referenceId,
        activeDedupeKey,
        },
        update: { occurrenceCount: { increment: 1 }, lastSeenAt: new Date() },
      });
    }
  }

  private localParts(value: Date, timeZone: string): { date: string; hour: number } {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(value);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
  }

  private dedupeKey(organizationId: string, storeId: string, type: string, referenceId: string): string {
    return `${organizationId}:${storeId}:${type}:${referenceId}`;
  }
}
