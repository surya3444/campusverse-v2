import {
  CollectInput,
  ConcessionRequest,
  DayCloseInput,
  Decision,
  FeeHeadInput,
  FeePlanInput,
  Id,
  IdempotencyKey,
  InvoiceAdjustment,
  RefundRequest,
  ReminderInput,
  ReversalRequest,
} from '@campusverse/contracts';
import type { Actor } from '@campusverse/platform-permissions';
import {
  financeSummary,
  adjustInvoice,
  closeDay,
  collectPayment,
  createHead,
  dayCloseView,
  decideConcession,
  decideRefund,
  decideReversal,
  dues,
  handleWebhook,
  issueInvoices,
  listHeads,
  listPlans,
  pendingApprovals,
  planDetail,
  previewIssue,
  previewReminders,
  publishPlan,
  receipt,
  recheckPayment,
  reconciliation,
  requestConcession,
  requestRefund,
  requestReversal,
  savePlan,
  searchStudents,
  sendReminders,
  startOnlinePayment,
  studentAccount,
  type FakeGateway,
  type FinanceDeps,
} from '@campusverse/shared-finance';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { FINANCE, type AuthedRequest } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};

/** Fee plans, invoices, the counter, approvals, the day and dues. */
@Controller('finance')
@UseGuards(ActorGuard)
export class FinanceController {
  constructor(@Inject(FINANCE) private readonly deps: FinanceDeps) {}

  @Get(':institutionId/heads')
  heads(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return listHeads(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':institutionId/heads')
  createHead(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return createHead(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...FeeHeadInput.parse(body),
    });
  }

  @Get(':institutionId/plans')
  plans(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return listPlans(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':institutionId/plans')
  savePlan(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return savePlan(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...FeePlanInput.parse(body),
    });
  }

