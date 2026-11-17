import { OtpRequest, OtpVerify, Refresh, SelfSignup } from '@campusverse/contracts';
import { selfSignup } from '@campusverse/platform-control';
import type { Db } from '@campusverse/db';
import {
  listProfiles,
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
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { SmsSimulator } from '../simulation.js';
import { DB, OTP, SMS_SIMULATOR, type AuthedRequest } from './deps.js';
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
  ) {}

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
    // The profile picker: every person this login can act as, across schools and a shared phone.
    return { tokens, profiles: await listProfiles(this.db, tokens.accountId) };
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
