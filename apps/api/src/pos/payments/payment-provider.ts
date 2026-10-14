/**
 * A payment provider takes money from a customer (card, UPI...) and tells the till what happened.
 * Real gateways (Razorpay, PhonePe, a card terminal) implement this interface; none is wired up yet.
 * The sandbox provider exists so the whole flow can be built and tested without moving money.
 */

export type ProviderState = 'CAPTURED' | 'FAILED' | 'PENDING' | 'UNKNOWN';
export type ProviderCharge = { state: ProviderState; providerRef: string; failureReason?: string };
export type ProviderVoid = { ok: boolean; reason?: string };

export interface PaymentProvider {
  readonly name: string;
  /** Start a charge. Must be safe to call twice with the same idempotency key. */
  charge(input: { idempotencyKey: string; amountCents: number; tenderType: string }): Promise<ProviderCharge>;
  /** Ask the provider what really happened to an earlier charge. Used for PENDING and UNKNOWN. */
  status(providerRef: string): Promise<ProviderCharge>;
  /** Reverse a captured charge. */
  void(providerRef: string): Promise<ProviderVoid>;
}

/**
 * Deterministic fake bank. The last two digits of the amount in paise choose the outcome:
 *  .51 declined · .52 no reply (the money WAS taken) · .53 pending, captured on the next status check
 *  .54 no reply (the money was NOT taken) · .55 captured, but reversal fails · anything else captured.
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = 'sandbox';
  private readonly bank = new Map<string, { state: ProviderState; voided: boolean; amountCents: number; failVoid: boolean }>();

  async charge(input: { idempotencyKey: string; amountCents: number; tenderType: string }): Promise<ProviderCharge> {
    const providerRef = `sbx_${input.idempotencyKey}`;
    const existing = this.bank.get(providerRef);
    if (existing) return { state: existing.state === 'FAILED' ? 'FAILED' : this.visible(providerRef), providerRef };
    const tail = input.amountCents % 100;
    if (tail === 51) { this.bank.set(providerRef, { state: 'FAILED', voided: false, amountCents: input.amountCents, failVoid: false }); return { state: 'FAILED', providerRef, failureReason: 'Declined by the bank' }; }
    if (tail === 52) { this.bank.set(providerRef, { state: 'CAPTURED', voided: false, amountCents: input.amountCents, failVoid: false }); return { state: 'UNKNOWN', providerRef }; }
    if (tail === 54) { this.bank.set(providerRef, { state: 'FAILED', voided: false, amountCents: input.amountCents, failVoid: false }); return { state: 'UNKNOWN', providerRef }; }
    if (tail === 53) { this.bank.set(providerRef, { state: 'PENDING', voided: false, amountCents: input.amountCents, failVoid: false }); return { state: 'PENDING', providerRef }; }
    this.bank.set(providerRef, { state: 'CAPTURED', voided: false, amountCents: input.amountCents, failVoid: tail === 55 });
    return { state: 'CAPTURED', providerRef };
  }

  private visible(providerRef: string): ProviderState {
    const entry = this.bank.get(providerRef);
    if (!entry) return 'FAILED';
    return entry.voided ? 'FAILED' : entry.state;
  }

  async status(providerRef: string): Promise<ProviderCharge> {
    const entry = this.bank.get(providerRef);
    if (!entry) return { state: 'FAILED', providerRef, failureReason: 'The bank has no record of this payment' };
    if (entry.state === 'PENDING') entry.state = 'CAPTURED';
    if (entry.voided) return { state: 'FAILED', providerRef, failureReason: 'Payment was reversed' };
    if (entry.state === 'FAILED') return { state: 'FAILED', providerRef, failureReason: 'Declined by the bank' };
    return { state: entry.state, providerRef };
  }

  async void(providerRef: string): Promise<ProviderVoid> {
    const entry = this.bank.get(providerRef);
    if (!entry) return { ok: false, reason: 'Unknown payment' };
    if (entry.failVoid) return { ok: false, reason: 'The bank could not reverse this payment' };
    entry.voided = true;
    return { ok: true };
  }
}

let sandbox: SandboxPaymentProvider | null = null;

/**
 * Which provider is configured. The sandbox is never available in production unless ALLOW_SANDBOX_PAYMENTS=true,
 * so a live till can never "capture" fake money. Returns null when none is configured.
 */
export function getPaymentProvider(): PaymentProvider | null {
  const wanted = (process.env.PAYMENT_PROVIDER ?? 'sandbox').toLowerCase();
  if (wanted === 'sandbox') {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SANDBOX_PAYMENTS !== 'true') return null;
    sandbox ??= new SandboxPaymentProvider();
    return sandbox;
  }
  return null;
}
