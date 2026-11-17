import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/.expo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Read config through @campusverse/config, never process.env directly.',
        },
      ],
    },
  },
  {
    files: ['packages/config/**', '**/*.config.*', '.dependency-cruiser.cjs'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // A missing row fails the test anyway; assertions keep fixtures readable.
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // Nest modules are classes with only decorators and static factories, by design.
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/no-extraneous-class': 'off' },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable' } },
  },
  {
    // k6 load scripts run in k6, which provides these.
    files: ['load/**/*.js'],
    languageOptions: { globals: { __ENV: 'readonly', open: 'readonly' } },
  },
);
