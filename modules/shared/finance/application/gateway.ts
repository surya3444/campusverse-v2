// Online payment gateways. Razorpay Payment Links: the parent opens a hosted page from the app or
// a message, so no native SDK is needed. Webhooks are signed with HMAC-SHA256 over the raw body.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type LinkStatus = 'created' | 'paid' | 'expired' | 'cancelled' | 'partially_paid';

export interface Gateway {
  readonly name: string;
  /** A hosted payment page for exactly this amount; reference is our payment id. */
  createLink(input: {
    amountPaise: number;
    reference: string;
    description: string;
    returnUrl?: string | undefined;
  }): Promise<{
    id: string;
    url: string;
  }>;
  /** The fallback status check, when a webhook is late or lost. */
  fetchLink(id: string): Promise<{ status: LinkStatus; amountPaidPaise: number }>;
  /** True only for a body signed with our webhook secret. */
  verify(rawBody: Buffer, signature: string): boolean;
}

export type WebhookEvent = {
  eventId: string;
  type: string;
  linkId: string | null;
  amountPaidPaise: number;
};

/** Reads the parts of a Razorpay webhook we act on. Unknown shapes give a null link. */
export function parseWebhook(rawBody: Buffer, eventId: string): WebhookEvent {
  const body = JSON.parse(rawBody.toString('utf8')) as {
    event?: string;
    payload?: {
      payment_link?: { entity?: { id?: string; amount_paid?: number } };
      payment?: { entity?: { amount?: number } };
    };
  };
  const link = body.payload?.payment_link?.entity;
  return {
    eventId,
    type: body.event ?? 'unknown',
    linkId: link?.id ?? null,
    amountPaidPaise: link?.amount_paid ?? body.payload?.payment?.entity?.amount ?? 0,
  };
}

export function sign(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function verifyWith(secret: string, rawBody: Buffer, signature: string): boolean {
  const expected = Buffer.from(sign(rawBody, secret), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Razorpay over its REST API (test or live keys, by environment). */
export function razorpayGateway(cfg: {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}): Gateway {
  const auth = `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`;
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...init,
      headers: { authorization: auth, 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`razorpay ${path}: ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    name: 'razorpay',
    async createLink(input) {
      const link = await call<{ id: string; short_url: string }>('/payment_links', {
        method: 'POST',
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: 'INR',
          accept_partial: false,
          reference_id: input.reference,
          description: input.description.slice(0, 2048),
          ...(input.returnUrl ? { callback_url: input.returnUrl, callback_method: 'get' } : {}),
        }),
      });
      return { id: link.id, url: link.short_url };
    },
    async fetchLink(id) {
      const link = await call<{ status: LinkStatus; amount_paid: number }>(
        `/payment_links/${encodeURIComponent(id)}`,
      );
      return { status: link.status, amountPaidPaise: link.amount_paid };
    },
    verify: (raw, sig) => verifyWith(cfg.webhookSecret, raw, sig),
  };
}

/**
 * Development and tests only: links that "pay" when told to. It signs its own webhooks with the
 * same HMAC scheme, so the real verification path is exercised.
 */
export function fakeGateway(webhookSecret = 'development-webhook-secret') {
  const links = new Map<string, { amountPaise: number; status: LinkStatus }>();
  const gateway: Gateway & {
    pay(
      linkId: string,
      amountPaise?: number,
    ): { rawBody: Buffer; signature: string; eventId: string };
    webhookSecret: string;
  } = {
    name: 'fake',
    webhookSecret,
    async createLink(input) {
      const id = `plink_fake_${randomUUID().replaceAll('-', '')}`;
      links.set(id, { amountPaise: input.amountPaise, status: 'created' });
      return { id, url: `https://pay.example.invalid/${id}` };
    },
    async fetchLink(id) {
      const l = links.get(id);
      return {
        status: l?.status ?? 'created',
        amountPaidPaise: l?.status === 'paid' ? l.amountPaise : 0,
      };
    },
    verify: (raw, sig) => verifyWith(webhookSecret, raw, sig),
    /** Marks a link paid and returns the webhook Razorpay would send. */
    pay(linkId, amountPaise) {
      const l = links.get(linkId);
      const amount = amountPaise ?? l?.amountPaise ?? 0;
      if (l) l.status = 'paid';
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'payment_link.paid',
          payload: {
            payment_link: { entity: { id: linkId, amount_paid: amount, status: 'paid' } },
            payment: { entity: { id: `pay_fake_${randomUUID().slice(0, 8)}`, amount } },
          },
        }),
      );
      return {
        rawBody,
        signature: sign(rawBody, webhookSecret),
        eventId: `evt_fake_${randomUUID()}`,
      };
    },
  };
  return gateway;
}
export type FakeGateway = ReturnType<typeof fakeGateway>;

/**
 * Real Razorpay when its keys are set; the fake gateway in development without keys; otherwise
 * none, and online payment is switched off rather than pretending.
 */
export function chooseGateway(cfg: {
  appEnv: string;
  keyId?: string | undefined;
  keySecret?: string | undefined;
  webhookSecret?: string | undefined;
}): Gateway | null {
  if (cfg.keyId && cfg.keySecret && cfg.webhookSecret) {
    return razorpayGateway({
      keyId: cfg.keyId,
      keySecret: cfg.keySecret,
      webhookSecret: cfg.webhookSecret,
    });
  }
  return cfg.appEnv === 'development' ? fakeGateway() : null;
}
