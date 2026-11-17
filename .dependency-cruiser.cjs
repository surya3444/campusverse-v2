/** Enforces the module boundary rules in docs/BUILD_GUIDE.md ("Boundary rules"). */
const ACADEMIC = '^modules/(school|college|university)/';
const SHARED = '^modules/(platform|people|shared|independent)/';

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'cross-module-only-via-contract',
      comment: 'Rule 2: import another module only through its contract.ts.',
      severity: 'error',
      from: { path: '^modules/([^/]+)/([^/]+)/' },
      to: {
        path: '^modules/[^/]+/[^/]+/',
        pathNot: ['^modules/$1/$2/', '^modules/[^/]+/[^/]+/contract\\.ts$'],
      },
    },
    {
      name: 'academics-isolated',
      comment: 'Rule 4: school, college and university never import each other.',
      severity: 'error',
      from: { path: '^modules/(school|college|university)/' },
      to: { path: ACADEMIC, pathNot: '^modules/$1/' },
    },
    {
      name: 'engine-knows-no-profiles',
      comment:
        'The academic engine serves every profile; it never imports school, college or university modules.',
      severity: 'error',
      from: { path: '^modules/academics/' },
      to: { path: ACADEMIC },
    },
    {
      name: 'shared-knows-no-academics',
      comment: 'Rule 5: shared modules use the placement contract, not academic modules.',
      severity: 'error',
      from: { path: SHARED },
      to: { path: [ACADEMIC, '^modules/academics/'] },
    },
    {
      name: 'pure-domain',
      comment: 'Rule 3: domain code has no framework, database or HTTP imports.',
      severity: 'error',
      from: { path: '^modules/.+/domain/' },
      to: {
        path: [
          '(^|/)node_modules/(@nestjs|fastify|drizzle-orm|pg|postgres|ioredis|redis|bullmq|axios)(/|$)',
          '^modules/.+/(infrastructure|http|jobs)/',
          '^(node:)?(http|https|net)$',
        ],
      },
    },
    {
      name: 'apps-not-imported',
      comment: 'Packages and modules never depend on apps.',
      severity: 'error',
      from: { path: '^(packages|modules)/' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    includeOnly: '^(apps|packages|modules)/',
    exclude: { path: '(node_modules|dist|\\.next)/' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.js', '.mjs', '.svg', '.css'] },
  },
};
