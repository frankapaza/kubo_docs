import { Module } from '@nestjs/common';
import { STORAGE_SERVICE } from '../../modules/audio/interfaces/storage.interface';
import { LocalStorageService } from '../../modules/audio/services/local-storage.service';

/**
 * El almacenamiento de archivos, solo.
 *
 * `STORAGE_SERVICE` lo proveía y exportaba `AudioModule`, que es donde nació:
 * los únicos archivos del sistema eran audios de reuniones. Con los adjuntos de
 * tickets deja de ser cierto, y el módulo de conversación necesita el mismo
 * proveedor.
 *
 * Importar `AudioModule` para conseguirlo habría funcionado, y es justo lo que
 * no se hace: ese módulo registra la cola `transcription` de BullMQ y arrastra
 * `MeetingsModule`, `WorkspaceModule`, `AudioService` y `AudioRetentionService`.
 * Un módulo de tickets que solo quiere escribir un PNG en disco acabaría
 * dependiendo del pipeline de transcripción entero — y de que Redis esté en
 * pie.
 *
 * Así que el proveedor se extrae aquí y `AudioModule` pasa a importarlo. No hay
 * cambio de comportamiento: es el mismo `LocalStorageService` y el mismo token,
 * y los tres consumidores que ya existían (`AudioService`,
 * `AudioRetentionService`, `TranscriptionsService` y `ActasService`) lo siguen
 * recibiendo por la reexportación de `AudioModule`, que se mantiene a
 * propósito. Cambiarles el import a la vez habría convertido un movimiento
 * mecánico en un refactor de cuatro módulos que están en producción.
 *
 * El token y la interfaz siguen viviendo en `modules/audio/interfaces/`: no se
 * mueven en este commit. Mover un símbolo que importan cuatro módulos en
 * producción es un cambio aparte del que lo necesita, y mezclarlos haría que
 * cualquier problema con la subida de audio fuese imposible de atribuir.
 */
@Module({
  providers: [{ provide: STORAGE_SERVICE, useClass: LocalStorageService }],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
