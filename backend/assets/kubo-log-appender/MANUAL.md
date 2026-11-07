# Kubo Log4Net: manual de implementación

Este manual explica cómo agregar el appender de Kubo a un aplicativo .NET que **ya usa log4net**, para que sus logs lleguen a DevDocs (Monitoreo → Logs) y los errores se agrupen y puedan convertirse en tickets.

Sirve para aplicativos .NET Framework 4.5 a 4.8 con log4net 2.0.8 a 2.0.12 o 3.2.0, configurados con `XmlConfigurator` y un `log4net.config` aparte. También sirve para .NET 5 o posterior (ver paso 3).

## 1. Qué es y qué no cambia

`Kubo.Log4Net.dll` es un appender más de log4net. Se agrega al `log4net.config` **junto a los que ya existen**:

- El archivo local de logs (`RollingFileAppender` u otro) **sigue funcionando igual**. No se quita nada.
- No hay que cambiar código del aplicativo: solo se copia una DLL y se edita el `log4net.config`.
- El appender **nunca bloquea ni tumba al aplicativo**: guarda los eventos en una cola en memoria y los envía en segundo plano, en lotes comprimidos. Si no hay red o DevDocs no responde, reintenta con espera creciente; si la cola se llena (10 000 eventos por omisión), descarta los más viejos y avisa a DevDocs cuántos descartó.
- No tiene dependencias externas: es una sola DLL.

## 2. Pedir la clave en DevDocs

1. Entra a DevDocs → **Monitoreo → Instalaciones** (requiere rol de administrador).
2. Crea la instalación (o abre la existente) y genera su clave.
3. **Copia la clave en ese momento: se muestra una sola vez.** Tiene la forma `klog_` seguido de 43 caracteres. Si se pierde, hay que regenerarla (la anterior deja de funcionar).
4. La URL de recepción es `https://docs.kuboti.com/api/v1/ingest/logs`; la pantalla de Instalaciones muestra la misma.

Cada instalación (un servidor o un cliente) tiene su propia clave. La clave identifica al cliente y al sistema: no hay que configurarlos aparte.

## 3. Elegir la variante de la DLL

El paquete trae tres variantes. Elige según la versión de log4net que usa el aplicativo:

| El aplicativo usa | Carpeta del paquete |
|---|---|
| log4net 2.0.x (2.0.8 a 2.0.12) | `log4net-2.x/net45` |
| log4net 3.x en .NET Framework 4.6.2 a 4.8 | `log4net-3.x/net462` |
| .NET 5 o posterior (log4net 3.x) | `log4net-3.x/netstandard2.0` |

### Cómo saber qué versión de log4net usa el aplicativo

Prueba en este orden:

1. **Archivo `.csproj`**: busca `<PackageReference Include="log4net" Version="...">`.
2. **`packages.config`** (proyectos antiguos): busca `<package id="log4net" version="..." ...>`.
3. **Referencia directa a una DLL** (por ejemplo `library\log4net.dll`): en el `.csproj` busca `<Reference Include="log4net, Version=...">` y su `<HintPath>`. La versión que figura en `Version=` puede no coincidir con la real.
4. **La DLL desplegada**: clic derecho sobre `bin\log4net.dll` → Propiedades → pestaña **Detalles** → **Versión del producto** (o *Versión del archivo*). Es el dato más fiable.

Para ver la versión de .NET Framework: en el `.csproj`, `<TargetFrameworkVersion>v4.6.1</TargetFrameworkVersion>` o `<TargetFramework>`. Con log4net 3.x en .NET Framework 4.6.1 o menor no hay variante: actualiza el aplicativo a 4.6.2 o superior, o usa log4net 2.x.

## 4. Copiar la DLL a `bin`

Copia **solo** `Kubo.Log4Net.dll` de la carpeta elegida al directorio donde está el ejecutable del aplicativo (junto a `log4net.dll`):

- Aplicativo web: la carpeta `bin` del sitio.
- Servicio o aplicación de escritorio: la carpeta del `.exe`.

Si el aplicativo se compila desde Visual Studio, agrégala como referencia (con *Copiar localmente* en Sí) para que viaje en cada publicación.

## 5. Editar `log4net.config`

Dentro de `<log4net>`, agrega este appender (el mismo está en `ejemplo-log4net.config`):

```xml
<appender name="kubo" type="Kubo.Log4Net.KuboLogAppender, Kubo.Log4Net">
  <!-- Obligatorios: sin alguno de los tres el appender queda inactivo y lo avisa en LogLog. -->
  <url value="https://docs.kuboti.com/api/v1/ingest/logs" />
  <apiKey value="klog_PEGA_AQUI_LA_CLAVE_DE_LA_INSTALACION" />
  <aplicativo value="NombreDelAplicativo" />

  <!-- Opcionales (se muestran los valores por omisión). -->
  <batchSize value="200" />
  <flushIntervalMs value="2000" />
  <maxQueueSize value="10000" />
  <timeoutMs value="5000" />
  <!-- <proxy value="http://proxy.empresa.local:8080" /> -->

  <!-- Nivel mínimo que se envía. DevDocs además aplica el mínimo de la instalación (INFO por omisión). -->
  <threshold value="INFO" />
</appender>
```

