import type { WorkItemRequestType } from '../../api/types';
import { REQUEST_TEMPLATES, TemplateAnswers } from './requirement-template';

const fieldStyle: React.CSSProperties = {
  fontSize: 13, padding: '8px 10px', border: '1px solid #dfe3e4', borderRadius: 6, width: '100%',
  boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical',
};

interface Props {
  type: WorkItemRequestType;
  onTypeChange: (t: WorkItemRequestType) => void;
  answers: TemplateAnswers;
  onAnswersChange: (a: TemplateAnswers) => void;
  criteria: string;
  onCriteriaChange: (v: string) => void;
  disabled?: boolean;
}

/**
 * El formulario guiado: tipo de pedido, sus secciones y los criterios de
 * aceptación. Lo usan el alta del portal y la de DevDocs.
 */
export default function RequirementTemplateFields({
  type, onTypeChange, answers, onAnswersChange, criteria, onCriteriaChange, disabled,
}: Props) {
  const tpl = REQUEST_TEMPLATES[type];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Tipo de pedido</legend>
        {Object.values(REQUEST_TEMPLATES).map((t) => {
          const active = t.type === type;
          return (
            <button
              key={t.type}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onTypeChange(t.type)}
              style={{
                flex: '1 1 200px', textAlign: 'left', padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${active ? '#15191a' : '#dfe3e4'}`, background: active ? '#f4f7f7' : '#fff',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
              <div style={{ fontSize: 11, color: '#6d7577', marginTop: 2 }}>{t.description}</div>
            </button>
          );
        })}
      </fieldset>

      {tpl.sections.map((s) => (
        <label key={`${type}-${s.key}`} htmlFor={`rq-${type}-${s.key}`}>
          <span style={{ fontSize: 12, fontWeight: 600, display: 'block' }}>
            {s.title}
            {s.required ? ' *' : <span style={{ fontWeight: 400, color: '#6d7577' }}> (opcional)</span>}
          </span>
          <span style={{ fontSize: 11, color: '#6d7577', display: 'block', margin: '2px 0 5px' }}>{s.hint}</span>
          <textarea
            id={`rq-${type}-${s.key}`}
            rows={s.rows ?? 3}
            disabled={disabled}
            value={answers[s.key] ?? ''}
            onChange={(e) => onAnswersChange({ ...answers, [s.key]: e.target.value })}
            placeholder={s.placeholder}
            style={fieldStyle}
          />
        </label>
      ))}

      <label htmlFor={`rq-${type}-criterios`}>
        <span style={{ fontSize: 12, fontWeight: 600, display: 'block' }}>
          Cómo sabremos que está bien <span style={{ fontWeight: 400, color: '#6d7577' }}>(opcional)</span>
        </span>
        <span style={{ fontSize: 11, color: '#6d7577', display: 'block', margin: '2px 0 5px' }}>
          Criterios de aceptación: uno por línea.
        </span>
        <textarea
          id={`rq-${type}-criterios`}
          rows={3}
          disabled={disabled}
          value={criteria}
          onChange={(e) => onCriteriaChange(e.target.value)}
          placeholder={'Ej.: El reporte muestra el monto del compromiso\nEl total coincide con la suma de los compromisos'}
          style={fieldStyle}
        />
      </label>
    </div>
  );
}
