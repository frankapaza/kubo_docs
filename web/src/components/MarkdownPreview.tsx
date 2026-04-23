import { ReactNode } from 'react';

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text))) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    if (m[1]) nodes.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2]) nodes.push(<em key={key++}>{m[2]}</em>);
    else if (m[3])
      nodes.push(
        <code key={key++} className="font-mono text-[0.85em] bg-slate-100 px-1 rounded">
          {m[3]}
        </code>,
      );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function parseTable(lines: string[]): ReactNode {
  const rows = lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
    .map((l) =>
      l
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim()),
    );
  if (rows.length < 2) return null;
  const isSeparator = (r: string[]) => r.every((c) => /^:?-+:?$/.test(c));
  const header = rows[0];
  const bodyRows = isSeparator(rows[1]) ? rows.slice(2) : rows.slice(1);
  return (
    <table className="w-full border-collapse text-sm my-3">
      <thead>
        <tr className="bg-slate-50 border-b-2 border-slate-300">
          {header.map((h, i) => (
            <th key={i} className="text-left px-3 py-2 font-semibold text-slate-700">
              {renderInline(h)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {bodyRows.map((r, ri) => (
          <tr key={ri} className="border-b border-slate-200">
            {r.map((c, ci) => (
              <td key={ci} className="px-3 py-2 align-top text-slate-700">
                {renderInline(c)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MarkdownPreview({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      out.push(
        <h1 key={key++} className="text-2xl font-bold text-slate-900 mt-6 mb-3 first:mt-0">
          {renderInline(trimmed.slice(2))}
        </h1>,
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      out.push(
        <h2 key={key++} className="text-lg font-semibold text-slate-900 mt-5 mb-2">
          {renderInline(trimmed.slice(3))}
        </h2>,
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('### ')) {
      out.push(
        <h3 key={key++} className="text-base font-semibold text-slate-900 mt-4 mb-1.5">
          {renderInline(trimmed.slice(4))}
        </h3>,
      );
      i++;
      continue;
    }
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      out.push(<hr key={key++} className="my-4 border-slate-200" />);
      i++;
      continue;
    }
    if (trimmed.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const t = parseTable(tableLines);
      if (t) out.push(<div key={key++}>{t}</div>);
      continue;
    }
    if (/^(-|\*|\+)\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^(-|\*|\+)\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^(-|\*|\+)\s+/, ''));
        i++;
      }
      out.push(
        <ul key={key++} className="list-disc pl-6 space-y-1 my-2 text-slate-700">
          {items.map((it, ix) => (
            <li key={ix}>{renderInline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      out.push(
        <ol key={key++} className="list-decimal pl-6 space-y-1 my-2 text-slate-700">
          {items.map((it, ix) => (
            <li key={ix}>{renderInline(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('|') &&
      !/^(-|\*|\+)\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    out.push(
      <p key={key++} className="my-2 text-slate-700 leading-relaxed">
        {renderInline(paraLines.join(' '))}
      </p>,
    );
  }

  return <div className="acta-preview">{out}</div>;
}