Y en `<root>`, agrega la referencia **junto a las que ya hay** (no reemplaces las existentes):

```xml
<root>
  <level value="INFO" />
  <appender-ref ref="RollingFile" />   <!-- ya existía: se queda -->
  <appender-ref ref="kubo" />          <!-- nueva -->
</root>
```

| Parámetro | Obligatorio | Por omisión | Qué es |
|---|---|---|---|
| `url` | Sí | | URL de recepción: `https://docs.kuboti.com/api/v1/ingest/logs` (la pantalla de Instalaciones muestra la misma). |
| `apiKey` | Sí | | Clave de la instalación (paso 2). |
| `aplicativo` | Sí | | Nombre del aplicativo tal como quieres verlo en DevDocs (se recorta a 100 caracteres). |
| `threshold` | No | todos | Nivel mínimo que este appender envía. Se recomienda `INFO`. |
| `batchSize` | No | 200 | Eventos por envío. El máximo es 1000: si pones más, el appender lo recorta a 1000 y lo avisa en `LogLog`. |
| `flushIntervalMs` | No | 2000 | Cada cuántos milisegundos se envía lo pendiente. |
| `maxQueueSize` | No | 10000 | Eventos que se guardan en memoria esperando envío. |
| `timeoutMs` | No | 5000 | Espera máxima por cada envío. |
| `proxy` | No | proxy del sistema | URL del proxy de salida, si la red del cliente lo exige. |

Notas:

- Un valor de `batchSize`, `flushIntervalMs`, `maxQueueSize` o `timeoutMs` igual o menor que cero se ignora y se usa el valor por omisión (queda un aviso en `LogLog`).
- Si falta `url`, `apiKey` o `aplicativo`, el appender queda **inactivo**: el aplicativo sigue funcionando normal y el motivo queda en la salida interna de log4net (paso 9).
- Si el aplicativo configura log4net con `XmlConfigurator.ConfigureAndWatch`, el cambio se toma sin reiniciar; con `XmlConfigurator.Configure` hay que reiniciar el aplicativo.

## 6. `bindingRedirect` (solo .NET Framework)

La DLL de la variante `net45` se compiló contra log4net **2.0.8**, y la de `net462` contra log4net **3.2.0**. Si el aplicativo usa **otra** versión (por ejemplo 2.0.12 con la variante `net45`), .NET Framework no encuentra la versión exacta y falla al cargar el appender. Se resuelve con un `bindingRedirect` en el `app.config` (aplicaciones de escritorio o servicios) o `web.config` (aplicativos web), dentro de `<configuration>`:

```xml
<configuration>
  <runtime>
    <assemblyBinding xmlns="urn:schemas-microsoft-com:asm.v1">
      <dependentAssembly>
        <assemblyIdentity name="log4net" publicKeyToken="669e0ddf0bb1aa2a" culture="neutral" />
        <bindingRedirect oldVersion="0.0.0.0-2.0.12.0" newVersion="2.0.12.0" />
      </dependentAssembly>
    </assemblyBinding>
  </runtime>
</configuration>
```

Ajusta `newVersion` a **la versión real de log4net del aplicativo** (paso 3) y el límite superior de `oldVersion` a la misma versión. Por ejemplo, para log4net 2.0.10 serían `0.0.0.0-2.0.10.0` y `2.0.10.0`.

- Con la variante `net462` o `netstandard2.0` (compiladas contra 3.2.0) y un aplicativo con otra 3.x, el redirect es `0.0.0.0-3.x.y.0` → `3.x.y.0` (la versión real, por ejemplo `3.0.4.0`).
- **No hace falta** si el aplicativo usa justo log4net 2.0.8 con la variante `net45`, o 3.2.0 con la variante `net462`.
- Si el aplicativo ya tiene un `<dependentAssembly>` de `log4net`, **no lo dupliques**: confirma que `newVersion` es la versión que realmente se despliega.
- En .NET 5 o posterior no se usa `bindingRedirect`.

## 7. Instalaciones compartidas (varios clientes en un mismo servidor)

Cuando una misma instalación atiende a varios clientes, puedes marcar cada evento con el RUC del cliente para filtrarlo después en DevDocs. En el código del aplicativo, al inicio de cada solicitud:

```csharp
log4net.ThreadContext.Properties["kubo:ruc"] = ruc;
```

En código asíncrono (`async`/`await`), el contexto del hilo se pierde al cambiar de hilo; usa en su lugar:

```csharp
log4net.LogicalThreadContext.Properties["kubo:ruc"] = ruc;
```

Todas las propiedades del contexto de log4net (hasta 50 por evento) viajan con el evento. La propiedad `kubo:ruc` solo se usa en las instalaciones internas; en las de cliente se ignora.

## 8. Publicar y verificar

1. Publica el aplicativo con la DLL y el `log4net.config` nuevos.
2. Genera algún movimiento que registre un log de nivel `INFO` o superior.
3. En DevDocs, abre **Monitoreo → Logs** y filtra por el nombre del aplicativo: deben aparecer los eventos en unos segundos.
4. En **Monitoreo → Instalaciones** comprueba que la instalación muestra la hora del **último envío**.

