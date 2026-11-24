# KUBO Monitor — widget

Widget de escritorio (Electron + React) que habla solo con el motor local por `127.0.0.1`
(`/v1/status`, `/v1/events`) con la cabecera `X-Kubo-Secret` leída de
`%ProgramData%\KUBO\Monitor\local-api.secret` (`KUBO_MONITOR_HOME` la sustituye).

- `src/shared/types.ts`: tipos copiados a mano del motor (no se importa del motor).
- `src/shared/widget-model.ts`: modelo de pantalla puro (`deriveModel`).
- `src/main/engine-client.ts`: cliente del motor (`EngineClient`).

Pruebas: `npm test`. Tipos: `npx tsc -p tsconfig.json --noEmit`.
