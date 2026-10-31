; Titan POS installer hooks (electron-builder nsis.include).
;
; Up to 1.0.52 the hub kept its cloud link in <install dir>\data, and an update runs the old
; version's uninstaller, which deletes the install directory. Before that happens, copy the folder
; into the user's app data (<userData>\install-data-migration). On its next start the hub adopts it
; only for a store its database holds, and never over a link it already has
; (apps/electron/src/hubConfig.ts). Copying changes nothing else; if it fails the hub opens
; activation, as before.

!macro customInit
  Push $0
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\data\cloud-config.json"
    SetShellVarContext current
    CreateDirectory "$APPDATA\${APP_PACKAGE_NAME}\install-data-migration"
    CopyFiles /SILENT "$0\data\*.json" "$APPDATA\${APP_PACKAGE_NAME}\install-data-migration"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
  ClearErrors
  Pop $0
!macroend