Si los eventos de nivel `WARN` o `ERROR` llegan pero los `DEBUG` no, es normal: el nivel mínimo es `INFO`, tanto en el `threshold` del appender como en la configuración de la instalación.

## 9. Solución de problemas

### No llega nada

log4net no muestra sus propios errores a menos que se le pida. Activa su depuración interna en el `app.config` o `web.config`:

```xml
<configuration>
  <appSettings>
    <add key="log4net.Internal.Debug" value="true" />
  </appSettings>
</configuration>
```

Y agrega un escuchador para ver la salida en un archivo (dentro de `<configuration>`):

```xml
<system.diagnostics>
  <trace autoflush="true">
    <listeners>
      <add name="log4netInterno" type="System.Diagnostics.TextWriterTraceListener" initializeData="C:\Temp\log4net-interno.txt" />
    </listeners>
  </trace>
</system.diagnostics>
```

Reinicia el aplicativo y revisa `log4net-interno.txt`: los mensajes del appender empiezan por `Kubo:`. Cuando termines, quita ambas cosas. Qué significa cada aviso:

| Aviso en `LogLog` | Causa probable |
|---|---|
| `faltan parámetros obligatorios (Url, ApiKey y Aplicativo)` | Falta uno de los tres parámetros o está mal escrito el nombre del elemento. |
| `401` (se reintenta cada 5 minutos) | La clave es inválida, está mal copiada o fue **revocada o regenerada** en DevDocs. Copia la clave vigente y reinicia. |
| `403` | La URL apunta a un servicio que rechaza la petición (firewall, WAF o proxy intermedio). |
| `404` | La URL está mal escrita: debe terminar en `/api/v1/ingest/logs`. |
| `407` | El proxy exige autenticación. Pide al área de redes del cliente que habilite la salida hacia DevDocs. |
| Errores de conexión o de tiempo de espera | Sin salida a internet hacia DevDocs, DNS o certificado: ver **TLS** y **Proxy**. |

### No se carga el appender (`FileLoadException`, `Could not load file or assembly 'log4net'`)

Falta el `bindingRedirect` del paso 6, o se eligió la variante equivocada del paso 3.

### TLS

El appender suma TLS 1.2 a los protocolos activos del aplicativo sin quitar ninguno. En Windows Server 2008 R2 o equivalentes, el sistema operativo debe tener TLS 1.2 habilitado; en .NET Framework 4.5 puede hacer falta activarlo en el registro de Windows. Si la conexión falla solo desde ese servidor, es la causa más probable.

### Proxy

Si el servidor sale a internet por proxy y el proxy por omisión del sistema no basta, indícalo en el appender:

```xml
<proxy value="http://proxy.empresa.local:8080" />
```

### Clave revocada

Si en DevDocs se revocó o regeneró la clave, los envíos reciben `401`: el appender lo avisa en `LogLog` y reintenta cada 5 minutos. En cuanto actualices la clave en el `log4net.config` y se tome el cambio (o reinicies el aplicativo), los envíos se reanudan.

### Nivel mínimo de la instalación

Cada instalación tiene un nivel mínimo en DevDocs (`INFO` por omisión). Los eventos de nivel menor se descartan en el servidor aunque el appender los envíe. Si necesitas `DEBUG` para investigar algo, súbelo temporalmente en **Monitoreo → Instalaciones** y baja el `threshold` del appender; luego vuelve a `INFO`, porque el volumen de `DEBUG` es alto.

### Ya llegan logs, pero faltan los de un momento

Si el aplicativo estuvo sin red, los eventos se guardan en memoria hasta 10 000; al llenarse se descartan los más viejos. DevDocs recibe la cuenta de los descartados en el siguiente envío. Los eventos que seguían en cola cuando el proceso se cerró de golpe (sin cierre ordenado) se pierden: el archivo local sigue teniendo todo.

## 10. Recomendación de seguridad: retirar las credenciales del `SmtpAppender`

Si el `log4net.config` del aplicativo tiene un `SmtpAppender` (envío de errores por correo), **revisa si contiene el usuario y la contraseña del servidor de correo en texto plano**. Es común en aplicativos antiguos y es un riesgo: quien tenga acceso al archivo (repositorio, copias de seguridad, cualquier persona con acceso al servidor) tiene esa cuenta de correo.

Lo recomendable:

1. **Rotar la contraseña** de esa cuenta de correo, porque ya debe darse por conocida.
2. **Retirar el `SmtpAppender`** (y su `<appender-ref>`): con el appender de Kubo, los errores quedan agrupados en DevDocs, con alertas y tickets, y ya no hace falta el correo.
3. Si por ahora debe mantenerse, no dejar la contraseña en el `log4net.config` ni en el control de versiones: moverla a un secreto del servidor y usar una cuenta de correo exclusiva y con permisos mínimos.
4. Revisar el historial del repositorio: una contraseña ya subida sigue ahí aunque se borre del archivo actual.

Nunca pegues claves ni contraseñas reales en tickets, correos ni capturas de pantalla.
