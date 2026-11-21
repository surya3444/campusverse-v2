// Public API of the identity module: phone OTP and Google sign-in, sessions, devices, actors.
// HTTP controllers arrive with apps/api; they must authorise who may revoke what.
export { normaliseIndianMobile } from './domain/phone.js';
export { createOtp, RateLimited, type Otp, type OtpSender } from './application/otp.js';
export {
  requestPhoneOtp,
  signInWithGoogle,
  signInWithPhone,
  type DeviceInput,
} from './application/login.js';
export {
  authenticate,
  devSignIn,
  refresh,
  revokeDevice,
  revokeSession,
  type Authenticated,
  type Tokens,
} from './application/sessions.js';
export {
  completeMfa,
  confirmMfa,
  disableMfa,
  MfaError,
  mfaStatus,
  startMfaSetup,
  type MfaChallenge,
} from './application/mfa.js';
export { listProfiles, resolveActor, type Profile } from './application/actor.js';
export { ensureLogin, inviteAccount, type InviteResult } from './application/invite.js';
