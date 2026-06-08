import { api } from './client';
import type { MonthlyAttentionReport } from './types';

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

export interface JiraReportRange {
  projectId: number;
  from: string;
  to: string;
}

export interface JiraSource {
  integrationId: number;
  projectKey: string;
}

export interface MultiJiraReportBody {
  clientId: number;
  from: string;
  to: string;
  sources: JiraSource[];
  title?: string;
  additionalContext?: string;
}

export interface MultiJiraReportSource {
  integrationId: number;
  projectKey: string;
  integrationLabel: string;
  report: JiraMonthlyReport;
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

export const reportsApi = {
  jiraMonthly: (body: JiraReportRange): Promise<JiraMonthlyReport> =>
    api.post('/reports/jira/monthly', body).then((r) => r.data),

  generateDocument: (body: JiraReportRange): Promise<{ documentId: number }> =>
    api.post('/reports/jira/monthly/generate-document', body).then((r) => r.data),

  jiraMulti: (body: MultiJiraReportBody): Promise<MultiJiraReport> =>
    api.post('/reports/jira/multi', body).then((r) => r.data),

  generateMultiDocument: (body: MultiJiraReportBody): Promise<{ documentId: number }> =>
    api.post('/reports/jira/multi/generate-document', body).then((r) => r.data),

  monthlyAttention: (params: {
    clientId: number;
    from: string;
    to: string;
  }): Promise<MonthlyAttentionReport> =>
    api.post('/reports/attention/monthly', params).then((r) => r.data),

  generateMonthlyAttentionDocument: (params: {
    clientId: number;
    from: string;
    to: string;
    additionalContext?: string;
  }): Promise<{ documentId: number }> =>
    api.post('/reports/attention/monthly/generate-document', params).then((r) => r.data),
};
