import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IpcChannel, WidgetApi } from '../shared/ipc';

// Preload en sandbox: solo `electron`, sin módulos locales (los imports de arriba son tipos).
function listen<T>(channel: IpcChannel, cb: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T): void => cb(value);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

function send(channel: IpcChannel, value?: unknown): void {
  ipcRenderer.send(channel, value);
}

const api: WidgetApi = {
  onModel: (cb) => listen('widget:model', cb),
  onSummary: (cb) => listen('widget:summary', cb),
  onHealth: (cb) => listen('widget:health', cb),
  openIncident: (id) => send('widget:open-incident', id),
  openServer: (id) => send('widget:open-server', id),
  openDashboard: () => send('widget:open-dashboard'),
  dismissSummary: () => send('widget:dismiss-summary'),
  closeHealth: () => send('widget:close-health'),
  setCorner: (corner) => send('widget:set-corner', corner),
  setUnfolded: (keys) => send('widget:set-unfolded', keys),
};

contextBridge.exposeInMainWorld('kubo', api);
