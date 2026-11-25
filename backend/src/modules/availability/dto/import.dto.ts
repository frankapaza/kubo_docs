import { IsString, MaxLength, MinLength } from 'class-validator';

/** Tope del texto CSV: 256 KB (decisión 10). El tope en bytes lo aplica el servicio (413). */
export const IMPORT_CSV_MAX_BYTES = 256 * 1024;

export class ImportCsvDto {
  @IsString() @MinLength(1) @MaxLength(IMPORT_CSV_MAX_BYTES)
  csv!: string;
}
