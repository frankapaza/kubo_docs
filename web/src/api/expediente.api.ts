import { api } from './client';

export type WorkType = 'TRADICIONAL' | 'AGIL' | 'CORRECTIVO';
export type DeliverableStatus = 'PENDIENTE' | 'BORRADOR' | 'EN_REVISION' | 'APROBADO' | 'FIRMADO' | 'NO_APLICA';
export type Phase = 'INICIO' | 'PLANIFICACION' | 'EJECUCION' | 'MONITOREO' | 'CIERRE';

export const WORK_TYPE_OPTIONS: { value: WorkType; label: string; hint: string }[] = [
  { value: 'TRADICIONAL', label: 'Desarrollo tradicional', hint: 'Cronograma, análisis completo y todas las actas.' },
  { value: 'AGIL', label: 'Desarrollo ágil', hint: 'Historias de usuario e iteraciones; sin cronograma fijo.' },
  { value: 'CORRECTIVO', label: 'Mantenimiento correctivo', hint: 'Solo manual de despliegue y pase a producción.' },
];

/** Los tipos del catálogo, para «Agregar entregable». */
export const DELIVERABLE_TYPES: { type: string; name: string }[] = [
  { type: 'ACT-REU', name: 'Acta de reunión' },
  { type: 'SOL-CAM', name: 'Solicitud de cambio' },
  { type: 'INF-GES', name: 'Informe de gestión' },
  { type: 'ACT-CAP', name: 'Acta de capacitación' },
  { type: 'PRU-FUN', name: 'Pruebas funcionales' },
  { type: 'INF-PRU', name: 'Informe de pruebas' },
  { type: 'SOL-PAP', name: 'Solicitud de pase a producción' },
  { type: 'ACT-USU', name: 'Acta de conformidad de usuario' },
  { type: 'MAN-USU', name: 'Manual de usuario' },
  { type: 'DOC-SER', name: 'Documento de servicios' },
];

export interface DeliverableFile {
  versionId: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface Deliverable {
  id: number;
  correlative: number;
  type: string;
  name: string;
  phase: Phase;
  phaseLabel: string;
  requirement: 'O' | 'OP' | 'NA';
  status: DeliverableStatus;
  statusLabel: string;
  naReason: string | null;
  autoNa: boolean;
  fromCatalog: boolean;
  version: string | null;
  nomenclature: string;
  lastFile: DeliverableFile | null;
  updatedAt: string;
}

export interface Expediente {
  project: { id: number; code: string; name: string; workType: WorkType | null; workTypeLabel: string | null };
  deliverables: Deliverable[];
  summary: {
    total: number;
    required: number;
    approved: number;
    inProgress: number;
    pending: number;
    notApplicable: number;
    phases: { phase: Phase; label: string; total: number; done: number }[];
  };
}

export interface HistoryEntry {
  id: number;
  action: 'E' | 'R' | 'A' | 'F' | 'N' | 'P';
  actionLabel: string;
  version: string | null;
  note: string | null;
  file: { filename: string; mimeType: string; sizeBytes: number } | null;
  actorUserId: number | null;
  actorName: string | null;
  createdAt: string;
}

const base = (projectId: number) => `/projects/${projectId}/expediente`;
const d = (projectId: number, id: number) => `${base(projectId)}/deliverables/${id}`;

function saveBlob(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** El nombre que manda el servidor en Content-Disposition (filename*=UTF-8''… o filename="…"). */
function filenameFrom(header: string | undefined, fallback: string): string {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      /* sigue con el simple */
    }
  }
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

export const expedienteApi = {
  get: (projectId: number) => api.get<Expediente>(base(projectId)).then((r) => r.data),
  setWorkType: (projectId: number, workType: WorkType) =>
    api.put<Expediente>(`${base(projectId)}/work-type`, { workType }).then((r) => r.data),
  add: (projectId: number, type: string, title?: string) =>
    api.post<Deliverable>(`${base(projectId)}/deliverables`, { type, title: title || undefined }).then((r) => r.data),
  remove: (projectId: number, id: number) => api.delete(d(projectId, id)).then(() => undefined),
  history: (projectId: number, id: number) => api.get<HistoryEntry[]>(`${d(projectId, id)}/history`).then((r) => r.data),
  upload: (projectId: number, id: number, file: File, note?: string) => {
    const form = new FormData();
    form.append('file', file, file.name);
    if (note) form.append('note', note);
    return api.post<Deliverable>(`${d(projectId, id)}/versions`, form).then((r) => r.data);
  },
  sign: (projectId: number, id: number, file: File | null, note?: string) => {
    const form = new FormData();
    if (file) form.append('file', file, file.name);
    if (note) form.append('note', note);
    return api.post<Deliverable>(`${d(projectId, id)}/sign`, form).then((r) => r.data);
  },
  submit: (projectId: number, id: number, note?: string) =>
    api.post<Deliverable>(`${d(projectId, id)}/submit`, { note: note || undefined }).then((r) => r.data),
  observe: (projectId: number, id: number, note: string) =>
    api.post<Deliverable>(`${d(projectId, id)}/observe`, { note }).then((r) => r.data),
  approve: (projectId: number, id: number, note?: string) =>
    api.post<Deliverable>(`${d(projectId, id)}/approve`, { note: note || undefined }).then((r) => r.data),
  notApplicable: (projectId: number, id: number, note: string) =>
    api.post<Deliverable>(`${d(projectId, id)}/not-applicable`, { note }).then((r) => r.data),
  reopen: (projectId: number, id: number) => api.post<Deliverable>(`${d(projectId, id)}/reopen`).then((r) => r.data),
  downloadVersion: async (projectId: number, id: number, versionId: number, filename: string, mimeType: string) => {
    const res = await api.get(`${d(projectId, id)}/versions/${versionId}/file`, { responseType: 'blob' });
    saveBlob(res.data, mimeType, filename);
  },
  downloadZip: async (projectId: number, fallback: string) => {
    const res = await api.get(`${base(projectId)}/zip`, { responseType: 'blob' });
    saveBlob(res.data, 'application/zip', filenameFrom(res.headers['content-disposition'], fallback));
  },
};
