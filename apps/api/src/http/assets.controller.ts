import {
  AssetDisposeInput,
  AssetInput,
  AssetNamedInput,
  AssetUpdateInput,
  Id,
  StockItemInput,
  StockMoveInput,
} from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import {
  addAsset,
  asset,
  assetFigures,
  assetSetup,
  assets,
  disposeAsset,
  findCustodians,
  moveStock,
  saveNamed,
  saveStockItem,
  stock,
  stockMovements,
  suggestTag,
  updateAsset,
  type AssetDeps,
} from '@campusverse/shared-assets';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { DB, PERMISSIONS, type AuthedRequest, type Permissions } from './deps.js';
import { ActorGuard } from './guards.js';

const actorOf = (req: AuthedRequest): Actor => {
  if (!req.actor) throw new UnauthorizedException({ code: 'unauthenticated' });
  return req.actor;
};
const Condition = z.enum(['good', 'needs_repair', 'broken']);
const maybeId = (v: string | undefined) => (v ? Id.parse(v) : null);

/** Assets and inventory (docs/specs/ASSETS.md). */
@Controller('assets')
@UseGuards(ActorGuard)
export class AssetsController {
  private readonly deps: AssetDeps;
  constructor(@Inject(DB) db: Db, @Inject(PERMISSIONS) permissions: Permissions) {
    this.deps = { db, permissions };
  }

  @Get('figures')
  figures(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return assetFigures(this.deps, actorOf(req), Id.parse(i));
  }

  @Get('setup')
  setup(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return assetSetup(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('setup')
  addNamed(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveNamed(this.deps, actorOf(req), { id: null, ...AssetNamedInput.parse(body) });
  }

  @Put('setup/:id')
  editNamed(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveNamed(this.deps, actorOf(req), { id: Id.parse(id), ...AssetNamedInput.parse(body) });
  }

  @Get('items')
  items(
    @Query('institutionId') i: string,
    @Query('search') search: string | undefined,
    @Query('locationId') locationId: string | undefined,
    @Query('categoryId') categoryId: string | undefined,
    @Query('condition') condition: string | undefined,
    @Query('disposed') disposed: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return assets(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      search: (search ?? '').slice(0, 100),
      locationId: maybeId(locationId),
      categoryId: maybeId(categoryId),
      condition: condition ? Condition.parse(condition) : null,
      disposed: disposed === 'true',
    });
  }

  @Get('items/next-tag')
  nextTag(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return suggestTag(this.deps, actorOf(req), Id.parse(i)).then((tag) => ({ tag }));
  }

  @Get('custodians')
  custodians(
    @Query('institutionId') i: string,
    @Query('text') text: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return findCustodians(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      text: (text ?? '').slice(0, 100),
    });
  }

  @Get('items/:id')
  item(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return asset(this.deps, actorOf(req), { institutionId: Id.parse(i), itemId: Id.parse(id) });
  }

  @Post('items')
  add(@Body() body: unknown, @Req() req: AuthedRequest) {
    return addAsset(this.deps, actorOf(req), AssetInput.parse(body));
  }

  @Post('items/:id/update')
  @HttpCode(204)
  async update(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await updateAsset(this.deps, actorOf(req), {
      itemId: Id.parse(id),
      ...AssetUpdateInput.parse(body),
    });
  }

  @Post('items/:id/dispose')
  @HttpCode(204)
  async dispose(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    await disposeAsset(this.deps, actorOf(req), {
      itemId: Id.parse(id),
      ...AssetDisposeInput.parse(body),
    });
  }

  @Get('stock')
  stock(@Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return stock(this.deps, actorOf(req), Id.parse(i));
  }

  @Post('stock')
  addStock(@Body() body: unknown, @Req() req: AuthedRequest) {
    return saveStockItem(this.deps, actorOf(req), { id: null, ...StockItemInput.parse(body) });
  }

  @Put('stock/:id')
  editStock(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return saveStockItem(this.deps, actorOf(req), {
      id: Id.parse(id),
      ...StockItemInput.parse(body),
    });
  }

  @Get('stock/:id/movements')
  movements(@Param('id') id: string, @Query('institutionId') i: string, @Req() req: AuthedRequest) {
    return stockMovements(this.deps, actorOf(req), {
      institutionId: Id.parse(i),
      itemId: Id.parse(id),
    });
  }

  @Post('stock/:id/move')
  move(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return moveStock(this.deps, actorOf(req), {
      itemId: Id.parse(id),
      ...StockMoveInput.parse(body),
    });
  }
}
