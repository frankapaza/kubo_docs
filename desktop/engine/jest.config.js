module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testRegex: '.*\.spec\.ts$',
  transform: {
    '^.+\.ts$': [
      'ts-jest',
      { tsconfig: { module: 'commonjs', target: 'ES2022', strict: true, esModuleInterop: true, skipLibCheck: true, types: ['node', 'jest'] } },
    ],
  },
  testEnvironment: 'node',
};
