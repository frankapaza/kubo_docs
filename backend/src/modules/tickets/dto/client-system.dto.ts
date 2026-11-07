import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/**
 * Asignar a un cliente un producto del catálogo.
 *
 * El nombre ya no se teclea nunca: se elige de la lista. Que `name` no esté
 * aquí --ni en `UpdateClientSystemDto`-- es lo que cierra la puerta de atrás del
 * texto libre: con `forbidNonWhitelisted`, mandarlo devuelve 400 en vez de
 * ignorarse en silencio.
 */
export class AssignClientSystemDto {
  @IsInt() @Min(1)
  systemId!: number;
}

/** Lo único que se mueve de una asignación es si el cliente lo sigue usando. */
export class UpdateClientSystemDto {
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
