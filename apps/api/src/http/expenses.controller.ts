import {
  ExpenseBillInput,
  ExpenseBudgetInput,
  ExpenseCategoryInput,
  ExpenseDecisionInput,
  ExpensePayInput,
  ExpensePlaceInput,
  ExpenseVendorInput,
  Id,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import {
  FileRefused,
  cleanFileBytes,
  storeFile,
  type ObjectStore,
} from '@campusverse/platform-documents';
import type { Actor } from '@campusverse/platform-permissions';
import {
  bill,
  billFile,
  billUploadCheck,
  bills,
  budgets,
  cancelBill,
  categories,
  decideBill,
  expenseFigures,
  payBill,
  recordBill,
  saveCategory,
  saveVendor,
  setBudget,
  vendors,
  type ExpenseDeps,
} from '@campusverse/shared-expenses';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { DB, PERMISSIONS, STORE, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};
const FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const View = z.enum(['waiting', 'to_pay', 'paid', 'closed', 'all']);
const FinancialYear = z.string().regex(/^\d{4}-\d{2}$/);

/** Expenses (docs/specs/EXPENSES.md): bills, approval, payment, budgets, vendors, categories. */
@Controller('expenses')
@UseGuards(ActorGuard)
export class ExpensesController {
  private readonly deps: ExpenseDeps;
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PERMISSIONS) private readonly permissions: Permissions,
    @Inject(STORE) private readonly store: ObjectStore,
  ) {
    this.deps = { db, permissions };
  }

  @Get('figures')
  figures(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return expenseFigures(this.deps, actorOf(req), Id.parse(i));
  }

  @Get('categories')
  categories(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return categories(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('categories')
  addCategory(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveCategory(this.deps, actorOf(req), { id: null, ...ExpenseCategoryInput.parse(body) });
  }

  @Put('categories/:id')
  editCategory(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveCategory(this.deps, actorOf(req), {
      id: Id.parse(id),
      ...ExpenseCategoryInput.parse(body),
    });
  }

  @Get('vendors')
  vendors(
    @Query('institutionId') i: string,
    @Query('search') search: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return vendors(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      search: (search ?? '').slice(0, 100),
    });
  }

  @Post('vendors')
  addVendor(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveVendor(this.deps, actorOf(req), { id: null, ...ExpenseVendorInput.parse(body) });
  }

  @Put('vendors/:id')
  editVendor(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveVendor(this.deps, actorOf(req), {
      id: Id.parse(id),
      ...ExpenseVendorInput.parse(body),
    });
  }

  /** Multipart: the bill's photo or PDF, before the bill is saved. Returns its file id. */
  @Post('files')
  async upload(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    const actor = actorOf(req);
    const file = await req.file();
    if (!file) throw new BadRequestException({ code: 'file_missing' });
    if (!FILE_TYPES.has(file.mimetype)) throw new FileRefused('file_type');
    const check = await billUploadCheck(this.deps, actor, Id.parse(i));
    const fileId = await storeFile(this.db, this.permissions, this.store, actor, check, {
      purpose: 'expense_bill',
      fileName: file.filename,
      contentType: file.mimetype,
      bytes: new Uint8Array(await file.toBuffer()),
    });
    return { fileId, fileName: file.filename, contentType: file.mimetype };
  }

  @Get('bills')
  bills(
    @Query('institutionId') i: string,
    @Query('view') view: string | undefined,
    @Query('search') search: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return bills(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      view: View.parse(view ?? 'waiting'),
      search: (search ?? '').slice(0, 100),
    });
  }

  @Post('bills')
  record(@Body() body: unknown, @Req() req: AuthedRequest) {
    return recordBill(this.deps, actorOf(req), ExpenseBillInput.parse(body));
  }

  @Get('bills/:id')
  bill(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return bill(this.deps, actorOf(req), { institutionId: Id.parse(i), billId: Id.parse(id) });
  }

  /** The bill's photo or PDF. A file still being scanned is a 404. */
  @Get('bills/:id/file')
  async file(
    @Param('id') id: string,
    @Query('institutionId') i: string,
    @Req() req: AuthedRequest,
    @Res() reply: FastifyReply,
  ) {
    const actor = actorOf(req);
    const fileId = await billFile(this.deps, actor, {
      institutionId: Id.parse(i),
      billId: Id.parse(id),
    });
    const f = await cleanFileBytes(this.db, this.store, actor.orgId, fileId).catch(() => null);
    if (!f) throw new NotFoundException({ code: 'file_not_ready' });
    const name = f.fileName.replace(/[^\w.\- ]/g, '_');
    await reply
      .header('content-type', f.contentType)
      .header('content-disposition', `inline; filename="${name}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(f.bytes));
  }

  @Post('bills/:id/decide')
  @HttpCode(204)
  async decide(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await decideBill(this.deps, actorOf(req), {
      billId: Id.parse(id),
      ...ExpenseDecisionInput.parse(body),
    });
  }

  @Post('bills/:id/cancel')
  @HttpCode(204)
  async cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await cancelBill(this.deps, actorOf(req), {
      billId: Id.parse(id),
      ...ExpensePlaceInput.parse(body),
    });
  }

  @Post('bills/:id/pay')
  pay(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return payBill(this.deps, actorOf(req), {
      billId: Id.parse(id),
      ...ExpensePayInput.parse(body),
    });
  }

  @Get('budgets')
  budgets(
    @Query('institutionId') i: string,
    @Query('financialYear') fy: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return budgets(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      financialYear: fy ? FinancialYear.parse(fy) : null,
    });
  }

  @Put('budgets')
  @HttpCode(204)
  async setBudget(@Body() body: unknown, @Req() req: AuthedRequest) {
    await setBudget(this.deps, actorOf(req), ExpenseBudgetInput.parse(body));
  }
}
