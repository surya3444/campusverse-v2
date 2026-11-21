import type { FieldKeys } from '@campusverse/crypto';
import {
  InviteToken,
  MfaCode,
  MfaVerify,
  OtpRequest,
  OtpVerify,
  Refresh,
  SelfSignup,
} from '@campusverse/contracts';
import { emailInvite, selfSignup } from '@campusverse/platform-control';
import type { Db } from '@campusverse/db';
import {
  completeMfa,
  confirmMfa,
  disableMfa,
  listProfiles,
  MfaError,
  mfaStatus,
  startMfaSetup,
  normaliseIndianMobile,
  refresh,
  requestPhoneOtp,
  revokeSession,
  signInWithPhone,
  type Otp,
} from '@campusverse/platform-identity';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { SmsSimulator } from '../simulation.js';
import QRCode from 'qrcode';
import { DB, MFA_KEYS, OTP, SMS_SIMULATOR, type AuthedRequest } from './deps.js';
import { SessionGuard } from './guards.js';

const sessionOf = (req: AuthedRequest) => {
  if (!req.session) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.session;
};

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OTP) private readonly otp: Otp,
    @Inject(SMS_SIMULATOR) private readonly sms: SmsSimulator | null,
    @Inject(MFA_KEYS) private readonly mfaKeys: FieldKeys,
  ) {}

  /**
   * Authenticator errors with their code. At sign-in they are 401; in settings 422, because a
   * signed-in person typing a wrong code is still signed in.
   */
  private async mfa<T>(work: () => Promise<T>, signingIn = false): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (!(e instanceof MfaError)) throw e;
      if (signingIn) throw new UnauthorizedException({ code: e.code });
      throw new UnprocessableEntityException({ code: e.code });
    }
  }

  /**
   * Always 202, registered or not, so numbers can't be probed. In simulation the code comes back
   * as a simulated SMS to show on screen (only when one was really issued).
   */
  @Post('otp/request')
  @HttpCode(202)
  async requestOtp(@Body() body: unknown, @Req() req: AuthedRequest) {
    const { phone } = OtpRequest.parse(body);
    await requestPhoneOtp(this.db, this.otp, { phone, ip: req.ip });
    const e164 = normaliseIndianMobile(phone);
    const simulated = this.sms && e164 ? this.sms.take(e164) : null;
    return simulated ? { simulated } : {};
  }

  /**
   * Self-serve sign-up (rule book §11): opens an invite with onboarding started, then sends a code
   * like `otp/request`. Always 202, so a number's state can't be probed.
   */
  @Post('signup')
  @HttpCode(202)
  async signup(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = SelfSignup.parse(body);
    const e164 = normaliseIndianMobile(input.phone);
    if (e164) {
      // The same send limits as signing in, checked before anything is written.
      await this.otp.checkSendLimits(e164, req.ip);
      await selfSignup(this.db, input);
      await this.otp.issue(e164);
    }
    const simulated = this.sms && e164 ? this.sms.take(e164) : null;
    return simulated ? { simulated } : {};
  }

  /** Who an email invite's sign-up link is for (the link is the secret), so sign-up can fill it in. */
  @Get('invite/:token')
  async invite(@Param('token') token: string) {
    const found = await emailInvite(this.db, InviteToken.parse(token));
    if (!found) throw new NotFoundException({ code: 'invite_link_invalid' });
    return found;
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body() body: unknown) {
    const input = OtpVerify.parse(body);
    const device = input.device.id
      ? { id: input.device.id, label: input.device.label }
      : { label: input.device.label };
    const tokens = await signInWithPhone(this.db, this.otp, {
      phone: input.phone,
      code: input.code,
      device,
    });
    if (!tokens) throw new UnauthorizedException({ code: 'invalid_code' });
    // Two-step sign-in on: no session until a code from the authenticator app.
    if ('mfa' in tokens) return tokens;
    // The profile picker: every person this login can act as, across schools and a shared phone.
    return { tokens, profiles: await listProfiles(this.db, tokens.accountId) };
  }

  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(@Body() body: unknown) {
    const input = MfaVerify.parse(body);
    const tokens = await this.mfa(() => completeMfa(this.db, this.mfaKeys, input), true);
    return { tokens, profiles: await listProfiles(this.db, tokens.accountId) };
  }

  @Get('mfa')
  @UseGuards(SessionGuard)
  mfaState(@Req() req: AuthedRequest) {
    return mfaStatus(this.db, sessionOf(req).accountId);
  }

  /** A new secret to scan: the QR code as SVG, and the key for typing in by hand. */
  @Post('mfa/setup')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async mfaSetup(@Req() req: AuthedRequest) {
    const { secret, uri } = await this.mfa(() =>
      startMfaSetup(this.db, this.mfaKeys, {
        accountId: sessionOf(req).accountId,
        label: 'Campusverse sign-in',
      }),
    );
    return { secret, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1 }) };
  }

  @Post('mfa/confirm')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async mfaConfirm(@Body() body: unknown, @Req() req: AuthedRequest) {
    const { code } = MfaCode.parse(body);
    await this.mfa(() =>
      confirmMfa(this.db, this.mfaKeys, { accountId: sessionOf(req).accountId, code }),
    );
  }

  @Post('mfa/disable')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async mfaDisable(@Body() body: unknown, @Req() req: AuthedRequest) {
    const { code } = MfaCode.parse(body);
    await this.mfa(() =>
      disableMfa(this.db, this.mfaKeys, { accountId: sessionOf(req).accountId, code }),
    );
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown) {
    const tokens = await refresh(this.db, Refresh.parse(body).refreshToken);
    if (!tokens) throw new UnauthorizedException({ code: 'session_ended' });
    return { tokens };
  }

  @Get('profiles')
  @UseGuards(SessionGuard)
  profiles(@Req() req: AuthedRequest) {
    return listProfiles(this.db, sessionOf(req).accountId);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@Req() req: AuthedRequest) {
    await revokeSession(this.db, sessionOf(req).sessionId, 'signed_out');
  }
}
