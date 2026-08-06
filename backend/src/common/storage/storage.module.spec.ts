import { Inject, Injectable, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test, TestingModuleBuilder } from '@nestjs/testing';

import { StorageModule } from './storage.module';
import { AudioModule } from '../../modules/audio/audio.module';
import { AudioService } from '../../modules/audio/audio.service';
import {
  IStorageService,
  STORAGE_SERVICE,
} from '../../modules/audio/interfaces/storage.interface';
import { LocalStorageService } from '../../modules/audio/services/local-storage.service';
import { TranscriptionsModule } from '../../modules/transcriptions/transcriptions.module';
import { TranscriptionsService } from '../../modules/transcriptions/transcriptions.service';

/**
 * El cableado del almacenamiento, después de sacarlo de `AudioModule`.
 *
 * Lo que se comprueba aquí no es lógica: es que el contenedor de Nest resuelve
 * lo mismo que antes. Ese es exactamente el fallo que un cambio de módulos
 * introduce sin que el compilador diga una palabra — se ve al arrancar, en
 * producción, y tumba el proceso entero.
 *
 * Y no es hipotético: la primera versión de este cambio dejaba
 * `exports: [STORAGE_SERVICE]` en `AudioModule` después de mover el proveedor
 * a `StorageModule`. TypeScript no dice nada; Nest lanza al escanear el grafo
 * («cannot export a provider/module that is not a part of the currently
 * processed module»). Este test lo cazó, y esa es la única razón por la que
 * existe.
 *
 * `ConfigModule` va con `isGlobal: true` porque así lo declara `AppModule`, y
 * `LocalStorageService` inyecta `ConfigService` sin que ningún módulo importe
 * `ConfigModule` — ni `AudioModule` antes, ni `StorageModule` ahora.
 */
const configGlobal = () => ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true });

/**
 * Lo que no es de este cambio, sustituido para que el grafo se pueda montar sin
 * MySQL ni Redis:
 *
 *  · El `DataSource`, del que cuelgan todos los repositorios que declaran los
 *    `TypeOrmModule.forFeature` de este módulo y de los que importa. Uno solo
 *    los cubre todos, y así el test no lleva una lista de entidades que se
 *    queda vieja. Va por `useMocker` y no por `overrideProvider` porque sin
 *    `TypeOrmModule.forRoot` ese token no existe en el contenedor, y
 *    `overrideProvider` solo sustituye lo que ya está.
 *  · La cola `transcription`. Es la que hace falta sustituir de verdad: sin
 *    ella BullMQ construye una `Queue` real, que abre una conexión a Redis que
 *    nadie cierra y deja la suite colgada sin llegar a fallar.
 */
const dataSourceFalso = {
  entityMetadatas: [],
  options: { type: 'mysql' },
  getRepository: () => ({}),
};

const conDependenciasExternasSustituidas = (builder: TestingModuleBuilder): TestingModuleBuilder =>
  builder
    .overrideProvider(getQueueToken('transcription'))
    .useValue({})
    .useMocker((token) => (token === getDataSourceToken() ? dataSourceFalso : {}));

describe('StorageModule', () => {
  it('provee STORAGE_SERVICE y es un LocalStorageService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [configGlobal(), StorageModule],
    }).compile();

    expect(moduleRef.get(STORAGE_SERVICE)).toBeInstanceOf(LocalStorageService);
    await moduleRef.close();
  });

  /**
   * Un módulo que solo quiere escribir un archivo lo importa y no arrastra nada
   * más. Es el motivo entero de la extracción: importar `AudioModule` le habría
   * traído la cola de BullMQ, el pipeline de transcripción y la dependencia de
   * que Redis esté en pie.
   */
  it('un consumidor nuevo lo recibe importando solo StorageModule', async () => {
    @Injectable()
    class ConsumidorNuevo {
      constructor(@Inject(STORAGE_SERVICE) readonly storage: IStorageService) {}
    }

    @Module({ imports: [StorageModule], providers: [ConsumidorNuevo] })
    class ModuloDeEjemplo {}

    const moduleRef = await Test.createTestingModule({
      imports: [configGlobal(), ModuloDeEjemplo],
    }).compile();

    expect(moduleRef.get(ConsumidorNuevo).storage).toBeInstanceOf(LocalStorageService);
    await moduleRef.close();
  });

  describe('AudioModule sigue funcionando sin proveerlo él', () => {
    it('AudioService recibe el almacenamiento local, como antes', async () => {
      const moduleRef = await conDependenciasExternasSustituidas(
        Test.createTestingModule({ imports: [configGlobal(), AudioModule] }),
      ).compile();

      const audio = moduleRef.get(AudioService) as unknown as { storage: unknown };
      expect(audio.storage).toBeInstanceOf(LocalStorageService);

      await moduleRef.close();
    });

    /**
     * `TranscriptionsModule` y `ActasModule` inyectan `STORAGE_SERVICE` y lo
     * reciben importando `AudioModule`. No se han tocado en este cambio, así
     * que si la exportación se hubiera perdido por el camino se habrían roto al
     * arrancar y no antes.
     *
     * Se monta el módulo de transcripciones **de verdad**, no una imitación:
     * lo importa con `forwardRef`, y una reexportación que funcionara con un
     * import directo pero no a través de una referencia adelantada sería
     * exactamente el fallo que este test tiene que ver.
     */
    it('TranscriptionsService sigue recibiendo el mismo STORAGE_SERVICE', async () => {
      const moduleRef = await conDependenciasExternasSustituidas(
        Test.createTestingModule({ imports: [configGlobal(), TranscriptionsModule] }),
      ).compile();

      const transcriptions = moduleRef.get(TranscriptionsService) as unknown as {
        storage: unknown;
      };
      expect(transcriptions.storage).toBeInstanceOf(LocalStorageService);

      // Y es la MISMA instancia que ve el módulo de audio. Si `AudioModule`
      // volviera a proveer el token por su cuenta habría dos almacenamientos
      // distintos: la retención de audios borraría sobre uno mientras el resto
      // del sistema escribe en el otro.
      const audio = moduleRef.get(AudioService) as unknown as { storage: unknown };
      expect(transcriptions.storage).toBe(audio.storage);

      await moduleRef.close();
    });
  });
});
