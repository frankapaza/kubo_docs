import { Repository } from 'typeorm';
import { AgentDisk, MonitorAgentSample } from '../entities/monitor-agent-sample.entity';

/**
 * Discos de la última muestra de cada servidor (índice `server_id, at`). Una
 * consulta por servidor: son pocos y cada una lee una sola fila.
 */
export async function latestAgentDisks(
  samples: Repository<MonitorAgentSample>,
  serverIds: number[],
): Promise<Map<number, AgentDisk[]>> {
  const out = new Map<number, AgentDisk[]>();
  for (const serverId of serverIds) {
    const last = await samples.findOne({ where: { serverId }, order: { at: 'DESC' }, select: { id: true, disks: true } });
    if (last) out.set(serverId, last.disks);
  }
  return out;
}
