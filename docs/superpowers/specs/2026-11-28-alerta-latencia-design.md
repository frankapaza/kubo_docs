# Alerta de latencia por hora — diseño corto

**Aprobado por el usuario:** 2026-11-28 («esta bien como mencionas y que el correo vaya a mi, quiza ponerlo administrable… frankapazac@kuboti.com», «procede con el cambio»).

## Intención

Saber, con evidencia hora a hora, cuándo la red hacia un servidor se pone lenta desde la
oficina, para reclamar al proveedor. Un pico suelto no debe molestar; una hora con varios sí.

## Decisiones (del usuario)

- Servicios «Ping (red)» (ICMP) medidos **cada minuto todo el día** (hoy: 5 min de día).
- Cada hora, por servicio ICMP y **solo desde la oficina** (sonda `OFFICE`): total de pings,
  cuántos superan el umbral del servicio (250 ms por defecto), promedio, p95 y máximo.
- **Hora lenta:** ≥ 20 % de los pings sobre el umbral (con al menos 10 pings en la hora).
- **Correo** al empezar un episodio (primera hora lenta) y al terminar (primera hora normal),
  con la tabla hora por hora lista para reenviar. Nunca uno por hora.
- Si en la misma hora están lentos **todos** los pings activos (al menos 2), el correo dice que
  probablemente es el internet de la oficina, no el proveedor.
- **Destinatarios administrables** (lista de correos); por ahora frankapazac@kuboti.com. Sin
  lista configurada, los administradores activos (como las otras alertas de monitoreo).
- Gráfico por hora en el historial del servidor: promedio y pings lentos por hora.

## Enfoques

1. **Intervalo por servicio en el núcleo de sondeo (elegido).** `ServiceTarget.intervalMin`
   opcional; la central lo manda en 1 para ICMP. El resto sigue con el horario global. Hay que
   actualizar el motor de la oficina (mismo script de instalación).
2. Bajar el horario global a 1 min: cambia también la detección de caída de oficina (franjas) y
   multiplica las pruebas HTTP; descartado.
3. Quedarse en 5 min de día (12 pings/hora): sin cambiar el motor, pero con poca resolución;
   descartado por el usuario («cada minuto»).

## Decisiones del constructor

- Evaluación a los :05 de cada hora sobre la hora anterior (da margen a lotes atrasados);
  idempotente por (servicio, hora).
- Tablas nuevas (migración 041): `monitor_latency_hours` (estadística por servicio y hora) y
  `monitor_latency_episodes` (episodio abierto/cerrado); columna
  `workspace_settings.latency_alert_emails`.
- Un motor de oficina antiguo ignora `intervalMin` (sigue cada 5 min de día): la regla de los
  10 pings mínimos evita falsos avisos con 12 muestras.
- La sonda del centro de datos no cambia (no mide lentitud).
