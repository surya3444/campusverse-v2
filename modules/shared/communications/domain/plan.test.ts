import { describe, expect, it } from 'vitest';
import { firstWave, goalMet, messageState, nextChannel, PLANS } from './plan.js';

describe('delivery plans', () => {
  it('urgent goes out on every channel at once', () => {
    expect(firstWave(PLANS.urgent, ['sms', 'push', 'whatsapp'])).toEqual([
      'push',
      'whatsapp',
      'sms',
    ]);
  });

  it('absence tries push first, then WhatsApp, then SMS', () => {
    const p = PLANS.absence;
    const all = ['push', 'whatsapp', 'sms'] as const;
    expect(firstWave(p, [...all])).toEqual(['push']);
    expect(nextChannel(p, [...all], ['push'])).toBe('whatsapp');
    expect(nextChannel(p, [...all], ['push', 'whatsapp'])).toBe('sms');
    expect(nextChannel(p, [...all], ['push', 'whatsapp', 'sms'])).toBeNull();
  });

  it('skips channels the recipient has no contact on', () => {
    expect(firstWave(PLANS.absence, ['whatsapp', 'sms'])).toEqual(['whatsapp']);
  });

  it('a parent with no smartphone still gets SMS', () => {
    expect(firstWave(PLANS.notice, ['sms'])).toEqual(['sms']);
    expect(firstWave(PLANS.circular, ['sms'])).toEqual(['sms']);
  });

  it('homework stays in the app with no fallback', () => {
    expect(firstWave(PLANS.homework, ['sms'])).toEqual([]);
    expect(nextChannel(PLANS.homework, ['push', 'sms'], ['push'])).toBeNull();
  });

  it('circulars count only when read; others when delivered', () => {
    expect(goalMet(PLANS.circular, ['delivered'])).toBe(false);
    expect(goalMet(PLANS.circular, ['read'])).toBe(true);
    expect(goalMet(PLANS.absence, ['failed', 'delivered'])).toBe(true);
    expect(goalMet(PLANS.absence, ['sent'])).toBe(false);
  });

  it('derives message state from deliveries', () => {
    expect(messageState([{ state: 'queued', attemptOrder: 1 }])).toBeNull();
    expect(messageState([{ state: 'sent', attemptOrder: 1 }])).toBe('sent');
    expect(
      messageState([
        { state: 'failed', attemptOrder: 1 },
        { state: 'sent', attemptOrder: 2 },
      ]),
    ).toBe('fallback_sent');
    expect(
      messageState([
        { state: 'delivered', attemptOrder: 1 },
        { state: 'read', attemptOrder: 2 },
      ]),
    ).toBe('read');
  });
});
