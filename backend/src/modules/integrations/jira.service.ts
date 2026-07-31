import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { BacklogResult } from '../ai/llm.types';

export interface JiraAuth {
  workspaceUrl: string;
  email: string;
  apiToken: string;
}

export interface JiraExportResult {
  projectKey: string;
  epicsCreated: number;
  storiesCreated: number;
  tasksCreated: number;
  issues: Array<{ key: string; title: string; type: string; url: string }>;
}

export interface JiraIssueSummary {
  key: string;
  title: string;
  status: string;
  issueType: string;
  assignee: string | null;
  created: string;
  updated: string;
  resolved: string | null;
  url: string;
}

export interface JiraMonthlyReport {
  projectKey: string;
  range: { from: string; to: string };
  totals: {
    created: number;
    resolved: number;
    inProgress: number;
    stillOpen: number;
  };
  byAssignee: Array<{ name: string; created: number; resolved: number }>;
  byIssueType: Array<{ name: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  issuesCreated: JiraIssueSummary[];
  issuesResolved: JiraIssueSummary[];
  issuesInProgress: JiraIssueSummary[];
}

@Injectable()
export class JiraService {
  private readonly logger = new Logger(JiraService.name);

  private authHeader(auth: JiraAuth): string {
    return 'Basic ' + Buffer.from(`${auth.email}:${auth.apiToken}`).toString('base64');
  }

