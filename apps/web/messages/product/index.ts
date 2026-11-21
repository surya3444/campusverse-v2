// English text for the public product pages: /product, each system and each module.
import { CORE_MODULES } from './modules-core';
import { LEARNING_MODULES } from './modules-learning';
import { OPERATIONS_MODULES } from './modules-operations';
import { SYSTEM_CONTENT } from './systems';
import type { ModuleContent } from './types';

export type { ModuleContent, SystemContent } from './types';
export { SYSTEM_CONTENT };

/** Detailed content of every live module, by module key. */
export const MODULE_CONTENT: Record<string, ModuleContent> = {
  ...LEARNING_MODULES,
  ...OPERATIONS_MODULES,
  ...CORE_MODULES,
};

export const productText = {
  meta: {
    product: 'The platform · Campusverse',
    productDescription:
      'Nine connected systems on one Campus Core, with Verse AI across them: every system and module of Campusverse explained.',
    system: (name: string) => `${name} · Campusverse`,
    module: (name: string, system: string) => `${name} · ${system} · Campusverse`,
  },
  crumbs: { home: 'Home', product: 'Platform' },
  nav: {
    overview: 'Overview',
    browse: 'Browse the platform',
    label: 'Platform',
    crumbs: 'Breadcrumb',
    pager: 'More pages',
    previous: 'Previous',
    next: 'Next',
  },
  facts: {
    modules: 'Modules',
    usedBy: 'Used by',
    connects: 'Hands work to',
    status: 'Status',
    for: 'For',
    partOf: 'Part of',
    worksWith: 'Works with',
  },
  table: { module: 'Module', what: 'What it does', status: 'Status' },
  systemsTable: { system: 'System', what: 'What it covers', modules: 'Live' },
  overview: {
    eyebrow: 'The platform',
    title: 'Nine systems. One Campus Core. Verse AI across all of it.',
    lead: 'Every system below works on the same learner, staff and money records. Open one to see how it works, who uses it and every module inside it.',
    modules: (live: number, all: number) => `${live} of ${all} modules live`,
    open: 'Explore',
    everyModule: 'Every module, by system',
  },
  status: { live: 'Live', building: 'Rolling out', planned: 'Coming next' } as Record<
    string,
    string
  >,
  forProfiles: (names: string[]) => `For ${names.join(', ').toLowerCase()}`,
  allProfiles: 'For schools, colleges and universities',
  system: {
    outcomes: 'What it gives you',
    journey: 'How it flows',
    modules: 'Modules inside',
    modulesLead: (live: number, all: number) => `${live} of ${all} live today.`,
    roles: 'Who works in it',
    connects: 'How it connects',
    india: 'Built for India',
    explore: 'Explore module',
    next: 'Next system',
  },
  module: {
    capabilities: 'What you can do',
    steps: 'How it works',
    roles: 'Who uses it',
    guardrails: 'Rules it keeps for you',
    related: 'Works with',
    partOf: (system: string) => `Part of ${system}`,
    comingTitle: 'Coming next',
    comingLead:
      'This module is on the roadmap. Here is what it will do; it will work on the same records as every live module.',
    buildingLead:
      'This module is rolling out now. Here is what it does; parts of it are still being built.',
    planned: 'What it will do',
    back: (system: string) => `All of ${system}`,
  },
  cta: {
    title: 'See it with your own data.',
    lead: 'Create your account and set up your first year, or book a 30-minute demo.',
    start: 'Create your account',
    demo: 'Book a demo',
  },
};
