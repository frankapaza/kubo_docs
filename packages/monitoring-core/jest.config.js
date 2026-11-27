// Igual que backend/jest.config.js: fuerza TZ=UTC en el proceso real de Jest
// (antes de crear workers) para que los fallos de zona horaria no queden
// ocultos por la zona del host de desarrollo.
//
// Excepción: con MONITORING_CORE_KEEP_TZ=1 se respeta la TZ del entorno. Sirve
// para la segunda pasada `MONITORING_CORE_KEEP_TZ=1 TZ=America/Lima npx jest`,
// que prueba que el planificador no depende de la zona del proceso.
if (process.env.MONITORING_CORE_KEEP_TZ !== '1') {
  process.env.TZ = 'UTC';
}

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testRegex: '.*\.spec\.ts$',
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'ES2022', strict: true, esModuleInterop: true, skipLibCheck: true, types: ['node', 'jest'] } }] },
  testEnvironment: 'node',
};
