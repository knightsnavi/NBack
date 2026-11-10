import js from '@eslint/js';

const browser = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', localStorage: 'readonly',
  performance: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', requestAnimationFrame: 'readonly',
  getComputedStyle: 'readonly', fetch: 'readonly', caches: 'readonly', Response: 'readonly', URL: 'readonly',
  URLSearchParams: 'readonly', Blob: 'readonly', Audio: 'readonly', Event: 'readonly', Notification: 'readonly',
  SpeechSynthesisUtterance: 'readonly', CSS: 'readonly', console: 'readonly', self: 'readonly', Promise: 'readonly',
};
const node = { process: 'readonly', console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', globalThis: 'readonly', URL: 'readonly' };
// page.evaluate() callbacks in the tooling run inside the browser
const nodeWithPage = { ...node, window: 'readonly', document: 'readonly', localStorage: 'readonly', MutationObserver: 'readonly', PointerEvent: 'readonly', Event: 'readonly', performance: 'readonly' };

export default [
  { ignores: ['node_modules/**', 'android/**', 'ios/**', 'screenshots/**', 'docs/**', 'scripts/explainer/frames/**'] },
  js.configs.recommended,
  {
    files: ['www/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: browser },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: nodeWithPage },
    rules: { 'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
];
