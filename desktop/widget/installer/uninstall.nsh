; Incluido por electron-builder (nsis.include). Al desinstalar, quita el arranque con la sesión
; que la app registró con app.setLoginItemSettings (valor = APP_ID en HKCU\...\Run).
; En una actualización (el instalador nuevo ejecuta el desinstalador viejo) se conserva: la app
; no lo vuelve a registrar (loginItemConfigured ya es true en widget-state.json).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.kubo.monitor.widget"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.kubo.monitor.widget"
  ${endIf}
!macroend
