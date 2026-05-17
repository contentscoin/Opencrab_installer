!include LogicLib.nsh

!macro customInstall
  ReadEnvStr $0 "OPENCRAB_RUN_INSTALL_BOOTSTRAP"
  ${If} $0 == "1"
    DetailPrint "OpenCrab bootstrap: checking Docker and starting local data services..."
    ${If} ${FileExists} "$INSTDIR\resources\scripts\desktop_bootstrap.ps1"
      nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\scripts\desktop_bootstrap.ps1" -InstallDir "$INSTDIR" -Mode install'
      Pop $0
      DetailPrint "OpenCrab bootstrap finished with code $0"
      ${If} $0 != "0"
        MessageBox MB_ICONEXCLAMATION|MB_OK "OpenCrab was installed, but the local service bootstrap did not fully complete. Start OpenCrab after Docker Desktop is installed and running. Details are in %APPDATA%\opencrab-desktop\install-bootstrap.log."
      ${EndIf}
    ${Else}
      DetailPrint "OpenCrab bootstrap script was not found."
    ${EndIf}
  ${Else}
    DetailPrint "OpenCrab bootstrap deferred to first app launch for faster installation."
  ${EndIf}
!macroend
