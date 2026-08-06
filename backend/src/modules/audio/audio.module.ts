import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AudioFile } from './entities/audio-file.entity';
import { Transcription } from '../transcriptions/entities/transcription.entity';
import { AudioService } from './audio.service';
import { AudioController } from './audio.controller';
import { AudioRetentionService } from './services/audio-retention.service';
import { MeetingsModule } from '../meetings/meetings.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { StorageModule } from '../../common/storage/storage.module';

/**
 * `STORAGE_SERVICE` ya no se provee aquí: lo provee `StorageModule`, que este
 * módulo importa. Nació en este archivo porque los únicos archivos del sistema
 * eran audios; los adjuntos de tickets necesitan el mismo proveedor y no pueden
 * importar `AudioModule` para conseguirlo sin arrastrar la cola de BullMQ y el
 * pipeline de transcripción entero (ver la cabecera de `StorageModule`).
 *
 * Se sigue exportando el almacenamiento a propósito: `TranscriptionsModule` y
 * `ActasModule` lo reciben hoy por esta vía, y quitarlo los rompería sin
 * ninguna ganancia. Es la misma instancia del mismo `LocalStorageService`.
 *
 * Y se exporta el **módulo**, no el token. No es cosmético: Nest solo deja
 * exportar un proveedor que el propio módulo declara en `providers`. Dejar
 * `STORAGE_SERVICE` suelto en `exports` después de mover el proveedor compila
 * sin una queja y revienta al escanear el grafo, ya en el arranque, con
 * «cannot export a provider/module that is not a part of the currently
 * processed module». Reexportar `StorageModule` es la forma que Nest
 * documenta para esto y da a los importadores exactamente lo que tenían.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AudioFile, Transcription]),
    BullModule.registerQueue({ name: 'transcription' }),
    MeetingsModule,
    WorkspaceModule,
    StorageModule,
  ],
  providers: [AudioService, AudioRetentionService],
  controllers: [AudioController],
  exports: [AudioService, AudioRetentionService, StorageModule],
})
export class AudioModule {}
