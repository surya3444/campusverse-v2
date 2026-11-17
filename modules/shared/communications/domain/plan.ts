// Delivery plans per message kind (Schools Release spec, "Parent app and Communications"). Pure.

export type Channel = 'push' | 'whatsapp' | 'sms';
export type Kind =
  | 'urgent'
  | 'absence'
  | 'fee_receipt'
  | 'fee_reminder'
  | 'circular'
  | 'homework'
  | 'notice'
  | 'account'
  | 'transport'
  | 'gate'
  | 'hostel'
  | 'helpdesk';
export type DeliveryState = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type Plan = {
  channels: Channel[];
  /** parallel: every planned channel at once. sequential: one, then the next on failure or timeout. */
  mode: 'parallel' | 'sequential';
  /** What counts as reached. Circulars must be read; most messages just delivered. */
  goal: 'delivered' | 'read';
  /** Sequential only: try the next channel if the goal isn't met by then. */
  fallbackAfterMs?: number;
  /** Homework stays in the app: no fallback at all. */
  noFallback?: boolean;
};

const MIN = 60_000;
const HOUR = 60 * MIN;

export const PLANS: Record<Kind, Plan> = {
  urgent: { channels: ['push', 'whatsapp', 'sms'], mode: 'parallel', goal: 'delivered' },
  absence: {
    channels: ['push', 'whatsapp'],
    mode: 'sequential',
    goal: 'delivered',
    fallbackAfterMs: 15 * MIN,
  },
  fee_receipt: { channels: ['push', 'whatsapp'], mode: 'parallel', goal: 'delivered' },
  fee_reminder: {
    channels: ['push', 'whatsapp'],
    mode: 'sequential',
    goal: 'delivered',
    fallbackAfterMs: 6 * HOUR,
  },
  circular: {
    channels: ['push', 'whatsapp'],
    mode: 'sequential',
    goal: 'read',
    fallbackAfterMs: 24 * HOUR,
  },
  homework: { channels: ['push'], mode: 'sequential', goal: 'delivered', noFallback: true },
  notice: { channels: ['push', 'whatsapp'], mode: 'parallel', goal: 'delivered' },
  // Boarded, dropped, not on the bus: the app first, WhatsApp if the push doesn't arrive.
  transport: {
    channels: ['push', 'whatsapp'],
    mode: 'sequential',
    goal: 'delivered',
    fallbackAfterMs: 5 * MIN,
  },
  // A child leaving with a pass, a visitor for a host: the same as bus alerts.
  gate: {
    channels: ['push', 'whatsapp'],
    mode: 'sequential',
    goal: 'delivered',
    fallbackAfterMs: 5 * MIN,
  },
  // Absent at roll call, an outpass decided, a child out and back.
  hostel: {
    channels: ['push', 'whatsapp'],
    mode: 'sequential',
    goal: 'delivered',
    fallbackAfterMs: 5 * MIN,
  },
  // A reply or resolution to someone's help request: the app, WhatsApp after an hour.
  helpdesk: {
    channels: ['push', 'whatsapp'],
    mode: 'sequential',
    goal: 'delivered',
    fallbackAfterMs: 60 * MIN,
  },
  account: {
    channels: ['push', 'sms'],
    mode: 'sequential',
    goal: 'delivered',
    fallbackAfterMs: 10 * MIN,
  },
};

/**
 * SMS is the last resort for every kind but homework: a parent with no smartphone, or whose
 * planned channels all failed, still gets the message.
 */
const fallbackOrder = (plan: Plan): Channel[] =>
  plan.noFallback ? plan.channels : [...new Set<Channel>([...plan.channels, 'sms'])];

/** Channels for the first send, given the channels the recipient has a working contact on. */
export function firstWave(plan: Plan, available: Channel[]): Channel[] {
  const planned = plan.channels.filter((c) => available.includes(c));
  if (planned.length > 0) return plan.mode === 'parallel' ? planned : planned.slice(0, 1);
  return !plan.noFallback && available.includes('sms') ? ['sms'] : [];
}

/** The next channel to try, or null when nothing is left. */
export function nextChannel(
  plan: Plan,
  available: Channel[],
  attempted: Channel[],
): Channel | null {
  return fallbackOrder(plan).find((c) => available.includes(c) && !attempted.includes(c)) ?? null;
}

export function goalMet(plan: Plan, states: DeliveryState[]): boolean {
  return plan.goal === 'read'
    ? states.includes('read')
    : states.some((s) => s === 'delivered' || s === 'read');
}

/** Message state derived from its deliveries; null leaves the current state alone. */
export function messageState(
  deliveries: { state: DeliveryState; attemptOrder: number }[],
): 'read' | 'delivered' | 'sent' | 'fallback_sent' | null {
  const states = deliveries.map((d) => d.state);
  if (states.includes('read')) return 'read';
  if (states.includes('delivered')) return 'delivered';
  const sent = deliveries.filter((d) => d.state === 'sent');
  if (sent.length === 0) return null;
  return sent.some((d) => d.attemptOrder > 1) ? 'fallback_sent' : 'sent';
}
