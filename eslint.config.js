// ESLint baseline — correctness only, tuned to the EXISTING codebase style.
// Deliberately NOT enforced: no-explicit-any (the codebase uses `any` at SQL
// row boundaries by convention), stylistic/formatting rules (Prettier config
// exists but is not run repo-wide — no world-reformat).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', '.netlify/', 'coverage/', 'docs/', 'db/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // react-hooks v6's new opinionated rules flag deliberate house patterns
      // (data loading via setState-in-effect ×43, latest-value refs, DOM work
      // in effects). Warn-level: visible in new code, not blocking the ones
      // that ship today. rules-of-hooks + exhaustive-deps stay errors.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      // fires on the defensive `let x = null` + branch-assign pattern used by
      // the dnd drop handlers; the initializer is intentional.
      'no-useless-assignment': 'warn',
      // any at SQL/wire boundaries is the house style; strictness comes from tsc.
      '@typescript-eslint/no-explicit-any': 'off',
      // tsc debt ledger tracks unused vars (docs/reference/CONFORMANCE.md);
      // warn here so new code surfaces them without failing existing files.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      // `let q; try { q = Parse(...) } catch` is the standard handler shape.
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },
  {
    // Node-side code (functions, scripts, tests) — process/console are normal.
    files: ['netlify/**', 'scripts/**', 'tests/**', 'db/templates/**'],
    rules: {
      'no-console': 'off',
    },
  },
);
