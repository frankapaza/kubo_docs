import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WidgetStore } from '../src/main/store';

describe('WidgetStore', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'kubo-store-'));

  it('uses defaults when the file is missing', () => {
    const s = new WidgetStore(dir());
    expect([s.cursor, s.corner, s.lastSeenAt]).toEqual([0, 'bottom-right', null]);
  });

  it('persists values across instances without leaving temp files', () => {
    const d = dir();
    const s = new WidgetStore(d);
    s.cursor = 12;
    s.corner = 'top-left';
    s.lastSeenAt = '2026-11-24T15:00:00Z';
    const r = new WidgetStore(d);
    expect([r.cursor, r.corner, r.lastSeenAt]).toEqual([12, 'top-left', '2026-11-24T15:00:00Z']);
    expect(readdirSync(d)).toEqual(['widget-state.json']);
  });

  it('falls back to defaults on corrupt or invalid content', () => {
    const d = dir();
    writeFileSync(join(d, 'widget-state.json'), '{not json');
    expect(new WidgetStore(d).cursor).toBe(0);
    writeFileSync(join(d, 'widget-state.json'), JSON.stringify({ cursor: -4, corner: 'middle', lastSeenAt: 5 }));
    const s = new WidgetStore(d);
    expect([s.cursor, s.corner, s.lastSeenAt]).toEqual([0, 'bottom-right', null]);
    s.cursor = 2;
    expect(JSON.parse(readFileSync(join(d, 'widget-state.json'), 'utf8')).cursor).toBe(2);
  });
});
