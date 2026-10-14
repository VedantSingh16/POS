import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { UserContext } from '../../auth/auth.types.js';
import { AuthorizationService } from '../../auth/authorization.service.js';
import { JsonObject, money, oneOf, optionalString, requiredString, uuid } from '../../common/input.js';
import { isUniqueViolation } from '../../database/db.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PaymentAttemptStatus, Prisma, TenderType } from '../../generated/prisma/client.js';
import { getPaymentProvider, type ProviderState } from './payment-provider.js';

/** Online / terminal tenders that go through a provider. Cash, wallet and points never do. */
export const PROVIDER_TENDERS = ['CARD', 'UPI'] as const;

type Attempt = Prisma.PaymentAttemptGetPayload<object>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  dto(attempt: Attempt) {
    return {
      id: attempt.id,
      storeId: attempt.storeId,
      provider: attempt.provider,
      tenderType: attempt.tenderType,
      amountCents: attempt.amountCents,
      status: attempt.status,
      providerRef: attempt.providerRef,
      clientSaleId: attempt.clientSaleId,
      failureReason: attempt.failureReason,
      createdAt: attempt.createdAt,
      /** The cashier may take another payment method only when the money is known not to have moved. */
      mustResolveBeforeRetry: attempt.status === 'UNKNOWN',
    };
  }

  private statusFor(state: ProviderState): PaymentAttemptStatus {
    return state;
  }

  /** Starts a charge. The same idempotency key never charges twice. */
  async createAttempt(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId ?? context.defaultStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['sale.create'], storeId);
    const tenderType = oneOf(input.tenderType, PROVIDER_TENDERS, 'tenderType') as TenderType;
    const amountCents = money(input.amountCents, 'amountCents');
    if (amountCents <= 0) throw new BadRequestException('amountCents must be greater than zero');
    const idempotencyKey = requiredString(input.idempotencyKey, 'idempotencyKey');
    const clientSaleId = optionalString(input.clientSaleId) ?? '';

    const existing = await this.prisma.paymentAttempt.findUnique({ where: { organizationId_idempotencyKey: { organizationId: context.organizationId, idempotencyKey } } });
    if (existing) return this.dto(existing);

    // "No reply" on an earlier try for this bill: look at what the bank says before taking anything else.
    if (clientSaleId) {
      const unresolved = await this.prisma.paymentAttempt.findFirst({ where: { organizationId: context.organizationId, clientSaleId, status: { in: ['UNKNOWN', 'PENDING'] } } });
      if (unresolved) throw new ConflictException({ code: 'PAYMENT_UNRESOLVED', message: 'An earlier payment on this bill has no confirmed result yet. Check its status first so the customer is never charged twice.', attemptId: unresolved.id });
    }

    const provider = getPaymentProvider();
    if (!provider) throw new ServiceUnavailableException('No online payment provider is configured');

    let attempt: Attempt;
    try {
      attempt = await this.prisma.paymentAttempt.create({
        data: { organizationId: context.organizationId, storeId, provider: provider.name, tenderType, amountCents, idempotencyKey, clientSaleId, createdById: context.userId },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.paymentAttempt.findUnique({ where: { organizationId_idempotencyKey: { organizationId: context.organizationId, idempotencyKey } } });
        if (winner) return this.dto(winner);
      }
      throw error;
    }

    let result: Awaited<ReturnType<typeof provider.charge>>;
    try {
      result = await provider.charge({ idempotencyKey, amountCents, tenderType });
    } catch {
      // The provider did not answer. The money may or may not have moved.
      result = { state: 'UNKNOWN', providerRef: '' };
    }
    attempt = await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: this.statusFor(result.state), providerRef: result.providerRef, failureReason: result.failureReason ?? '' },
    });
    await this.audit.record(context, 'payment.attempt', 'PaymentAttempt', attempt.id, { status: attempt.status, tenderType, amountCents, provider: provider.name });
    return this.dto(attempt);
  }

  private async findAttempt(context: UserContext, attemptId: string) {
    const attempt = await this.prisma.paymentAttempt.findFirst({ where: { id: uuid(attemptId, 'attemptId'), organizationId: context.organizationId }, include: { payment: { select: { id: true } } } });
    if (!attempt) throw new NotFoundException('Payment attempt not found');
    this.authorization.assertStoreAccess(context, attempt.storeId);
    this.authorization.assertPermissions(context, ['sale.create'], attempt.storeId);
    return attempt;
  }

  /** Asks the provider what happened to a PENDING or UNKNOWN attempt and records the answer. */
  async refreshAttempt(context: UserContext, attemptId: string) {
    const attempt = await this.findAttempt(context, attemptId);
    if (attempt.status !== 'PENDING' && attempt.status !== 'UNKNOWN') return this.dto(attempt);
    const provider = getPaymentProvider();
    if (!provider || !attempt.providerRef) return this.dto(attempt);
    const result = await provider.status(attempt.providerRef);
    const updated = await this.prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: this.statusFor(result.state), failureReason: result.failureReason ?? '' } });
    await this.audit.record(context, 'payment.attempt.refreshed', 'PaymentAttempt', attempt.id, { from: attempt.status, to: updated.status });
    return this.dto(updated);
  }

  /** Reverses captured money that has not been used for a sale (cashier cancels, or the customer changes method). */
  async voidAttempt(context: UserContext, attemptId: string) {
    const attempt = await this.findAttempt(context, attemptId);
    if (attempt.payment) throw new ConflictException('This payment already belongs to a saved sale. Refund the sale instead.');
    if (attempt.status === 'VOIDED' || attempt.status === 'FAILED') return this.dto(attempt);
    if (attempt.status === 'UNKNOWN' || attempt.status === 'PENDING') throw new ConflictException({ code: 'PAYMENT_UNRESOLVED', message: 'Check the payment status first: it is not known whether the money was taken.', attemptId: attempt.id });
    return this.dto(await this.reverse(context, attempt, 'Cancelled at the till'));
  }

  private async reverse(context: UserContext, attempt: Attempt, reason: string): Promise<Attempt> {
    const provider = getPaymentProvider();
    let ok = false;
    let why = '';
    try {
      const result = provider ? await provider.void(attempt.providerRef) : { ok: false, reason: 'No provider configured' };
      ok = result.ok;
      why = result.reason ?? '';
    } catch (error) {
      why = error instanceof Error ? error.message : 'Reversal failed';
    }
    const updated = await this.prisma.paymentAttempt.update({ where: { id: attempt.id }, data: ok ? { status: 'VOIDED', failureReason: reason } : { status: 'UNKNOWN', failureReason: `Reversal failed: ${why}` } });
    await this.audit.record(context, ok ? 'payment.attempt.voided' : 'payment.attempt.void-failed', 'PaymentAttempt', attempt.id, { reason, why });
    if (!ok) {
      await this.prisma.alert.create({ data: { organizationId: context.organizationId, storeId: attempt.storeId, type: 'PAYMENT_REVERSAL_FAILED', severity: 'CRITICAL', message: `A customer payment of ₹${(attempt.amountCents / 100).toFixed(2)} could not be reversed automatically (${why}). Refund it manually.`, referenceId: attempt.id } }).catch(() => undefined);
    }
    return updated;
  }

  /** The sale could not be saved after money was captured: put the money back automatically and raise an alert if that fails. */
  async reverseAfterFailedSale(context: UserContext, attemptIds: string[], reason: string): Promise<void> {
    if (!attemptIds.length) return;
    const attempts = await this.prisma.paymentAttempt.findMany({ where: { id: { in: attemptIds }, organizationId: context.organizationId, status: 'CAPTURED' }, include: { payment: { select: { id: true } } } });
    for (const attempt of attempts) if (!attempt.payment) await this.reverse(context, attempt, reason);
  }

  /** Attempts a sale wants to use: they must be captured, belong to this store and not be used already. */
  async usableAttempts(context: UserContext, storeId: string, attemptIds: string[]) {
    if (!attemptIds.length) return new Map<string, Attempt>();
    const rows = await this.prisma.paymentAttempt.findMany({ where: { id: { in: attemptIds }, organizationId: context.organizationId }, include: { payment: { select: { id: true } } } });
    const byId = new Map<string, Attempt>();
    for (const id of attemptIds) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row || row.storeId !== storeId) throw new BadRequestException('Payment attempt not found for this store');
      if (row.payment) throw new ConflictException('This payment was already used for another sale');
      if (row.status !== 'CAPTURED') throw new BadRequestException(row.status === 'UNKNOWN' || row.status === 'PENDING' ? 'This payment has no confirmed result yet. Check its status first.' : `This payment was ${row.status.toLowerCase()} and cannot be used`);
      byId.set(id, row);
    }
    return byId;
  }
}
