import { NotFoundException } from '@nestjs/common';

import { ClientsService } from '../clients/clients.service';

/**
 * Lo único del cliente que cualquier vista del portal necesita para
 * encabezarse: su razón social.
 *
 * Vivía duplicada, palabra por palabra, en
 * `PortalAuthService.resolveClientRazonSocial` y en el
 * `PortalReportsService.resolveClientName` original — mismo `try`, misma
 * degradación a `null`, mismo relanzado, y **la misma regla de seguridad**:
 * proyectar campo a campo y publicar solo la razón social, nunca el RUC, la
 * dirección ni los datos de facturación. Dos copias de una proyección con
 * función de seguridad son dos reglas, y es exactamente el motivo por el que
 * este módulo extrajo `STATUS_LABELS` a `requirement-status-labels.ts` en vez
 * de copiarlo: la que alguien actualice en un sitio y olvide en el otro es la
 * que hace que dos pantallas del portal se contradigan.
 *
 * Se pide el cliente completo a `ClientsService` (única vía de acceso que
 * expone `ClientsModule` al portal) porque es el método que ya existe; la
 * proyección real ocurre aquí, quedándose solo con `razonSocial`.
 */
export async function resolveClientRazonSocial(
  clients: ClientsService,
  clientId: number,
): Promise<string | null> {
  try {
    const client = await clients.findByIdOrFail(clientId);
    return client.razonSocial;
  } catch (err) {
    // Un cliente que ya no existe degrada a null — el llamador decide cómo
    // mostrarlo (la cabecera del login cae al nombre del usuario; el informe
    // mensual publica `clientName: null`). Cualquier otro fallo —la base
    // caída, por ejemplo— tiene que seguir subiendo: silenciarlo lo
    // disfrazaría de "cliente sin resolver" y perdería el 500 que de verdad es.
    if (err instanceof NotFoundException) return null;
    throw err;
  }
}
