import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { ClientsService } from '../clients/clients.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { JiraService, JiraMonthlyReport } from '../integrations/jira.service';
import { LLMService } from '../ai/llm.service';
import { DocumentsService } from '../documents/documents.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ClientRequestsRepository } from '../client-requests/client-requests.repository';
import { ClientRequest, SERVICE_CATEGORIES, ServiceCategory } from '../client-requests/entities/client-request.entity';

export interface MultiJiraReportSource {
  integrationId: number;
  projectKey: string;
  integrationLabel: string;
  report: JiraMonthlyReport;
}

export interface MonthlyTicketRow {
  id: number;
  title: string | null;
  rawText: string;
  requestType: string | null;
  status: string;
  priority: string | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  attendedAt: Date | null;
  capturedAt: Date;
  durationMinutes: number | null;
  createdAt: Date;
}

export interface MonthlyAttentionCategoryGroup {
  category: ServiceCategory | 'SIN_CATEGORIA';
  label: string;
  count: number;
  completedCount: number;
  totalMinutes: number;
  tickets: MonthlyTicketRow[];
}

export interface MonthlyAttentionReport {
  clientId: number;
  clientName: string;
  range: { from: string; to: string };
  totals: {
    total: number;
    completed: number;
    pending: number;
    totalMinutes: number;
  };
  byCategory: MonthlyAttentionCategoryGroup[];
}

