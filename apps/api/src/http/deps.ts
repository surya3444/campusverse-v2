import type { FieldKeys } from '@campusverse/crypto';
import type { Db } from '@campusverse/db';
import type { SmsSimulator } from '../simulation.js';
import type { Model } from '@campusverse/verse-ai';
import type { ControlPorts, RelyingParty, Staff } from '@campusverse/platform-control';
import type { Otp } from '@campusverse/platform-identity';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import type { Authenticated } from '@campusverse/platform-identity';
import type { Gateway } from '@campusverse/shared-finance';
import type { ObjectStore } from '@campusverse/platform-documents';
import type { FastifyRequest } from 'fastify';

// Injection tokens. Explicit tokens, not type metadata: works under tsx/esbuild and tsc alike.
export const DB = Symbol('db');
export const PERMISSIONS = Symbol('permissions');
export const OTP = Symbol('otp');
export const PEOPLE = Symbol('people');
export const FINANCE = Symbol('finance');
export const ADMISSIONS = Symbol('admissions');
export const CERTIFICATES = Symbol('certificates');
export const EXAMS = Symbol('exams');
export const ROLLOVER = Symbol('rollover');
export const CONTROL = Symbol('control');
export const VERSE = Symbol('verse');
export const SMS_SIMULATOR = Symbol('sms-simulator');
export const STORE = Symbol('store');
export const APPLY = Symbol('apply');
export const HEALTH = Symbol('health');

export type Permissions = ReturnType<typeof createPermissions>;
export type Deps = {
  db: Db;
  permissions: Permissions;
  otp: Otp;
  keys: FieldKeys;
  /** The health vault's own keys (HEALTH_KEYS). Unset: derived from `keys` with HKDF. */
  healthKeys?: FieldKeys;
  /** Online payments; null when not configured. */
  gateway?: Gateway | null;
  paymentReturnUrl?: string | undefined;
  /** Private file storage (issued certificates). */
  store?: ObjectStore;
  verifyBaseUrl?: string;
  /** The super admin app's origin: staff passkeys are bound to it. */
  adminOrigin?: string;
  /** Simulated SMS (codes shown on screen); null when simulation is off. */
  smsSimulator?: SmsSimulator | null;
  /**
   * The online application form's mobile check: its own OTP scope (a form code never signs in)
   * and, in simulation, its own simulated SMS. Unset: the public form refuses to send codes.
   */
  applyOtp?: Otp;
  applySimulator?: SmsSimulator | null;
  /** Verse AI's model; null or unset means Verse AI is off. */
  verseModel?: Model | null;
};

/** What the admin controllers need: the database, the passkey origin, and the module ports. */
export type ControlDeps = {
  db: Db;
  rp: RelyingParty;
  ports: ControlPorts;
  /** Show invitation SMS on screen (simulation on). */
  simulateSms: boolean;
  /** The school web app, for links in invitations. */
  appOrigin: string;
};

/** What the guards attach to a request. */
export type AuthedRequest = FastifyRequest & {
  session?: Authenticated;
  actor?: Actor;
  staff?: Staff;
};
