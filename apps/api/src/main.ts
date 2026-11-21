// API entry point.
import { loadEnv, simulating } from '@campusverse/config';
import { createDb, createRedis } from '@campusverse/db';
import { createOtp, type OtpSender } from '@campusverse/platform-identity';
import { createPermissions } from '@campusverse/platform-permissions';
import { parseFieldKeys } from '@campusverse/crypto';
import { chooseGateway } from '@campusverse/shared-finance';
import { createS3Store } from '@campusverse/platform-documents';
import { claudeModel, localModel, openaiModel, type Model } from '@campusverse/verse-ai';
import { createHash } from 'node:crypto';
import { createApi } from './app.js';
import { createSmsSimulator } from './simulation.js';

const env = loadEnv();
const { db } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);

// Real SMS and WhatsApp OTP delivery arrives with the provider accounts. Until then, with
// simulation on (SIMULATE_PROVIDERS), the code is shown on the sign-in screen as a simulated SMS;
// with it off, sign-in by OTP is refused.
const simulator = simulating(env) ? createSmsSimulator() : null;
const applySimulator = simulating(env)
  ? createSmsSimulator(
      console.log,
      (code) =>
        `${code} is your code for the school's online application form. It expires in 5 minutes.`,
    )
  : null;
const sender: OtpSender = simulator?.sender ?? {
  send: async () => {
    throw new Error('No OTP provider configured');
  },
};

const app = await createApi(
  {
    db,
    permissions: createPermissions(redis),
    otp: createOtp({ redis, pepper: env.AUTH_PEPPER, sender }),
    applyOtp: createOtp({
      redis,
      pepper: env.AUTH_PEPPER,
      scope: 'apply',
      sender: applySimulator?.sender ?? sender,
    }),
    applySimulator,
    applySecret: createHash('sha256')
      .update(`apply-session:${env.AUTH_PEPPER}`)
      .digest('base64url'),
    keys: parseFieldKeys(env.FIELD_KEYS),
    ...(env.HEALTH_KEYS ? { healthKeys: parseFieldKeys(env.HEALTH_KEYS) } : {}),
    gateway: chooseGateway({
      appEnv: env.APP_ENV,
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    }),
    paymentReturnUrl: env.PAYMENT_RETURN_URL,
    store: createS3Store({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    }),
    verifyBaseUrl: env.PUBLIC_VERIFY_BASE_URL,
    adminOrigin: env.ADMIN_ORIGIN,
    smsSimulator: simulator,
    // Claude or OpenAI, whichever is chosen and has a key; the offline stand-in in development;
    // otherwise Verse AI is off.
    verseModel: verseModelFor(env),
  },
  { accessLog: true },
);
await app.listen({
  port: env.API_PORT,
  host: env.API_HOST ?? (env.APP_ENV === 'development' ? '127.0.0.1' : '0.0.0.0'),
});
console.log(`api listening on ${env.API_PORT}`);

function verseModelFor(e: typeof env): Model | null {
  const provider =
    e.VERSE_PROVIDER ?? (e.ANTHROPIC_API_KEY ? 'claude' : e.OPENAI_API_KEY ? 'openai' : null);
  if (provider === 'claude' && e.ANTHROPIC_API_KEY)
    return claudeModel({ apiKey: e.ANTHROPIC_API_KEY, model: e.VERSE_MODEL });
  if (provider === 'openai' && e.OPENAI_API_KEY)
    return openaiModel({ apiKey: e.OPENAI_API_KEY, model: e.OPENAI_MODEL });
  return e.APP_ENV === 'development' ? localModel() : null;
}
