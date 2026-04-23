import { useNavigate } from 'react-router-dom';
import { BookOpenIcon, BotIcon, ZapIcon } from '../components/ui/Icon';

const agents = [
  {
    type: 'agility',
    name: 'Kubo Agile Coach',
    description:
      'Experto en metodologías ágiles para software, salud, manufactura, finanzas y más. Te ayuda con Scrum, Kanban, SAFe, retrospectivas, historias de usuario, OKRs y transformaciones organizacionales.',
    icon: ZapIcon,
    color: 'from-violet-500 to-indigo-600',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    badge: 'text-violet-700 bg-violet-100',
    tags: ['Scrum', 'Kanban', 'SAFe', 'OKRs', 'Retrospectivas'],
  },
  {
    type: 'documentation',
    name: 'Kubo Docs',
    description:
      'Especialista en documentación técnica y manuales de usuario. Genera READMEs, especificaciones de API, ADRs, SOPs, guías de usuario y cualquier tipo de documentación estructurada.',
    icon: BookOpenIcon,
    color: 'from-emerald-500 to-teal-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    badge: 'text-emerald-700 bg-emerald-100',
    tags: ['APIs', 'Manuales', 'ADR', 'README', 'SOPs'],
  },
];

export default function AgentsPage() {
  const navigate = useNavigate();

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-kubo-primary to-indigo-600 flex items-center justify-center">
            <BotIcon size={18} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Agentes IA</h1>
        </div>
        <p className="text-slate-500 ml-12">
          Asistentes especializados para potenciar tu trabajo con IA conversacional.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {agents.map((agent) => {
          const Icon = agent.icon;
          return (
            <button
              key={agent.type}
              onClick={() => navigate(`/agents/${agent.type}`)}
              className={`text-left rounded-2xl border ${agent.border} ${agent.bg} p-6 hover:shadow-md transition-all hover:-translate-y-0.5 group`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${agent.color} flex items-center justify-center flex-shrink-0 shadow-sm`}
                >
                  <Icon size={22} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-slate-900 text-lg leading-tight group-hover:text-kubo-primary transition-colors">
                    {agent.name}
                  </h2>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                    {agent.description}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {agent.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${agent.badge}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