  @Get('plans/:id')
  plan(@Param('id') id: string, @Req() req: AuthedRequest) {
    return planDetail(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('plans/:id/publish')
  @HttpCode(204)
  async publish(@Param('id') id: string, @Req() req: AuthedRequest) {
    await publishPlan(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('plans/:id/issue/preview')
  @HttpCode(200)
  previewIssue(@Param('id') id: string, @Req() req: AuthedRequest) {
    return previewIssue(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('plans/:id/issue')
  issue(@Param('id') id: string, @Req() req: AuthedRequest) {
    return issueInvoices(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('invoices/:id/adjust')
  @HttpCode(204)
  async adjust(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await adjustInvoice(this.deps, actorOf(req), {
      invoiceId: Id.parse(id),
      ...InvoiceAdjustment.parse(body),
    });
  }

  @Get(':institutionId/students')
  search(
    @Param('institutionId') id: string,
    @Query('search') search: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return searchStudents(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      search: (search ?? '').slice(0, 100),
    });
  }

  @Get('students/:id')
  account(@Param('id') id: string, @Req() req: AuthedRequest) {
    return studentAccount(this.deps, actorOf(req), Id.parse(id));
  }

  /** Online payment of everything due, as a hosted payment link. */
  @Post('students/:id/pay')
  pay(@Param('id') id: string, @Req() req: AuthedRequest) {
    return startOnlinePayment(this.deps, actorOf(req), { studentId: Id.parse(id) });
  }

  /** The counter. Requires an Idempotency-Key header: a retry returns the same receipt. */
  @Post('payments')
  collect(
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const parsed = IdempotencyKey.safeParse(key);
    if (!parsed.success)
      throw new BadRequestException({ code: 'idempotency_key_required', field: 'Idempotency-Key' });
    return collectPayment(this.deps, actorOf(req), {
      ...CollectInput.parse(body),
      idempotencyKey: parsed.data,
    });
  }

  @Get('receipts/:id')
  receipt(@Param('id') id: string, @Req() req: AuthedRequest) {
    return receipt(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('concessions')
  requestConcession(@Body() body: unknown, @Req() req: AuthedRequest) {
    return requestConcession(this.deps, actorOf(req), ConcessionRequest.parse(body));
  }

  @Post('concessions/:id/decide')
  @HttpCode(204)
  async decideConcession(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const d = Decision.parse(body);
    await decideConcession(this.deps, actorOf(req), {
      concessionId: Id.parse(id),
      approve: d.approve,
      note: d.note,
    });
  }

  @Post('payments/:id/refunds')
  requestRefund(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return requestRefund(this.deps, actorOf(req), {
      paymentId: Id.parse(id),
      ...RefundRequest.parse(body),
    });
  }

  @Post('refunds/:id/decide')
  @HttpCode(204)
  async decideRefund(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const d = Decision.parse(body);
    await decideRefund(this.deps, actorOf(req), { refundId: Id.parse(id), ...d });
  }

  @Post('payments/:id/reversal')
  requestReversal(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return requestReversal(this.deps, actorOf(req), {
      paymentId: Id.parse(id),
      ...ReversalRequest.parse(body),
    });
  }

  @Post('reversals/:id/decide')
  @HttpCode(204)
  async decideReversal(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const d = Decision.parse(body);
    await decideReversal(this.deps, actorOf(req), {
      reversalId: Id.parse(id),
      approve: d.approve,
      note: d.note,
    });
  }

  @Get(':institutionId/approvals')
  approvals(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return pendingApprovals(this.deps, actorOf(req), Id.parse(id));
  }

  /** Billed, collected and owed at the school, for the dashboard. */
  @Get(':institutionId/summary')
  summary(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return financeSummary(this.deps, actorOf(req), Id.parse(id));
  }

  @Get(':institutionId/day')
  day(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return dayCloseView(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':institutionId/day/close')
  closeDay(@Param('institutionId') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return closeDay(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...DayCloseInput.parse(body),
    });
  }

  @Get(':institutionId/dues')
  dues(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return dues(this.deps, actorOf(req), Id.parse(id));
  }

  @Post(':institutionId/reminders/preview')
  @HttpCode(200)
  previewReminders(
    @Param('institutionId') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    return previewReminders(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...ReminderInput.parse(body),
    });
  }

  @Post(':institutionId/reminders')
  sendReminders(
    @Param('institutionId') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    return sendReminders(this.deps, actorOf(req), {
      institutionId: Id.parse(id),
      ...ReminderInput.parse(body),
    });
  }

  @Get(':institutionId/reconciliation')
  reconciliation(@Param('institutionId') id: string, @Req() req: AuthedRequest) {
    return reconciliation(this.deps, actorOf(req), Id.parse(id));
  }

  @Post('payments/:id/check')
  @HttpCode(200)
  async check(@Param('id') id: string, @Req() req: AuthedRequest) {
    return { outcome: await recheckPayment(this.deps, actorOf(req), Id.parse(id)) };
  }
}

/**
 * Gateway webhooks: no session, verified by signature over the raw body. Every verified event gets
 * a 200, so the gateway stops retrying; applying it is idempotent anyway.
 */
@Controller('finance/webhooks')
export class FinanceWebhookController {
  constructor(@Inject(FINANCE) private readonly deps: FinanceDeps) {}

  @Post('razorpay')
  @HttpCode(200)
  async razorpay(
    @Req() req: AuthedRequest & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ) {
    const gateway = this.deps.gateway;
    if (!gateway || !req.rawBody) throw new NotFoundException({ code: 'not_found' });
    const outcome = await handleWebhook(
      this.deps.db,
      gateway,
      {
        rawBody: req.rawBody,
        signature: signature ?? '',
        eventId: eventId ?? `noid_${randomUUID()}`,
      },
      this.deps.placements,
    );
    if (outcome === 'bad_signature') throw new BadRequestException({ code: 'bad_signature' });
    return { outcome };
  }

  /**
   * Development only: "pays" a fake-gateway link and delivers its signed webhook through the real
   * handler, so the parent app and tests can complete a payment without a Razorpay account.
   */
  @Post('dev-pay/:paymentId')
  @HttpCode(200)
  async devPay(@Param('paymentId') paymentId: string) {
    const gateway = this.deps.gateway as FakeGateway | null;
    if (gateway?.name !== 'fake') throw new NotFoundException({ code: 'not_found' });
    const [p] = await this.deps.db.execute<{ ref: string }>(
      // ops is tenant-free plumbing: the payment's link id, by its payment id.
      sql`select reference as ref from ops.payment_ref where payment_id = ${Id.parse(paymentId)}`,
    );
    if (!p) throw new NotFoundException({ code: 'payment_not_found' });
    const hook = gateway.pay(p.ref);
    return { outcome: await handleWebhook(this.deps.db, gateway, hook, this.deps.placements) };
  }
}
