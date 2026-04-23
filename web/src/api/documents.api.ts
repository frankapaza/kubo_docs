import { api } from './client';
import type {
  CommercialDocument,
  CommercialDocumentStatus,
  ConformityStatus,
  DocumentSignatory,
  DocumentTemplate,
  DocumentType,
  SignatoryKind,
  TemplateVariable,
} from './types';

export interface UpsertTemplateBody {
  name: string;
  type: DocumentType;
  description?: string;
  contentMarkdown: string;
  variablesSchema: { variables: TemplateVariable[] };
  isActive?: boolean;
}

export interface CreateDocumentBody {
  clientId: number;
  templateId: number;
  title: string;
  variables: Record<string, string | number | null>;
  meetingId?: number;
  projectId?: number;
}

export interface UpdateDocumentBody {
  title?: string;
  contentMarkdown?: string;
  variables?: Record<string, string | number | null>;
  status?: CommercialDocumentStatus;
}

export const templatesApi = {
  list: (includeInactive = false) =>
    api
      .get<DocumentTemplate[]>('/document-templates', {
        params: includeInactive ? { all: 'true' } : {},
      })
      .then((r) => r.data),
  findOne: (id: number) =>
    api.get<DocumentTemplate>(`/document-templates/${id}`).then((r) => r.data),
  create: (body: UpsertTemplateBody) =>
    api.post<DocumentTemplate>('/document-templates', body).then((r) => r.data),
  update: (id: number, body: UpsertTemplateBody) =>
    api.patch<DocumentTemplate>(`/document-templates/${id}`, body).then((r) => r.data),
  remove: (id: number) =>
    api.delete<{ ok: true }>(`/document-templates/${id}`).then((r) => r.data),
};

export const documentsApi = {
  list: (params?: { clientId?: number; status?: CommercialDocumentStatus }) =>
    api.get<CommercialDocument[]>('/commercial-documents', { params }).then((r) => r.data),
  findOne: (id: number) =>
    api.get<CommercialDocument>(`/commercial-documents/${id}`).then((r) => r.data),
  create: (body: CreateDocumentBody) =>
    api.post<CommercialDocument>('/commercial-documents', body).then((r) => r.data),
  update: (id: number, body: UpdateDocumentBody) =>
    api.patch<CommercialDocument>(`/commercial-documents/${id}`, body).then((r) => r.data),
  remove: (id: number) =>
    api.delete<{ ok: true }>(`/commercial-documents/${id}`).then((r) => r.data),

  downloadPdf: async (id: number, filename?: string) => {
    const res = await api.get(`/commercial-documents/${id}/pdf`, {
      responseType: 'blob',
    });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? `documento-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  sendEmail: (
    id: number,
    body: { to: string; cc?: string; subject?: string; message?: string },
  ): Promise<{ messageId: string }> =>
    api.post(`/commercial-documents/${id}/send-email`, body).then((r) => r.data),
};

export const documentSignatoriesApi = {
  list: (documentId: number) =>
    api.get<DocumentSignatory[]>(`/documents/${documentId}/signatories`).then((r) => r.data),

  create: (
    documentId: number,
    body: {
      kind: SignatoryKind;
      fullName: string;
      documentNumber?: string;
      email?: string;
      role?: string;
      userId?: number;
    },
  ) =>
    api.post<DocumentSignatory>(`/documents/${documentId}/signatories`, body).then((r) => r.data),

  update: (
    id: number,
    body: { conformityStatus?: ConformityStatus; notes?: string; role?: string },
  ) =>
    api.patch<DocumentSignatory>(`/document-signatories/${id}`, body).then((r) => r.data),

  remove: (id: number) =>
    api.delete<{ ok: true }>(`/document-signatories/${id}`).then((r) => r.data),

  requestSignature: (id: number) =>
    api.post<DocumentSignatory>(`/document-signatories/${id}/request-signature`).then((r) => r.data),
};

export interface SignaturePageData {
  signatoryName: string;
  signatoryEmail: string;
  documentTitle: string;
  documentMarkdown: string;
  alreadySigned: boolean;
  signedAt: string | null;
  expired: boolean;
}

export const signatureApi = {
  getByToken: (token: string) =>
    api.get<SignaturePageData>(`/sign/${token}`).then((r) => r.data),
  confirm: (token: string) =>
    api.post<{ message: string; signedAt: string }>(`/sign/${token}/confirm`).then((r) => r.data),
};
