// Verse AI (docs/specs/ASSETS.md): the register and stock as counts and short lists (tags and
// item names only; custodians' names stay out).
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { assetFigures, assets, stock, type AssetDeps } from './assets.js';

export function assetTools(deps: AssetDeps): VerseTool[] {
  return [
    defineTool({
      name: 'assets.summary',
      description:
        'The asset register and consumable stock: assets on record, total recorded cost, assets ' +
        'needing repair or broken (tag, name, where), warranties ending within 30 days, and stock ' +
        'items at or below their reorder level with the balance.',
      permission: ['assets.item.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({}),
      handler: async (ctx) => {
        const f = await assetFigures(deps, ctx.actor, ctx.institutionId);
        const list = await assets(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          search: '',
        });
        const st = await stock(deps, ctx.actor, ctx.institutionId);
        return {
          data: {
            ...f,
            attention: list
              .filter((a) => a.condition !== 'good')
              .slice(0, 30)
              .map((a) => ({
                tag: a.tag,
                name: a.name,
                condition: a.condition,
                location: a.location,
              })),
            warrantyEnding: list
              .filter((a) => a.warrantySoon)
              .map((a) => ({ tag: a.tag, name: a.name, until: a.warrantyUntil })),
            lowStock: st
              .filter((s) => s.low)
              .map((s) => ({ item: s.name, balance: s.balance, unit: s.unit })),
          },
          sources: [{ label: 'Assets', href: '/assets', asOf: ctx.today }],
        };
      },
    }),
  ];
}
