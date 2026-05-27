module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es6: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  extends: [
    'eslint:recommended',
    'plugin:import/recommended',
    'plugin:promise/recommended',
    'prettier',
  ],
  plugins: ['import', 'promise'],
  rules: {
    // 复杂度
    complexity: ['error', { max: 20 }],
    // 嵌套深度
    'max-depth': ['error', 4],
    // 行长度（和 prettier printWidth:80 对齐）
    'max-len': [
      'error',
      {
        code: 80,
        ignoreComments: true,
        ignoreTrailingComments: true,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
      },
    ],
    // 单文件行数
    'max-lines': [
      'error',
      { max: 1000, skipBlankLines: true, skipComments: true },
    ],
    // 函数参数数量
    'max-params': ['error', 4],
    // import 排序
    'import/order': [
      'error',
      {
        groups: [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index',
        ],
      },
    ],
    'import/prefer-default-export': 'off',
    // 禁止修改参数本身（属性可改）
    'no-param-reassign': [
      'error',
      {
        props: true,
        ignorePropertyModificationsFor: [
          'acc',
          'ctx',
          'draft',
          'e',
          'el',
          'options',
          'req',
          'request',
          'res',
          'response',
          'nodes',
        ],
      },
    ],
    'no-console': 'off',
    'no-underscore-dangle': 'off',
    'no-var': 'error',
    'prefer-const': 'warn',
    eqeqeq: 'error',
    // 语句间空行
    'padding-line-between-statements': [
      'error',
      { blankLine: 'always', prev: 'function', next: '*' },
      { blankLine: 'always', prev: 'if', next: '*' },
      { blankLine: 'always', prev: '*', next: 'return' },
    ],
  },
  ignorePatterns: [
    '*.min.*',
    '*.d.ts',
    'dist',
    'node_modules',
    'package-lock.json',
  ],
};