export interface MultiJiraReport {
  clientId: number;
  range: { from: string; to: string };
  sources: MultiJiraReportSource[];
  combined: {
    totals: {
      created: number;
      resolved: number;
      inProgress: number;
      stillOpen: number;
    };
    byAssignee: Array<{ name: string; created: number; resolved: number }>;
    byIssueType: Array<{ name: string; count: number }>;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  SOFTWARE: 'Atención de sistemas',
  SOPORTE: 'Atención de soporte',
  CAPACITACION: 'Capacitación',
  CONSULTA: 'Consultas',
  ASESORIA: 'Apoyo en asesoría',
  VISITA_SITIO: 'Visita en sitio',
  OTRO: 'Otro',
  SIN_CATEGORIA: 'Sin categoría',
};

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly projects: ProjectsService,
    private readonly clients: ClientsService,
    private readonly integrations: IntegrationsService,
    private readonly jira: JiraService,
    private readonly llm: LLMService,
    private readonly documents: DocumentsService,
    private readonly clientRequestsRepo: ClientRequestsRepository,
  ) {}

  /**
   * Obtiene el informe mensual estructurado desde Jira para un proyecto Kubo.
   * El proyecto debe tener jiraIntegrationId + jiraProjectKey configurados.
   */
  async getJiraMonthlyReport(
    user: AuthUser,
    projectId: number,
    from: string,
    to: string,
  ): Promise<JiraMonthlyReport> {
    const project = await this.projects.findByIdForUser(projectId, user);
    if (!project.jiraIntegrationId || !project.jiraProjectKey) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message:
          'Este proyecto no tiene Jira configurado. Vincúlalo primero desde la página del proyecto.',
      });
    }
    const integration = await this.integrations.findByIdOrFail(
      Number(project.jiraIntegrationId),
    );
    const auth = this.integrations.getJiraAuth(integration);
    return this.jira.getMonthlyReport(auth, project.jiraProjectKey, from, to);
  }

  /**
   * Toma el informe estructurado + proyecto + cliente, los pasa por IA para
   * armar una narrativa profesional, y guarda todo como CommercialDocument tipo OTHER.
   */
  async generateJiraReportDocument(
    user: AuthUser,
    projectId: number,
    from: string,
    to: string,
  ): Promise<{ documentId: number }> {
    const project = await this.projects.findByIdForUser(projectId, user);
    if (!project.clientId) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message:
          'El proyecto no está vinculado a un cliente. No se puede archivar el informe sin cliente.',
      });
    }

    const report = await this.getJiraMonthlyReport(user, projectId, from, to);

    // Construimos el contexto estructurado para la IA
    const dataSummary = this.buildDataSummary(report);

    const systemPrompt = [
      'Eres un Project Manager senior escribiendo un INFORME MENSUAL DE PROYECTO para un cliente.',
      'Toma los datos estructurados de Jira y redacta un informe profesional en español (Perú).',
      'Estructura del informe:',
      '1. Resumen ejecutivo (2-3 líneas con los highlights del mes)',
      '2. Logros del mes (con números y contexto narrativo)',
      '3. Trabajo en curso (qué está avanzando)',
      '4. Distribución por persona (reconocimiento por contribución)',
      '5. Próximos pasos / pendientes destacados',
      '',
      'Reglas:',
      '- Usa markdown con encabezados ##, listas y tablas.',
      '- NO inventes números. Usa únicamente los que están en los datos.',
      '- Tono profesional pero humano, no un volcado de datos.',
      '- Menciona nombres de personas cuando aporta al contexto.',
      '- Si un valor es 0 o no hay datos para una sección, omítela o acláralo.',
      '- Máximo 1200 palabras.',
    ].join('\n');

    const userPrompt = `Datos del mes ${from} al ${to} del proyecto ${project.name} (${project.code}):\n\n${dataSummary}`;

    this.logger.log(
      `generateJiraReportDocument: proyecto=${project.name} rango=${from}→${to} ${report.totals.created} creados, ${report.totals.resolved} resueltos`,
    );

    const narrative = await this.llm.chat(systemPrompt, [
      { role: 'user', content: userPrompt },
    ]);

    // Armamos el documento final con membrete + narrativa IA + anexos estructurados
    const monthLabel = new Date(from).toLocaleDateString('es-PE', {
      month: 'long',
      year: 'numeric',
    });
    const title = `Informe mensual — ${project.name} — ${monthLabel}`;

    const markdown = this.assembleFinalMarkdown(project.name, monthLabel, narrative, report);

    // Lo guardamos usando DocumentsService (tipo OTHER)
    const doc = await this.documents.createDocumentRaw(user.id, {
      clientId: Number(project.clientId),
      projectId,
      title,
      type: 'OTHER',
      contentMarkdown: markdown,
      variablesValues: {
        jira_project_key: report.projectKey,
        periodo_desde: from,
        periodo_hasta: to,
        total_creados: report.totals.created,
        total_resueltos: report.totals.resolved,
      },
    });
    return { documentId: doc.id };
  }

  private buildDataSummary(r: JiraMonthlyReport): string {
    const lines: string[] = [];
    lines.push(`### Totales del periodo`);
    lines.push(`- Creados: ${r.totals.created}`);
    lines.push(`- Resueltos: ${r.totals.resolved}`);
    lines.push(`- En progreso (actual): ${r.totals.inProgress}`);
    lines.push(`- Aún abiertos (actual): ${r.totals.stillOpen}`);
    lines.push('');

    if (r.byAssignee.length > 0) {
      lines.push(`### Por persona`);
      r.byAssignee.forEach((a) => {
        lines.push(`- ${a.name}: ${a.created} creados, ${a.resolved} resueltos`);
      });
      lines.push('');
    }

    if (r.byIssueType.length > 0) {
      lines.push(`### Por tipo de issue`);
      r.byIssueType.forEach((t) => {
        lines.push(`- ${t.name}: ${t.count}`);
      });
      lines.push('');
    }

    if (r.issuesResolved.length > 0) {
      lines.push(`### Issues resueltos en el periodo (primeros 20)`);
      r.issuesResolved.slice(0, 20).forEach((i) => {
        lines.push(`- [${i.key}] ${i.title} — ${i.assignee ?? 'sin asignar'}`);
      });
      lines.push('');
    }

    if (r.issuesInProgress.length > 0) {
      lines.push(`### Issues actualmente en progreso (primeros 15)`);
      r.issuesInProgress.slice(0, 15).forEach((i) => {
        lines.push(`- [${i.key}] ${i.title} — ${i.assignee ?? 'sin asignar'} (${i.status})`);
      });
    }

    return lines.join('\n');
  }

  private assembleFinalMarkdown(
    projectName: string,
    monthLabel: string,
    narrative: string,
    r: JiraMonthlyReport,
  ): string {
    const parts: string[] = [];

    // Header con membrete dinámico (el service renderer lo inyecta automáticamente en docs, pero aquí somos más directos)
    parts.push(`**{{emisor_razon_social}}**`);
    parts.push(
      `RUC {{emisor_ruc}} · {{emisor_direccion}}\n📱 {{emisor_telefono}} · 📧 {{emisor_email}} · 🌐 {{emisor_website}}`,
    );
    parts.push('\n---\n');

    parts.push(`# Informe mensual de proyecto`);
    parts.push(`**Proyecto:** ${projectName}  \n**Periodo:** ${monthLabel}  \n**Proyecto Jira:** ${r.projectKey}`);
    parts.push('\n---\n');

    // Narrativa generada por IA
    parts.push(narrative);
    parts.push('\n---\n');

    // Anexos estructurados (datos duros verificables)
    parts.push(`## Anexo A — Métricas del periodo`);
    parts.push('');
    parts.push('| Métrica | Valor |');
    parts.push('|---|---|');
    parts.push(`| Issues creados | ${r.totals.created} |`);
    parts.push(`| Issues resueltos | ${r.totals.resolved} |`);
    parts.push(`| En progreso (actual) | ${r.totals.inProgress} |`);
    parts.push(`| Aún abiertos (actual) | ${r.totals.stillOpen} |`);
    parts.push('');

    if (r.byAssignee.length > 0) {
      parts.push(`## Anexo B — Actividad por persona`);
      parts.push('');
      parts.push('| Persona | Creados | Resueltos |');
      parts.push('|---|---|---|');
      r.byAssignee.forEach((a) => {
        parts.push(`| ${a.name} | ${a.created} | ${a.resolved} |`);
      });
      parts.push('');
    }

    if (r.issuesResolved.length > 0) {
      parts.push(`## Anexo C — Issues resueltos en el periodo`);
      parts.push('');
      parts.push('| Key | Título | Asignado |');
      parts.push('|---|---|---|');
      r.issuesResolved.forEach((i) => {
        parts.push(`| ${i.key} | ${i.title} | ${i.assignee ?? '—'} |`);
      });
      parts.push('');
    }

    return parts.join('\n');
  }

  // ==================== MULTI-PROYECTO ====================

  /**
   * Trae los informes mensuales de uno o más proyectos Jira y los consolida.
   * Úsa esto para armar el informe ejecutivo a nivel de cliente.
   */
  async getMultiProjectReport(
    user: AuthUser,
    clientId: number,
    from: string,
    to: string,
    sources: Array<{ integrationId: number; projectKey: string }>,
  ): Promise<MultiJiraReport> {
    // Valida acceso al cliente
    await this.clients.findByIdOrFail(clientId);

    if (sources.length === 0) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Debes seleccionar al menos un proyecto Jira para el informe.',
      });
    }

    // Deduplica por (integrationId, projectKey)
    const dedup = new Map<string, { integrationId: number; projectKey: string }>();
    sources.forEach((s) => dedup.set(`${s.integrationId}|${s.projectKey}`, s));
    const uniqueSources = Array.from(dedup.values());

    // Fetch paralelo por cada fuente
    const results = await Promise.all(
      uniqueSources.map(async (src) => {
        const integration = await this.integrations.findByIdOrFail(src.integrationId);
        const auth = this.integrations.getJiraAuth(integration);
        const report = await this.jira.getMonthlyReport(auth, src.projectKey, from, to);
        return {
          integrationId: src.integrationId,
          projectKey: src.projectKey,
          integrationLabel: integration.label,
          report,
        };
      }),
    );

    // Agregación
    const combined = this.combineReports(results);

    // Descartar user para hacer felizs al linter; la valía ya se hizo arriba
    void user;

    return {
      clientId,
      range: { from, to },
      sources: results,
      combined,
    };
  }

  async generateMultiProjectReportDocument(
    user: AuthUser,
    params: {
      clientId: number;
      from: string;
      to: string;
      sources: Array<{ integrationId: number; projectKey: string }>;
      title?: string;
      additionalContext?: string;
    },
  ): Promise<{ documentId: number }> {
    const multi = await this.getMultiProjectReport(
      user,
      params.clientId,
      params.from,
      params.to,
      params.sources,
    );

    const client = await this.clients.findByIdOrFail(params.clientId);
    const monthLabel = new Date(params.from).toLocaleDateString('es-PE', {
      month: 'long',
      year: 'numeric',
    });
    const title = params.title?.trim() || `Informe de desarrollo — ${client.razonSocial} — ${monthLabel}`;

    // Armamos el contexto para la IA
    const dataSummary = this.buildMultiSummary(multi);
    const systemPrompt = [
      'Eres un Project Manager senior redactando un INFORME EJECUTIVO DE DESARROLLO para un cliente que tiene varios proyectos en paralelo.',
      'Tu salida debe sintetizar lo avanzado EN EL MES en todos los proyectos combinados, en español (Perú).',
      '',
      'Estructura:',
      '1. Resumen ejecutivo (3-4 líneas: qué lograron, qué destacar)',
      '2. Logros del mes (combinado: números totales + highlights por proyecto)',
      '3. Avance por proyecto (una sección corta por cada proyecto Jira, con 2-3 líneas y los números clave)',
      '4. Actividad por persona (quién aportó qué en conjunto)',
      '5. Trabajo en curso y próximos pasos',
      '',
      'Reglas:',
      '- Markdown con ## y ###, listas y tablas.',
      '- NO inventes números. Solo usa los de los datos.',
      '- Tono profesional dirigido a stakeholder no técnico.',
      '- Si un proyecto tuvo poca actividad (0-1 issues), agrúpalo en "otros proyectos" o mencionálo brevemente.',
      '- Máximo 1500 palabras.',
    ].join('\n');

    let userPrompt = `Datos consolidados del cliente "${client.razonSocial}" del ${params.from} al ${params.to}:\n\n${dataSummary}`;
    if (params.additionalContext?.trim()) {
      userPrompt += `\n\nCONTEXTO ADICIONAL del PM:\n${params.additionalContext}`;
    }

    this.logger.log(
      `generateMultiProjectReportDocument: cliente=${client.razonSocial} ${multi.sources.length} proyectos Jira, ${multi.combined.totals.resolved} resueltos`,
    );

    const narrative = await this.llm.chat(systemPrompt, [
      { role: 'user', content: userPrompt },
    ]);

    const markdown = this.assembleMultiMarkdown(client.razonSocial, monthLabel, narrative, multi);

    const doc = await this.documents.createDocumentRaw(user.id, {
      clientId: params.clientId,
      title,
      type: 'OTHER',
      contentMarkdown: markdown,
      variablesValues: {
        periodo_desde: params.from,
        periodo_hasta: params.to,
        total_creados: multi.combined.totals.created,
        total_resueltos: multi.combined.totals.resolved,
        num_proyectos_jira: multi.sources.length,
      },
    });
    return { documentId: doc.id };
  }

  private combineReports(
    sources: MultiJiraReportSource[],
  ): MultiJiraReport['combined'] {
    const totals = { created: 0, resolved: 0, inProgress: 0, stillOpen: 0 };
    const byAssigneeMap = new Map<string, { created: number; resolved: number }>();
    const byTypeMap = new Map<string, number>();

    for (const s of sources) {
      totals.created += s.report.totals.created;
      totals.resolved += s.report.totals.resolved;
      totals.inProgress += s.report.totals.inProgress;
      totals.stillOpen += s.report.totals.stillOpen;

      for (const a of s.report.byAssignee) {
        const entry = byAssigneeMap.get(a.name) ?? { created: 0, resolved: 0 };
        entry.created += a.created;
        entry.resolved += a.resolved;
        byAssigneeMap.set(a.name, entry);
      }
      for (const t of s.report.byIssueType) {
        byTypeMap.set(t.name, (byTypeMap.get(t.name) ?? 0) + t.count);
      }
    }

    const byAssignee = Array.from(byAssigneeMap.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.resolved + b.created - (a.resolved + a.created));

    const byIssueType = Array.from(byTypeMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return { totals, byAssignee, byIssueType };
  }

  private buildMultiSummary(m: MultiJiraReport): string {
    const lines: string[] = [];
    lines.push(`### Totales consolidados (todos los proyectos)`);
    lines.push(`- Issues creados: ${m.combined.totals.created}`);
    lines.push(`- Issues resueltos: ${m.combined.totals.resolved}`);
    lines.push(`- En progreso (actual): ${m.combined.totals.inProgress}`);
    lines.push(`- Aún abiertos (actual): ${m.combined.totals.stillOpen}`);
    lines.push('');

    lines.push(`### Desglose por proyecto`);
    for (const s of m.sources) {
      lines.push(`**${s.projectKey}** (${s.integrationLabel})`);
      lines.push(`  - Creados: ${s.report.totals.created}`);
      lines.push(`  - Resueltos: ${s.report.totals.resolved}`);
      lines.push(`  - En progreso: ${s.report.totals.inProgress}`);
      if (s.report.issuesResolved.length > 0) {
        lines.push(`  - Issues resueltos destacados:`);
        s.report.issuesResolved.slice(0, 8).forEach((i) => {
          lines.push(`    • [${i.key}] ${i.title} (${i.assignee ?? 'sin asignar'})`);
        });
      }
      lines.push('');
    }

    if (m.combined.byAssignee.length > 0) {
      lines.push(`### Por persona (consolidado)`);
      m.combined.byAssignee.forEach((a) => {
        lines.push(`- ${a.name}: ${a.created} creados, ${a.resolved} resueltos`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  // ==================== REPORTE MENSUAL DE ATENCIÓN ====================

  async getMonthlyAttentionReport(
    clientId: number,
    from: string,
    to: string,
  ): Promise<MonthlyAttentionReport> {
    const client = await this.clients.findByIdOrFail(clientId);

    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setDate(toDate.getDate() + 1); // incluir el día `to` completo

    const tickets = await this.clientRequestsRepo.listByClientAndRange({
      clientId,
      from: fromDate,
      to: toDate,
    });

    const grouped = this.groupByCategory(tickets);

    const total = tickets.length;
    const completed = tickets.filter((t) => t.status === 'COMPLETED').length;
    const totalMinutes = tickets.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0);

    return {
      clientId,
      clientName: client.razonSocial,
      range: { from, to },
      totals: { total, completed, pending: total - completed, totalMinutes },
      byCategory: grouped,
    };
  }

  async generateMonthlyAttentionDocument(
    userId: number,
    clientId: number,
    from: string,
    to: string,
    additionalContext?: string,
  ): Promise<{ documentId: number }> {
    const report = await this.getMonthlyAttentionReport(clientId, from, to);

    if (report.totals.total === 0) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'No hay tickets registrados en el periodo seleccionado.',
      });
    }

    const monthLabel = new Date(from).toLocaleDateString('es-PE', {
      month: 'long',
      year: 'numeric',
    });

    const systemPrompt = [
      'Eres un especialista de soporte redactando un REPORTE MENSUAL DE ATENCIÓN para un cliente.',
      'Recibes datos estructurados de tickets/solicitudes atendidas en el mes y redactas un informe profesional en español (Perú).',
      '',
      'Estructura del informe:',
      '1. Resumen ejecutivo (2-3 líneas destacando lo más relevante del mes)',
      '2. Atenciones del mes por categoría (narrativa corta por cada categoría con actividad)',
      '3. Indicadores clave (tablas de totales, horas, estados)',
      '4. Observaciones y recomendaciones (si aplica)',
      '',
      'Reglas:',
      '- Usa markdown con ##, ###, listas y tablas.',
      '- NO inventes números. Solo usa los proporcionados.',
      '- Tono profesional pero cercano, dirigido al cliente.',
      '- Si no hubo actividad en una categoría, omítela.',
      '- Máximo 1000 palabras.',
    ].join('\n');

    const dataSummary = this.buildAttentionSummary(report);
    let userPrompt = `Datos de atención del cliente "${report.clientName}" del ${from} al ${to}:\n\n${dataSummary}`;
    if (additionalContext?.trim()) {
      userPrompt += `\n\nCONTEXTO ADICIONAL:\n${additionalContext}`;
    }

    this.logger.log(
      `generateMonthlyAttentionDocument: cliente=${report.clientName} ${report.totals.total} tickets, ${report.totals.totalMinutes}min`,
    );

    const narrative = await this.llm.chat(systemPrompt, [{ role: 'user', content: userPrompt }]);
    const markdown = this.assembleAttentionMarkdown(report, monthLabel, narrative);
    const title = `Reporte mensual de atención — ${report.clientName} — ${monthLabel}`;

    const doc = await this.documents.createDocumentRaw(userId, {
      clientId,
      title,
      type: 'OTHER',
      contentMarkdown: markdown,
      variablesValues: {
        periodo_desde: from,
        periodo_hasta: to,
        total_tickets: report.totals.total,
        tickets_completados: report.totals.completed,
        horas_totales: +(report.totals.totalMinutes / 60).toFixed(1),
      },
    });

    return { documentId: doc.id };
  }

  private groupByCategory(tickets: ClientRequest[]): MonthlyAttentionCategoryGroup[] {
    const map = new Map<string, ClientRequest[]>();

    for (const t of tickets) {
      const key = t.serviceCategory ?? 'SIN_CATEGORIA';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }

    // Orden: categorías definidas primero, SIN_CATEGORIA al final
    const order = [...(SERVICE_CATEGORIES as string[]), 'SIN_CATEGORIA'];
    const groups: MonthlyAttentionCategoryGroup[] = [];

    for (const cat of order) {
      const items = map.get(cat);
      if (!items || items.length === 0) continue;
      groups.push({
        category: cat as ServiceCategory,
        label: CATEGORY_LABELS[cat] ?? cat,
        count: items.length,
        completedCount: items.filter((t) => t.status === 'COMPLETED').length,
        totalMinutes: items.reduce((s, t) => s + (t.durationMinutes ?? 0), 0),
        tickets: items.map((t) => ({
          id: t.id,
          title: t.title,
          rawText: t.rawText,
          requestType: t.requestType,
          status: t.status,
          priority: t.priority,
          scheduledAt: t.scheduledAt,
          completedAt: t.completedAt,
          attendedAt: t.attendedAt,
          capturedAt: t.capturedAt,
          durationMinutes: t.durationMinutes,
          createdAt: t.createdAt,
        })),
      });
    }

    return groups;
  }

  private buildAttentionSummary(r: MonthlyAttentionReport): string {
    const lines: string[] = [];
    lines.push(`### Totales del periodo`);
    lines.push(`- Total de atenciones: ${r.totals.total}`);
    lines.push(`- Completadas: ${r.totals.completed}`);
    lines.push(`- Pendientes: ${r.totals.pending}`);
    lines.push(`- Horas totales invertidas: ${(r.totals.totalMinutes / 60).toFixed(1)}h`);
    lines.push('');

    for (const grp of r.byCategory) {
      lines.push(`### ${grp.label} (${grp.count} atenciones)`);
      lines.push(`- Completadas: ${grp.completedCount} / ${grp.count}`);
      if (grp.totalMinutes > 0) {
        lines.push(`- Horas invertidas: ${(grp.totalMinutes / 60).toFixed(1)}h`);
      }
      grp.tickets.slice(0, 10).forEach((t) => {
        const label = t.title ?? t.rawText.slice(0, 80);
        const status = t.status === 'COMPLETED' ? '✓' : '○';
        lines.push(`  ${status} ${label}`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  private assembleAttentionMarkdown(
    r: MonthlyAttentionReport,
    monthLabel: string,
    narrative: string,
  ): string {
    const parts: string[] = [];

    parts.push(`**{{emisor_razon_social}}**`);
    parts.push(`RUC {{emisor_ruc}} · {{emisor_direccion}}\n📱 {{emisor_telefono}} · 📧 {{emisor_email}} · 🌐 {{emisor_website}}`);
    parts.push('\n---\n');

    parts.push(`# Reporte Mensual de Atención`);
    parts.push(`**Cliente:** ${r.clientName}  \n**Periodo:** ${monthLabel}`);
    parts.push('\n---\n');

    parts.push(narrative);
    parts.push('\n---\n');

    parts.push(`## Anexo A — Resumen de atenciones`);
    parts.push('');
    parts.push('| Categoría | Atenciones | Completadas | Horas |');
    parts.push('|---|---|---|---|');
    for (const grp of r.byCategory) {
      const hrs = grp.totalMinutes > 0 ? `${(grp.totalMinutes / 60).toFixed(1)}h` : '—';
      parts.push(`| ${grp.label} | ${grp.count} | ${grp.completedCount} | ${hrs} |`);
    }
    parts.push(`| **TOTAL** | **${r.totals.total}** | **${r.totals.completed}** | **${(r.totals.totalMinutes / 60).toFixed(1)}h** |`);
    parts.push('');

    for (const grp of r.byCategory) {
      parts.push(`## ${grp.label}`);
      parts.push('');
      parts.push('| # | Descripción | Tipo | Estado | Fecha |');
      parts.push('|---|---|---|---|---|');
      grp.tickets.forEach((t, i) => {
        const desc = (t.title ?? t.rawText).slice(0, 80);
        const tipo = t.requestType ?? '—';
        const estado = t.status === 'COMPLETED' ? 'Completado' : t.status === 'SENT' ? 'En Jira' : 'Pendiente';
        const fecha = new Date(t.createdAt).toLocaleDateString('es-PE');
        parts.push(`| ${i + 1} | ${desc} | ${tipo} | ${estado} | ${fecha} |`);
      });
      parts.push('');
    }

    return parts.join('\n');
  }

  private assembleMultiMarkdown(
    clientName: string,
    monthLabel: string,
    narrative: string,
    m: MultiJiraReport,
  ): string {
    const parts: string[] = [];
    parts.push(`**{{emisor_razon_social}}**`);
    parts.push(
      `RUC {{emisor_ruc}} · {{emisor_direccion}}\n📱 {{emisor_telefono}} · 📧 {{emisor_email}} · 🌐 {{emisor_website}}`,
    );
    parts.push('\n---\n');

    parts.push(`# Informe de Desarrollo`);
    parts.push(
      `**Cliente:** ${clientName}  \n**Periodo:** ${monthLabel}  \n**Proyectos Jira incluidos:** ${m.sources.map((s) => s.projectKey).join(', ')}`,
    );
    parts.push('\n---\n');

    parts.push(narrative);
    parts.push('\n---\n');

    // Anexo A: métricas consolidadas
    parts.push(`## Anexo A — Métricas consolidadas`);
    parts.push('');
    parts.push('| Métrica | Valor |');
    parts.push('|---|---|');
    parts.push(`| Issues creados | ${m.combined.totals.created} |`);
    parts.push(`| Issues resueltos | ${m.combined.totals.resolved} |`);
    parts.push(`| En progreso (actual) | ${m.combined.totals.inProgress} |`);
    parts.push(`| Aún abiertos (actual) | ${m.combined.totals.stillOpen} |`);
    parts.push('');

    // Anexo B: desglose por proyecto
    parts.push(`## Anexo B — Desglose por proyecto Jira`);
    parts.push('');
    parts.push('| Proyecto | Creados | Resueltos | En progreso |');
    parts.push('|---|---|---|---|');
    m.sources.forEach((s) => {
      parts.push(
        `| ${s.projectKey} | ${s.report.totals.created} | ${s.report.totals.resolved} | ${s.report.totals.inProgress} |`,
      );
    });
    parts.push('');

    // Anexo C: por persona consolidado
    if (m.combined.byAssignee.length > 0) {
      parts.push(`## Anexo C — Actividad por persona (consolidado)`);
      parts.push('');
      parts.push('| Persona | Creados | Resueltos |');
      parts.push('|---|---|---|');
      m.combined.byAssignee.forEach((a) => {
        parts.push(`| ${a.name} | ${a.created} | ${a.resolved} |`);
      });
      parts.push('');
    }

    // Anexo D: issues resueltos por proyecto
    m.sources.forEach((s) => {
      if (s.report.issuesResolved.length > 0) {
        parts.push(`## Anexo D.${s.projectKey} — Issues resueltos en ${s.projectKey}`);
        parts.push('');
        parts.push('| Key | Título | Asignado |');
        parts.push('|---|---|---|');
        s.report.issuesResolved.forEach((i) => {
          parts.push(`| ${i.key} | ${i.title} | ${i.assignee ?? '—'} |`);
        });
        parts.push('');
      }
    });

    return parts.join('\n');
  }
}
