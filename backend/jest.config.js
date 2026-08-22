// Fuerza TZ=UTC antes de que Jest arranque a los workers, y no dentro de un
// setupFile.
//
// La causa NO es que V8/ICU cacheen la zona al arrancar el proceso -- en un
// proceso Node normal, reasignar `process.env.TZ` tarde SI actualiza `Date`
// e `Intl`, en Windows y en Linux por igual. La causa real es que Jest le da
// a cada `setupFile` (y a cada fichero de prueba) un objeto `process`
// aislado del sandbox, no el `process` nativo: escribir `process.env.TZ`
// ahi nunca llega al proceso real, con o sin workers, con o sin
// `--runInBand`. Por eso `setupFiles` no sirve para esto en ninguna
// plataforma.
//
// Aqui si funciona porque este fichero lo `require()` la CLI de Jest en su
// propio proceso Node, antes de crear el sandbox de las pruebas y antes de
// bifurcar a los workers: escribe sobre el `process.env` real, y los
// workers heredan ese entorno al nacer.
//
// Fragilidad a tener presente: el mecanismo depende de que esta
// configuracion siga siendo un `.js` ejecutable. Si alguien la migra al
// campo `"jest"` de `package.json` (JSON puro, sin codigo), este forzado
// desaparece en silencio y los fallos de zona horaria vuelven a ser
// invisibles en el host de desarrollo.
//
// Ver `backend/src/common/time-zone.ts` para el porque de fondo: producción
// corre en UTC, y el host de desarrollo no.
process.env.TZ = 'UTC';

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