  private adf(text: string, bulletList?: string[]) {
    const content: unknown[] = [];
    if (text) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text }],
      });
    }
    if (bulletList?.length) {
      content.push({
        type: 'bulletList',
        content: bulletList.map((item) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }],
        })),
      });
    }
    return { type: 'doc', version: 1, content };
  }

  private async createIssue(
    auth: JiraAuth,
    fields: Record<string, unknown>,
  ): Promise<{ key: string }> {
    const base = auth.workspaceUrl.replace(/\/$/, '');
    const url = `${base}/rest/api/3/issue`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader(auth),
        Accept: 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Jira API ${res.status}: ${text.slice(0, 400)}`);
      throw new BadGatewayException({
        code: 'JIRA_ERROR',
        message: `Jira respondió ${res.status}: ${text.slice(0, 200)}`,
      });
    }
    return res.json() as Promise<{ key: string }>;
  }

  /**
   * Crea un único issue en Jira. Pensado para "empujar una solicitud/atención".
   * Reintenta sin priority si la pantalla del proyecto no la soporta.
   */
  async createSingleIssue(
    auth: JiraAuth,
    input: {
      projectKey: string;
      summary: string;
      descriptionMarkdown: string | null;
      acceptanceCriteria?: string[] | null;
      labels?: string[] | null;
      priority?: 'Highest' | 'High' | 'Medium' | 'Low' | null;
      // Por defecto Task; si no existe en el proyecto cae a Story.
      preferredType?: 'Task' | 'Story';
    },
  ): Promise<{ key: string; url: string }> {
    const base = auth.workspaceUrl.replace(/\/$/, '');
    const types = await this.getIssueTypes(auth, input.projectKey);

    const preferredType = input.preferredType ?? 'Task';
    // types.story ya cae en "Task" si no existe Story en el proyecto
    const issueTypeId = preferredType === 'Story' ? types.story : (types.story ?? types.story);
    if (!issueTypeId) {
      throw new BadGatewayException({
        code: 'JIRA_ERROR',
        message: `El proyecto ${input.projectKey} no expone tipo Task ni Story`,
      });
    }

    const fields: Record<string, unknown> = {
      project: { key: input.projectKey },
      summary: input.summary,
      description: this.adf(
        input.descriptionMarkdown ?? '',
        input.acceptanceCriteria?.length ? input.acceptanceCriteria : undefined,
      ),
      issuetype: { id: issueTypeId },
    };
    if (input.labels?.length) {
      fields['labels'] = input.labels.map((l) => l.replace(/\s+/g, '-').toLowerCase());
    }
    if (types.hasPriority && input.priority) {
      fields['priority'] = { name: input.priority };
    }

    const { key } = await this.createIssue(auth, fields);
    return { key, url: `${base}/browse/${key}` };
  }

  async testConnection(auth: JiraAuth): Promise<{ ok: true; displayName: string }> {
    const base = auth.workspaceUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/rest/api/3/myself`, {
      headers: { Authorization: this.authHeader(auth), Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadGatewayException({
        code: 'JIRA_ERROR',
        message: `Jira respondió ${res.status}: ${text.slice(0, 200)}`,
      });
    }
    const data = (await res.json()) as { displayName?: string };
    return { ok: true, displayName: data.displayName ?? auth.email };
  }

  async listProjects(auth: JiraAuth): Promise<Array<{ key: string; name: string }>> {
    const base = auth.workspaceUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/rest/api/3/project/search?maxResults=50`, {
      headers: { Authorization: this.authHeader(auth), Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new BadGatewayException({ code: 'JIRA_ERROR', message: `Jira respondió ${res.status}` });
    }
    const data = (await res.json()) as { values?: Array<{ key: string; name: string }> };
    return (data.values ?? []).map((p) => ({ key: p.key, name: p.name }));
  }

  private async getIssueTypes(
    auth: JiraAuth,
    projectKey: string,
  ): Promise<{
    epic: string | null;
    story: string | null;
    subtask: string | null;
    storyPointsFieldId: string | null;
    hasPriority: boolean;
  }> {
    const base = auth.workspaceUrl.replace(/\/$/, '');
    const url = `${base}/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`;
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader(auth), Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadGatewayException({
        code: 'JIRA_ERROR',
        message: `No se pudieron leer los tipos de incidencia de ${projectKey}: ${text.slice(0, 200)}`,
      });
    }
    const data = (await res.json()) as {
      issueTypes?: Array<{ id: string; name: string; subtask: boolean }>;
    };
    const types = data.issueTypes ?? [];

    const EPIC_NAMES = ['epic', 'épica', 'epica'];
    const STORY_NAMES = ['story', 'historia', 'user story', 'historia de usuario'];
    const TASK_NAMES = ['task', 'tarea'];

    const normalize = (s: string) => s.trim().toLowerCase();
    const findByName = (names: string[]) =>
      types.find((t) => !t.subtask && names.includes(normalize(t.name)))?.id ?? null;

    const epic = findByName(EPIC_NAMES);
    const story = findByName(STORY_NAMES) ?? findByName(TASK_NAMES);
    const subtask = types.find((t) => t.subtask)?.id ?? null;

    if (!story) {
      throw new BadGatewayException({
        code: 'JIRA_ERROR',
        message: `El proyecto ${projectKey} no tiene tipos "Story"/"Historia" ni "Task"/"Tarea". Tipos disponibles: ${types.map((t) => t.name).join(', ')}`,
      });
    }

    // Descubrir qué campo maneja los Story Points Y si priority está disponible,
    // inspeccionando la pantalla de creación del tipo Story.
    const { storyPointsFieldId, hasPriority } = await this.inspectStoryFields(
      auth,
      projectKey,
      story,
    );

    return { epic, story, subtask, storyPointsFieldId, hasPriority };
  }

  private async inspectStoryFields(
    auth: JiraAuth,
    projectKey: string,
    storyIssueTypeId: string,
  ): Promise<{ storyPointsFieldId: string | null; hasPriority: boolean }> {
    try {
      const base = auth.workspaceUrl.replace(/\/$/, '');
      const url = `${base}/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${storyIssueTypeId}`;
      const res = await fetch(url, {
        headers: { Authorization: this.authHeader(auth), Accept: 'application/json' },
      });
      if (!res.ok) return { storyPointsFieldId: null, hasPriority: false };
      const data = (await res.json()) as {
        fields?: Array<{ fieldId: string; name: string }>;
        values?: Array<{ fieldId: string; name: string }>;
      };
      // algunas versiones usan .fields, otras .values
      const fields = data.fields ?? data.values ?? [];
      const spField = fields.find((f) =>
        /story\s*points?|story\s*point\s*estimate|puntos?\s*de\s*historia/i.test(f.name ?? ''),
      );
      const hasPriority = fields.some((f) => f.fieldId === 'priority');
      return { storyPointsFieldId: spField?.fieldId ?? null, hasPriority };
    } catch {
      return { storyPointsFieldId: null, hasPriority: false };
    }
  }

  async exportBacklog(
    auth: JiraAuth,
    projectKey: string,
    backlog: BacklogResult,
  ): Promise<JiraExportResult> {
    const base = auth.workspaceUrl.replace(/\/$/, '');
    const types = await this.getIssueTypes(auth, projectKey);
    const issues: JiraExportResult['issues'] = [];

    try {
      for (const epic of backlog.epics) {
        // si el proyecto no tiene tipo "Epic" (team-managed básico), creamos la épica como Story con prefijo
        const hasEpicType = !!types.epic;
        const epicTypeId = hasEpicType ? types.epic! : types.story!;
        const epicSummary = hasEpicType ? epic.title : `[ÉPICA] ${epic.title}`;

        const epicIssue = await this.createIssue(auth, {
          project: { key: projectKey },
          summary: epicSummary,
          description: this.adf(epic.description),
          issuetype: { id: epicTypeId },
        });
        issues.push({
          key: epicIssue.key,
          title: epic.title,
          type: hasEpicType ? 'Epic' : 'Story (epic stub)',
          url: `${base}/browse/${epicIssue.key}`,
        });

        for (const story of epic.stories) {
          const acText = story.acceptanceCriteria.length ? story.acceptanceCriteria : undefined;
          const storyFields: Record<string, unknown> = {
            project: { key: projectKey },
            summary: story.title,
            description: this.adf(story.description, acText),
            issuetype: { id: types.story! },
            parent: { key: epicIssue.key },
          };
          if (types.hasPriority) {
            storyFields['priority'] = {
              name: story.priority === 'Alta' ? 'High' : story.priority === 'Baja' ? 'Low' : 'Medium',
            };
          }
          if (story.storyPoints !== null && types.storyPointsFieldId) {
            storyFields[types.storyPointsFieldId] = story.storyPoints;
          }

          const storyIssue = await this.createIssue(auth, storyFields);
          issues.push({
            key: storyIssue.key,
            title: story.title,
            type: 'Story',
            url: `${base}/browse/${storyIssue.key}`,
          });

          if (types.subtask) {
            for (const task of story.tasks) {
              const taskIssue = await this.createIssue(auth, {
                project: { key: projectKey },
                summary: task.title,
                issuetype: { id: types.subtask },
                parent: { key: storyIssue.key },
              });
              issues.push({
                key: taskIssue.key,
                title: task.title,
                type: 'Subtask',
                url: `${base}/browse/${taskIssue.key}`,
              });
            }
          }
        }
      }
    } catch (err) {
      // Rollback: si ya se crearon issues, los borramos en orden inverso
      // (subtasks → stories → epics) para no dejar basura en Jira.
      const createdCount = issues.length;
      if (createdCount > 0) {
        this.logger.warn(
          `Export falló después de crear ${createdCount} issues. Ejecutando rollback…`,
        );
        const rollback = await this.rollbackIssues(
          auth,
          issues.map((i) => i.key),
        );
        this.logger.log(
          `Rollback: ${rollback.deleted}/${createdCount} eliminados` +
            (rollback.failed.length ? `, quedaron: ${rollback.failed.join(', ')}` : ''),
        );
        const originalMsg =
          err instanceof BadGatewayException
            ? ((err.getResponse() as { message?: string })?.message ?? String(err))
            : (err as Error).message;
        throw new BadGatewayException({
          code: 'JIRA_ERROR',
          message:
            rollback.failed.length === 0
              ? `${originalMsg} · Rollback completo: ${rollback.deleted} issues eliminados de Jira.`
              : `${originalMsg} · Rollback parcial: ${rollback.deleted}/${createdCount} eliminados. Quedaron en Jira: ${rollback.failed.join(', ')}`,
        });
      }
      throw err;
    }

    return {
      projectKey,
      epicsCreated: backlog.epics.length,
      storiesCreated: backlog.epics.reduce((a, e) => a + e.stories.length, 0),
      tasksCreated: types.subtask
        ? backlog.epics.reduce(
            (a, e) => a + e.stories.reduce((b, s) => b + s.tasks.length, 0),
            0,
          )
        : 0,
      issues,
    };
  }

  /**
   * Informe mensual: trae todos los issues actualizados en el rango [from, to]
   * y los agrega por estado, asignado, tipo.
   *
   * Usa el nuevo endpoint POST /rest/api/3/search/jql (el antiguo GET /search
   * fue deprecado por Atlassian — CHANGE-2046 en el changelog).
   */
  async getMonthlyReport(
    auth: JiraAuth,
    projectKey: string,
    from: string, // formato YYYY-MM-DD
    to: string, // formato YYYY-MM-DD
  ): Promise<JiraMonthlyReport> {
    const base = auth.workspaceUrl.replace(/\/$/, '');
    const jql = `project = "${projectKey}" AND updated >= "${from}" AND updated <= "${to} 23:59" ORDER BY updated DESC`;
    const fields = [
      'summary',
      'status',
      'issuetype',
      'assignee',
      'created',
      'updated',
      'resolutiondate',
    ];

    const all: JiraIssueSummary[] = [];
    const pageSize = 100;
    const url = `${base}/rest/api/3/search/jql`;
    let nextPageToken: string | undefined = undefined;
    const MAX_PAGES = 50; // safety: evitar bucles infinitos si el cursor falla

    for (let page = 0; page < MAX_PAGES; page++) {
      const body: Record<string, unknown> = {
        jql,
        fields,
        maxResults: pageSize,
      };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader(auth),
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.error(`Jira search/jql ${res.status}: ${text.slice(0, 400)}`);
        throw new BadGatewayException({
          code: 'JIRA_ERROR',
          message: `Jira respondió ${res.status} al consultar issues: ${text.slice(0, 200)}`,
        });
      }
      const data = (await res.json()) as {
        issues: Array<{
          key: string;
          fields: {
            summary: string;
            status: { name: string };
            issuetype: { name: string };
            assignee: { displayName: string } | null;
            created: string;
            updated: string;
            resolutiondate: string | null;
          };
        }>;
        nextPageToken?: string;
        isLast?: boolean;
      };
      for (const issue of data.issues ?? []) {
        all.push({
          key: issue.key,
          title: issue.fields.summary ?? '(sin título)',
          status: issue.fields.status?.name ?? 'Desconocido',
          issueType: issue.fields.issuetype?.name ?? 'Desconocido',
          assignee: issue.fields.assignee?.displayName ?? null,
          created: issue.fields.created,
          updated: issue.fields.updated,
          resolved: issue.fields.resolutiondate,
          url: `${base}/browse/${issue.key}`,
        });
      }
      if (data.isLast || !data.nextPageToken || (data.issues?.length ?? 0) === 0) break;
      nextPageToken = data.nextPageToken;
    }

    // Agregaciones
    const fromTime = new Date(from).getTime();
    const toTime = new Date(`${to} 23:59:59`).getTime();
    const inRange = (iso: string | null) => {
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= fromTime && t <= toTime;
    };
    const isInProgress = (status: string) =>
      /progress|progreso|review|qa|doing|desarrollo/i.test(status);
    const isDone = (status: string, resolved: string | null) =>
      inRange(resolved) || /done|resuelto|resolved|closed|cerrado|finalizado/i.test(status);

    const issuesCreated = all.filter((i) => inRange(i.created));
    const issuesResolved = all.filter((i) => inRange(i.resolved));
    const issuesInProgress = all.filter((i) => isInProgress(i.status));
    const stillOpen = all.filter((i) => !isDone(i.status, i.resolved));

    // Por asignado
    const assigneeMap = new Map<string, { created: number; resolved: number }>();
    for (const i of all) {
      const name = i.assignee ?? '(Sin asignar)';
      const entry = assigneeMap.get(name) ?? { created: 0, resolved: 0 };
      if (inRange(i.created)) entry.created++;
      if (inRange(i.resolved)) entry.resolved++;
      assigneeMap.set(name, entry);
    }
    const byAssignee = Array.from(assigneeMap.entries())
      .map(([name, v]) => ({ name, ...v }))
      .filter((a) => a.created > 0 || a.resolved > 0)
      .sort((a, b) => b.resolved + b.created - (a.resolved + a.created));

    // Por tipo
    const typeMap = new Map<string, number>();
    for (const i of all) {
      typeMap.set(i.issueType, (typeMap.get(i.issueType) ?? 0) + 1);
    }
    const byIssueType = Array.from(typeMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Por estado
    const statusMap = new Map<string, number>();
    for (const i of all) {
      statusMap.set(i.status, (statusMap.get(i.status) ?? 0) + 1);
    }
    const byStatus = Array.from(statusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    return {
      projectKey,
      range: { from, to },
      totals: {
        created: issuesCreated.length,
        resolved: issuesResolved.length,
        inProgress: issuesInProgress.length,
        stillOpen: stillOpen.length,
      },
      byAssignee,
      byIssueType,
      byStatus,
      issuesCreated,
      issuesResolved,
      issuesInProgress,
    };
  }

  /**
   * Borra issues de Jira en orden inverso (para respetar dependencias subtask → story → epic).
   * Devuelve cuántos se eliminaron y cuáles fallaron.
   */
  private async rollbackIssues(
    auth: JiraAuth,
    keys: string[],
  ): Promise<{ deleted: number; failed: string[] }> {
    const base = auth.workspaceUrl.replace(/\/$/, '');
    const reversed = [...keys].reverse();
    let deleted = 0;
    const failed: string[] = [];
    for (const key of reversed) {
      try {
        // deleteSubtasks=true fuerza a borrar subtareas junto con el issue padre
        const url = `${base}/rest/api/3/issue/${encodeURIComponent(key)}?deleteSubtasks=true`;
        const res = await fetch(url, {
          method: 'DELETE',
          headers: { Authorization: this.authHeader(auth), Accept: 'application/json' },
        });
        if (res.ok || res.status === 204) {
          deleted++;
        } else {
          failed.push(key);
          this.logger.warn(`Rollback falló para ${key}: HTTP ${res.status}`);
        }
      } catch (e) {
        failed.push(key);
        this.logger.warn(`Rollback error para ${key}: ${(e as Error).message}`);
      }
    }
    return { deleted, failed };
  }
}
