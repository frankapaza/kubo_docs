export interface ActaDraftJson {
  resumen: string;
  agenda: string[];
  desarrollo: string;
  acuerdos: string[];
  tareas: Array<{
    responsable: string;
    descripcion: string;
    fechaLimite: string | null;
  }>;
}

export type LLMMeetingType =
  | 'GENERIC'
  | 'DAILY'
  | 'RETROSPECTIVE'
  | 'SPRINT_PLANNING'
  | 'SPRINT_REVIEW'
  | 'POSTMORTEM'
  | 'DISCOVERY';

export interface LLMContext {
  projectName: string;
  meetingTitle: string;
  meetingType: LLMMeetingType;
  scheduledAt: string;
  location: string | null;
  participants: Array<{ fullName: string; role: string | null; attended: boolean }>;
  agenda: Array<{ title: string; description: string | null }>;
  transcription: string;
}

export interface LLMCallConfig {
  apiKey: string;
  model: string;
  baseUrl?: string | null;
  temperature: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BacklogTask {
  title: string;
  assignee: string | null;
}

export interface BacklogStory {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: 'Alta' | 'Media' | 'Baja';
  storyPoints: number | null;
  assignee: string | null;
  tasks: BacklogTask[];
}

export interface BacklogEpic {
  title: string;
  description: string;
  stories: BacklogStory[];
}

export interface BacklogResult {
  epics: BacklogEpic[];
}
