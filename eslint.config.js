const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'public/images/**',
      'public/javascripts/courseEditor.js'
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022
    }
  },
  {
    files: [
      'server.js',
      'config/**/*.js',
      'controllers/**/*.js',
      'middleware/**/*.js',
      'models/**/*.js',
      'routes/**/*.js',
      'scripts/**/*.js',
      'services/**/*.js',
      'utils/**/*.js',
      '__tests__/**/*.js',
      'middleware.js',
      'firebase.js',
      'eslint.config.js'
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest
      }
    }
  },
  {
    files: ['public/javascripts/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Sortable: 'readonly',
        bootstrap: 'readonly',
        DOMPurify: 'readonly',
        marked: 'readonly',
        maptilerApiKey: 'readonly',
        maptilersdk: 'readonly',
        stages: 'readonly'
      }
    }
  },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-useless-catch': 'warn'
    }
  }
];
