import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { agentsApi, AgentType, ChatMessage } from '../api/agents.api';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { ArrowLeftIcon, BookOpenIcon, SendIcon, XIcon, ZapIcon } from '../components/ui/Icon';

const AGENT_META: Record<
  AgentType,
  { name: string; subtitle: string; color: string; gradient: string; Icon: typeof ZapIcon }
> = {
  agility: {
    name: 'Kubo Agile Coach',
    subtitle: 'Experto en metodologías ágiles · Scrum · Kanban · SAFe · OKRs',
    color: 'text-violet-700',
    gradient: 'from-violet-500 to-indigo-600',
    Icon: ZapIcon,
  },
  documentation: {
    name: 'Kubo Docs',
    subtitle: 'Documentación técnica · Manuales · APIs · ADR · SOPs',
    color: 'text-emerald-700',
    gradient: 'from-emerald-500 to-teal-600',
    Icon: BookOpenIcon,
  },
};

const WELCOME: Record<AgentType, string> = {
  agility:
    '¡Hola! Soy tu **Agile Coach**. Puedo ayudarte con Scrum, Kanban, SAFe, retrospectivas, historias de usuario, métricas ágiles y transformaciones organizacionales.\n\n¿En qué estás trabajando hoy?',
  documentation:
    '¡Hola! Soy **Kubo Docs**. Puedo generarte documentación técnica, manuales de usuario, READMEs, especificaciones de API, ADRs, SOPs y cualquier tipo de documentación estructurada.\n\n¿Qué necesitas documentar?',
};

export default function AgentChatPage() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const agentType = (type as AgentType) ?? 'agility';
  const meta = AGENT_META[agentType] ?? AGENT_META.agility;
  const { Icon } = meta;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setError(null);
    setLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const { reply } = await agentsApi.chat(agentType, nextMessages);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setError('No se pudo obtener respuesta. Verifica que haya un proveedor de IA activo.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex items-center gap-4 pb-4 border-b border-slate-200 flex-shrink-0">
        <button
          onClick={() => navigate('/agents')}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          title="Volver"
        >
          <ArrowLeftIcon size={18} />
        </button>
        <div
          className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center flex-shrink-0 shadow-sm`}
        >
          <Icon size={18} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-semibold text-slate-900 leading-none`}>{meta.name}</p>
          <p className="text-xs text-slate-500 mt-1 truncate">{meta.subtitle}</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            title="Limpiar conversación"
          >
            <XIcon size={16} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-6 space-y-4">
        {/* Welcome bubble */}
        <div className="flex gap-3">
          <div
            className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm`}
          >
            <Icon size={14} className="text-white" />
          </div>
          <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white border border-slate-200 px-4 py-3 shadow-sm">
            <div className="text-sm text-slate-700 leading-relaxed prose-sm">
              <MarkdownPreview source={WELCOME[agentType]} />
            </div>
          </div>
        </div>

        {messages.map((msg, i) =>
          msg.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-kubo-primary text-white px-4 py-3 shadow-sm">
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <div
                className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm`}
              >
                <Icon size={14} className="text-white" />
              </div>
              <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white border border-slate-200 px-4 py-3 shadow-sm">
                <div className="text-sm text-slate-700 leading-relaxed">
                  <MarkdownPreview source={msg.content} />
                </div>
              </div>
            </div>
          ),
        )}

        {loading && (
          <div className="flex gap-3">
            <div
              className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm`}
            >
              <Icon size={14} className="text-white" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-white border border-slate-200 px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center h-5">
                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
              {error}
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={send}
        className="flex-shrink-0 border-t border-slate-200 pt-4 flex gap-3 items-end"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Escribe tu mensaje… (Enter para enviar, Shift+Enter para nueva línea)"
          className="flex-1 resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-kubo-primary focus:border-transparent placeholder:text-slate-400"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="w-11 h-11 rounded-xl bg-kubo-primary text-white flex items-center justify-center hover:bg-kubo-primary-dark transition disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          <SendIcon size={16} />
        </button>
      </form>
    </div>
  );
}
