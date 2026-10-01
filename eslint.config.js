const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
};

export default [
  { ignores: ['node_modules/**', 'vendor/**', '.superpowers/**'] },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { window: 'readonly', document: 'readonly', Intl: 'readonly', URL: 'readonly' },
    },
    rules,
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', Intl: 'readonly',
        setImmediate: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
      },
    },
    rules,
  },
];
