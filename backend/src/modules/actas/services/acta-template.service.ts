import { Injectable } from '@nestjs/common';
import { Meeting } from '../../meetings/entities/meeting.entity';
import { Participant } from '../../participants/entities/participant.entity';
import { AgendaItem } from '../../agenda/entities/agenda-item.entity';
import { ActaDraftJson } from '../../ai/llm.types';

@Injectable()
export class ActaTemplateService {
  renderFromAI(input: {
    meeting: Meeting;
    participants: Participant[];
    draft: ActaDraftJson;
  }): string {
    const { meeting, participants, draft } = input;
    const lines: string[] = [];
    lines.push(`# Acta de reunión — ${meeting.title}`);
    lines.push('');
    lines.push(
      `**Fecha:** ${meeting.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')}`,
    );
    if (meeting.location) lines.push(`**Ubicación:** ${meeting.location}`);
    lines.push('');

    lines.push('## Resumen ejecutivo');
    lines.push(draft.resumen || '_Sin resumen generado._');
    lines.push('');

    lines.push('## Participantes');
    if (participants.length === 0) {
      lines.push('_Sin participantes registrados._');
    } else {
      participants.forEach((p) => {
        const mark = p.attended ? 'Asistió' : 'Ausente';
        const extras = [p.role, p.documentNumber ? `DNI: ${p.documentNumber}` : null]
          .filter(Boolean)
          .join(' · ');
        lines.push(`- **${p.fullName}** — ${mark}${extras ? ` (${extras})` : ''}`);
      });
    }
    lines.push('');

    lines.push('## Agenda tratada');
    if (draft.agenda.length === 0) lines.push('_Sin agenda._');
    else draft.agenda.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
    lines.push('');

    lines.push('## Desarrollo de la reunión');
    lines.push(draft.desarrollo || '_Sin desarrollo._');
    lines.push('');

    lines.push('## Acuerdos');
    if (draft.acuerdos.length === 0) lines.push('_Sin acuerdos._');
    else draft.acuerdos.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
    lines.push('');

    lines.push('## Tareas y compromisos');
    if (draft.tareas.length === 0) {
      lines.push('_Sin tareas asignadas._');
    } else {
      lines.push('| # | Responsable | Compromiso | Fecha límite |');
      lines.push('|---|-------------|------------|--------------|');
      draft.tareas.forEach((t, i) => {
        lines.push(
          `| ${i + 1} | ${t.responsable || '—'} | ${t.descripcion} | ${t.fechaLimite ?? '—'} |`,
        );
      });
    }
    lines.push('');

    return lines.join('\n');
  }

  render(input: {
    meeting: Meeting;
    participants: Participant[];
    agenda: AgendaItem[];
    transcriptionText: string | null;
  }): string {
    const { meeting, participants, agenda, transcriptionText } = input;

    const lines: string[] = [];
    lines.push(`# Acta — ${meeting.title}`);
    lines.push('');
    lines.push(`**Fecha:** ${meeting.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')}`);
    if (meeting.location) lines.push(`**Ubicación:** ${meeting.location}`);
    lines.push('');

    lines.push('## Participantes');
    if (participants.length === 0) {
      lines.push('_Sin participantes registrados._');
    } else {
      participants.forEach((p) => {
        const mark = p.attended ? '✔' : '·';
        lines.push(`- ${mark} ${p.fullName}${p.role ? ` — ${p.role}` : ''}`);
      });
    }
    lines.push('');

    lines.push('## Agenda');
    if (agenda.length === 0) {
      lines.push('_Sin ítems de agenda._');
    } else {
      agenda.forEach((a, i) => {
        lines.push(`${i + 1}. **${a.title}**${a.description ? ` — ${a.description}` : ''}`);
      });
    }
    lines.push('');

    lines.push('## Desarrollo');
    lines.push(transcriptionText ?? '_Transcripción pendiente._');
    lines.push('');

    lines.push('## Acuerdos');
    lines.push('_Agregar acuerdos._');
    lines.push('');
    lines.push('## Compromisos');
    lines.push('_Agregar compromisos con responsable y fecha._');
    lines.push('');

    return lines.join('\n');
  }
}
