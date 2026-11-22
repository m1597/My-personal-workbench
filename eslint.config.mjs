import parser from '@babel/eslint-parser'

export default [
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'components/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          plugins: [['@babel/plugin-syntax-typescript', { isTSX: true }]],
        },
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@fluentui/react-components',
              importNames: ['Select', 'Dropdown'],
              message: 'Use SharedDropdown to inherit the FitBay popup theme.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'components/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name="select"]',
          message: 'Use ChoiceDropdown for native-style choices.',
        },
        {
          selector:
            'CallExpression[callee.name="el"][arguments.0.value="select"], CallExpression[callee.property.name="createElement"][arguments.0.value="select"]',
          message: 'Mount the public dropdown in component DOM views.',
        },
      ],
    },
  },
  { files: ['src/renderer/src/app/SharedDropdown.tsx'], rules: { 'no-restricted-imports': 'off' } },
]
