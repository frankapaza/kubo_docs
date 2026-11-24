import { Injectable, Logger } from '@nestjs/common';

/**
 * Costura para pedir una comprobación cruzada a la sonda del centro de datos
 * (`kubo-01`), que corre dentro del worker. El evaluador la llama cuando la
 * oficina confirma un fallo; el resultado llega como un check `CROSS` de
 * `kubo-01`. El worker (Task 10) sobrescribe este proveedor; en el backend
 * web no hay sonda local y la petición se ignora (el cruce vence a los 2 min).
 */
export abstract class DatacenterCrossChecker {
  abstract request(serviceId: number): void;
}

@Injectable()
export class NoopDatacenterCrossChecker extends DatacenterCrossChecker {
  private readonly logger = new Logger(NoopDatacenterCrossChecker.name);

  request(serviceId: number): void {
    this.logger.debug(`Cruce para el servicio ${serviceId} sin sonda de centro de datos en este proceso`);
  }
}
