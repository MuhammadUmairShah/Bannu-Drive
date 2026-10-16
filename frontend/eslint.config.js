import js from '@eslint/js';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Focused on bugs the build cannot see: undefined identifiers / components, unused code, hook mistakes.
export default [
  { ignores: ['dist/**', 'node_modules/**', 'tests/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': hooks },
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: 'detect' } },
    rules: {
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'react/jsx-key': 'error',
      'react/no-unescaped-entities': 'off',
      'no-unused-vars': ['warn', { varsIgnorePattern: '^(React|[A-Z_])', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
