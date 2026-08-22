// Fuerza TZ=UTC antes de que Jest arranque a los workers, y no dentro de un
// setupFile: en un worker Windows, V8/ICU ya cachean la zona horaria del
// sistema en cuanto el proceso arranca, y una reasignacion tardia de
// `process.env.TZ` (por ejemplo desde `setupFiles`, que corre DESPUES de que
// el worker ya inicio) no la invalida -- se comprobo a mano en esta maquina.
// Mutarla aqui, antes de `module.exports`, la fija en el proceso padre de la
// CLI de Jest, que es quien bifurca (`fork`) los procesos worker: estos
// heredan el entorno del padre en el momento de nacer, así que arrancan ya
// con TZ=UTC, igual que si se hubiera exportado la variable antes de invocar
// node. Ver `backend/src/common/time-zone.ts` para el porque de fondo:
// producción corre en UTC, y el host de desarrollo no.
process.env.TZ = 'UTC';

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\.spec\.ts$',
  transform: { '^.+\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
