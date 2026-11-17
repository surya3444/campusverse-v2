import { describe, expect, it } from 'vitest';
import { guardDutyScanner, ScanPending } from './guardduty.js';

const noWait = { pollMs: 1, waitMs: 3, sleep: async () => {} };
const bytes = new Uint8Array([1]);

describe('GuardDuty scanner', () => {
  it('waits for the tag, then passes only files with no threats found', async () => {
    const tags = [null, null, 'NO_THREATS_FOUND'];
    const clean = guardDutyScanner(async () => tags.shift() ?? null, noWait);
    expect(await clean.scan(bytes, 'k')).toEqual({ clean: true });
    const bad = guardDutyScanner(async () => 'THREATS_FOUND', noWait);
    expect(await bad.scan(bytes, 'k')).toEqual({ clean: false, note: 'guardduty_threat' });
  });

  it('fails closed on unsupported, failed or access-denied scans, and retries when none arrives', async () => {
    for (const status of ['UNSUPPORTED', 'FAILED', 'ACCESS_DENIED'])
      expect((await guardDutyScanner(async () => status, noWait).scan(bytes, 'k')).clean).toBe(
        false,
      );
    await expect(
      guardDutyScanner(async () => null, noWait).scan(bytes, 'k'),
    ).rejects.toBeInstanceOf(ScanPending);
  });
});
