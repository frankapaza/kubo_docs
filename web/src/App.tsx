import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ClientsListPage from './pages/ClientsListPage';
import ClientDetailPage from './pages/ClientDetailPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectMembersPage from './pages/ProjectMembersPage';
import MeetingsListPage from './pages/MeetingsListPage';
import MeetingDetailPage from './pages/MeetingDetailPage';
import ActaEditorPage from './pages/ActaEditorPage';
import UsersPage from './pages/UsersPage';
import AIProvidersPage from './pages/AIProvidersPage';
import IntegrationsPage from './pages/IntegrationsPage';
import TemplatesPage from './pages/TemplatesPage';
import DocumentEditorPage from './pages/DocumentEditorPage';
import WorkspaceSettingsPage from './pages/WorkspaceSettingsPage';
import JiraReportPage from './pages/JiraReportPage';
import DevReportBuilderPage from './pages/DevReportBuilderPage';
import BrowserRecorderPage from './pages/BrowserRecorderPage';
import AgentsPage from './pages/AgentsPage';
import AgentChatPage from './pages/AgentChatPage';
import TicketsListPage from './pages/TicketsListPage';
import RequestDetailPage from './pages/RequestDetailPage';
import MonthlyReportPage from './pages/MonthlyReportPage';
import SignaturePage from './pages/SignaturePage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import AppLayout from './layout/AppLayout';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/clients" replace />} />
          <Route path="/clients" element={<ClientsListPage />} />
          <Route path="/clients/:clientId" element={<ClientDetailPage />} />
          <Route path="/clients/:clientId/dev-report/new" element={<DevReportBuilderPage />} />
          <Route path="/clients/:clientId/monthly-report" element={<MonthlyReportPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId/members" element={<ProjectMembersPage />} />
          <Route path="/projects/:projectId/meetings" element={<MeetingsListPage />} />
          <Route path="/projects/:projectId/jira-report" element={<JiraReportPage />} />
          <Route path="/meetings/:meetingId" element={<MeetingDetailPage />} />
          <Route path="/meetings/:meetingId/record-web" element={<BrowserRecorderPage />} />
          <Route path="/actas/:actaId" element={<ActaEditorPage />} />
          <Route path="/tickets" element={<TicketsListPage />} />
          <Route path="/requests/:requestId" element={<RequestDetailPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:type" element={<AgentChatPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/admin/ai-providers" element={<AIProvidersPage />} />
          <Route path="/admin/integrations" element={<IntegrationsPage />} />
          <Route path="/admin/templates" element={<TemplatesPage />} />
          <Route path="/admin/workspace" element={<WorkspaceSettingsPage />} />
          <Route path="/documents/:documentId" element={<DocumentEditorPage />} />
        </Route>
      </Route>
      <Route path="/sign/:token" element={<SignaturePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
