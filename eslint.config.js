const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.zwork/**',
      'data/**',
      'public/uploads/**',
      'public/assets/**',
      'public/gallery-placeholders/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-console': 'off',
    },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.test.js', 'tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Сервер E2E — модуль: sourceType по расширению не определяется автоматически.
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // page.evaluate выполняет колбэк в браузере, поэтому document/getComputedStyle
    // здесь такие же глобалы, как и process.
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
];
