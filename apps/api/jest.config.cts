module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // ESM-only dependencies must go through ts-jest to run under CommonJS.
  transformIgnorePatterns: [
    '/node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?(cookie|content-disposition|geotiff|quick-lru|pako|xml-utils|zstddec|lerc|web-worker|parse-headers|@petamoriken/float16)/)',
  ],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/api',
};
