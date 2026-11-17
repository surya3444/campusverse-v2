import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Private object storage. Nothing is public; reads and uploads go through short signed URLs. */
export type ObjectStore = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  size(key: string): Promise<number | null>;
  signedUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSeconds: number,
  ): Promise<string>;
  signedDownload(key: string, fileName: string, ttlSeconds: number): Promise<string>;
};

/** S3 in Mumbai for test and production; an S3 emulator (endpoint) in development. */
export function createS3Store(opts: {
  bucket: string;
  region: string;
  endpoint?: string;
}): ObjectStore {
  const client = new S3Client({
    region: opts.region,
    ...(opts.endpoint
      ? {
          endpoint: opts.endpoint,
          forcePathStyle: true,
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {}),
  });
  const Bucket = opts.bucket;
  const missing = (e: unknown) =>
    (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;

  return {
    async put(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: contentType }),
      );
    },
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return out.Body ? await out.Body.transformToByteArray() : null;
      } catch (e) {
        if (missing(e) || (e as { name?: string }).name === 'NoSuchKey') return null;
        throw e;
      }
    },
    async size(key) {
      try {
        return (
          (await client.send(new HeadObjectCommand({ Bucket, Key: key }))).ContentLength ?? null
        );
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    signedUpload(key, contentType, sizeBytes, ttlSeconds) {
      // Type and length are signed, so S3 rejects any other upload on this URL.
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: sizeBytes,
        }),
        { expiresIn: ttlSeconds, signableHeaders: new Set(['content-type', 'content-length']) },
      );
    },
    signedDownload(key, fileName, ttlSeconds) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${fileName.replace(/[^\w.\- ]/g, '_')}"`,
        }),
        { expiresIn: ttlSeconds },
      );
    },
  };
}
