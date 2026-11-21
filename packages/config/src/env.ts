import { z } from 'zod';

const EnvSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Only db:migrate needs this. The app never receives the schema owner's login.
  MIGRATION_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Development listens on this machine only; set 0.0.0.0 to reach it from a phone on the same Wi-Fi. */
  API_HOST: z.union([z.ipv4(), z.literal('localhost')]).optional(),
  // Keyed hash for OTP codes and the phone numbers and IPs in Redis keys.
  AUTH_PEPPER: z.string().min(32),
  // Field encryption keys for Aadhaar, APAAR, PAN: "1:<base64 32 bytes>[,2:...]". Highest is current.
  FIELD_KEYS: z.string().regex(/^\d+:[A-Za-z0-9+/=]{43,44}(,\d+:[A-Za-z0-9+/=]{43,44})*$/),
  // The health vault's own keys (rule book §12.4 decision 13), same format. Unset: derived from
  // FIELD_KEYS with HKDF, still a separate key. Set its own in test and live (docs/RISKS.md).
  HEALTH_KEYS: z
    .string()
    .regex(/^\d+:[A-Za-z0-9+/=]{43,44}(,\d+:[A-Za-z0-9+/=]{43,44})*$/)
    .optional(),
  // Staff Google sign-in. Unset means Google sign-in is off.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  // Private document bucket. S3_ENDPOINT is set only for the local S3 emulator.
  S3_BUCKET: z.string().min(3),
  S3_REGION: z.string().default('ap-south-1'),
  S3_ENDPOINT: z.url().optional(),
  // Base of the public QR verification page printed on issued documents.
  PUBLIC_VERIFY_BASE_URL: z.url(),
  // Outside production, WhatsApp and SMS go only to these numbers (comma-separated E.164).
  MESSAGE_ALLOWLIST: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean),
    ),
  // Razorpay online payments: all three, or none. Unset means online payment is off (development
  // uses a fake gateway instead). Test-mode keys only outside production.
  RAZORPAY_KEY_ID: z
    .string()
    .regex(/^rzp_(test|live)_\w+$/)
    .optional(),
  RAZORPAY_KEY_SECRET: z.string().min(10).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(10).optional(),
  // Where a parent lands after paying online (the app or school site).
  PAYMENT_RETURN_URL: z.url().optional(),
  // The super admin app. Staff passkeys are bound to this origin's host name.
  ADMIN_ORIGIN: z.url().default('http://localhost:3001'),
  // Verse AI's model (Claude via the Anthropic API). Unset: development uses an offline model,
  // elsewhere Verse AI is off.
  ANTHROPIC_API_KEY: z.string().min(20).optional(),
  VERSE_MODEL: z
    .string()
    .regex(/^claude-[a-z0-9-]+$/)
    .optional(),
  // OpenAI as Verse AI's model instead (decision 0020). With both keys set, VERSE_PROVIDER picks;
  // with one, that one is used.
  OPENAI_API_KEY: z.string().min(20).optional(),
  OPENAI_MODEL: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.:-]{1,63}$/)
    .optional(),
  VERSE_PROVIDER: z.enum(['claude', 'openai']).optional(),
  // 1 runs the live Verse AI evaluations against the real model (costs money; tests only).
  VERSE_LIVE_EVAL: z.literal('1').optional(),
  // Simulated SMS and WhatsApp: OTP codes and messages are shown on screen instead of being sent.
  // On by default in development and test, off in production unless set here on purpose (then
  // anyone who knows a phone number can sign in as that person: synthetic data only).
  SIMULATE_PROVIDERS: z.enum(['on', 'off']).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Whether SMS and WhatsApp are simulated on screen in this environment. */
export function simulating(env: Pick<Env, 'APP_ENV' | 'SIMULATE_PROVIDERS'>): boolean {
  return (env.SIMULATE_PROVIDERS ?? (env.APP_ENV === 'production' ? 'off' : 'on')) === 'on';
}

/** The same, for the web and admin servers (they read nothing else from the server's config). */
export function simulatingHere(source: Record<string, string | undefined> = process.env): boolean {
  const parsed = EnvSchema.pick({ APP_ENV: true, SIMULATE_PROVIDERS: true }).safeParse(source);
  if (!parsed.success)
    throw new Error('Invalid environment configuration: APP_ENV or SIMULATE_PROVIDERS');
  return simulating(parsed.data);
}

/** Validates config at startup. A missing or bad value throws, so the app never starts half-configured. */
export function loadEnv(raw: Record<string, string | undefined> = process.env): Env {
  // An empty value is unset (Compose writes optional variables as empty strings).
  const source = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // Names only: never echo values, they may be secrets.
    const fields = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  const env = result.data;
  if (env.APP_ENV === 'production' && env.S3_ENDPOINT) {
    throw new Error('Invalid environment configuration: S3_ENDPOINT must not be set in production');
  }
  const razorpay = [env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET];
  if (razorpay.some(Boolean) && !razorpay.every(Boolean)) {
    throw new Error('Invalid environment configuration: set all RAZORPAY_* values or none');
  }
  if (env.APP_ENV === 'production' && !source.ADMIN_ORIGIN?.startsWith('https://')) {
    throw new Error('Invalid environment configuration: ADMIN_ORIGIN must be https in production');
  }
  if (env.APP_ENV !== 'production' && env.RAZORPAY_KEY_ID?.startsWith('rzp_live_')) {
    throw new Error('Invalid environment configuration: live Razorpay keys outside production');
  }
  return env;
}

/** What the migration task needs, and nothing more: the schema owner's login only. */
export function migrationEnv(source: Record<string, string | undefined> = process.env) {
  const parsed = z
    .object({
      MIGRATION_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
      // The restore check points the same login at a restored copy.
      RESTORE_HOST: z
        .string()
        .regex(/^[a-z0-9.-]+$/)
        .optional(),
      RESTORE_PORT: z
        .string()
        .regex(/^\d{2,5}$/)
        .optional(),
    })
    .safeParse(source);
  if (!parsed.success) throw new Error('Invalid environment configuration: MIGRATION_DATABASE_URL');
  return parsed.data;
}

/** One-time database login setup (packages/db/scripts/bootstrap-roles.ts). */
export function bootstrapEnv(source: Record<string, string | undefined> = process.env) {
  const parsed = z
    .object({
      MASTER_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
      CV_MIGRATOR_PASSWORD: z.string().min(24),
      CV_APP_PASSWORD: z.string().min(24),
      DATABASE_NAME: z
        .string()
        .regex(/^[a-z_]+$/)
        .default('campusverse'),
    })
    .safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return parsed.data;
}

/** Just the environment name, for places that need nothing else (the web banner). */
export function appEnv(source: Record<string, string | undefined> = process.env): Env['APP_ENV'] {
  const parsed = EnvSchema.shape.APP_ENV.safeParse(source.APP_ENV);
  if (!parsed.success) throw new Error('Invalid environment configuration: APP_ENV');
  return parsed.data;
}

const WebEnvSchema = z.object({
  APP_ENV: EnvSchema.shape.APP_ENV,
  // Where the web server reaches the API. The browser never calls it directly.
  API_URL: z.url().default('http://127.0.0.1:4000'),
});

/** What the web server needs, and nothing more: no database or Redis credentials. */
export function webEnv(source: Record<string, string | undefined> = process.env) {
  const parsed = WebEnvSchema.safeParse(source);
  if (!parsed.success) throw new Error('Invalid environment configuration: APP_ENV or API_URL');
  return parsed.data;
}
