import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
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
import TicketDetailPage from './pages/TicketDetailPage';
import WorkItemsBoardPage from './pages/WorkItemsBoardPage';
import MonthlyReportPage from './pages/MonthlyReportPage';
import SignaturePage from './pages/SignaturePage';
import PortalLoginPage from './pages/portal/PortalLoginPage';
import PortalTicketsListPage from './pages/portal/PortalTicketsListPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { PortalProtectedRoute } from './auth/PortalProtectedRoute';
import { PortalAuthProvider } from './auth/PortalAuthContext';
import AppLayout from './layout/AppLayout';
import PortalLayout from './layout/PortalLayout';

/**
 * Envuelve únicamente el subárbol `/portal/*` con el contexto de sesión del
 * portal: no se agrega al `AuthProvider` global en `main.tsx` para no
 * mezclarlo con las rutas internas, que no lo necesitan ni deben poder leerlo.
 */
function PortalRoot() {
  return (
    <PortalAuthProvider>
      <Outlet />
    </PortalAuthProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/*
        Portal de clientes: fuera de `AppLayout` y de `ProtectedRoute` (guard
        de sesión interna) a propósito. Un usuario de cliente no tiene sesión
        interna, así que si el guard interno envolviera estas rutas lo
        mandaría siempre al login del panel.
      */}
      <Route element={<PortalRoot />}>
        <Route path="/portal/login" element={<PortalLoginPage />} />
        <Route element={<PortalProtectedRoute />}>
          <Route element={<PortalLayout />}>
            <Route path="/portal" element={<Navigate to="/portal/tickets" replace />} />
            <Route path="/portal/tickets" element={<PortalTicketsListPage />} />
            {/*
              Catch-all del propio subárbol del portal: sin él, una subruta no
              enumerada (p.ej. "/portal/loquesea") no casa con nada de aquí
              arriba y cae en el catch-all global de más abajo, que está
              gobernado por el guard interno — mandando a un cliente sin sesión
              interna a "/login" (el del panel) en vez de a "/portal/login".
              Al vivir dentro de `PortalProtectedRoute`, un cliente sin sesión
              de portal nunca llega a renderizar esta ruta: el guard lo
              redirige antes a "/portal/login".
            */}
            <Route path="/portal/*" element={<Navigate to="/portal/tickets" replace />} />
          </Route>
        </Route>
      </Route>

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
          <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          <Route path="/work-items" element={<WorkItemsBoardPage />} />
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
