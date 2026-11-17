// Malware scanning for live and test: Amazon GuardDuty Malware Protection for S3 scans each new
// object in the documents bucket and tags it with the result. This scanner waits for that tag.
// It fails closed: anything other than "no threats found" keeps the file unusable.
import { GetObjectTaggingCommand, S3Client } from '@aws-sdk/client-s3';
import type { Scanner } from '../application/files.js';

const TAG = 'GuardDutyMalwareScanStatus';

export class ScanPending extends Error {
  constructor(key: string) {
    super(`GuardDuty has not scanned ${key} yet`);
    this.name = 'ScanPending';
  }
}

/**
 * readTag returns the object's scan status tag, or null while GuardDuty is still scanning.
 * A file not scanned within waitMs throws ScanPending, so the job is retried later.
 */
export function guardDutyScanner(
  readTag: (key: string) => Promise<string | null>,
  opts: { waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Scanner {
  const waitMs = opts.waitMs ?? 120_000;
  const pollMs = opts.pollMs ?? 5_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    name: 'guardduty',
    async scan(_bytes, key) {
      for (let waited = 0; ; waited += pollMs) {
        const status = await readTag(key);
        if (status === 'NO_THREATS_FOUND') return { clean: true };
        if (status === 'THREATS_FOUND') return { clean: false, note: 'guardduty_threat' };
        if (status) return { clean: false, note: `guardduty_${status.toLowerCase()}` };
        if (waited >= waitMs) throw new ScanPending(key);
        await sleep(pollMs);
      }
    },
  };
}

/** The tag reader for a real bucket. */
export function s3ScanTag(opts: { bucket: string; region: string }) {
  const client = new S3Client({ region: opts.region });
  return async (key: string): Promise<string | null> => {
    const out = await client.send(new GetObjectTaggingCommand({ Bucket: opts.bucket, Key: key }));
    return out.TagSet?.find((t) => t.Key === TAG)?.Value ?? null;
  };
}
