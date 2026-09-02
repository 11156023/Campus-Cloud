!macro customInstall
  IfFileExists "$PROGRAMFILES64\WireGuard\wireguard.exe" wireguard_done

  DetailPrint "Installing WireGuard for Windows prerequisite..."
  File /oname=$PLUGINSDIR\wireguard-amd64-1.1.msi "${PROJECT_DIR}\vendor\wireguard\wireguard-amd64-1.1.msi"
  ExecWait '"$SYSDIR\msiexec.exe" /i "$PLUGINSDIR\wireguard-amd64-1.1.msi" /qn /norestart DO_NOT_LAUNCH=1' $0
  ${If} $0 != 0
    ${If} $0 != 3010
      MessageBox MB_ICONSTOP "WireGuard installation failed (code $0). SkyLab Connect was not installed."
      Abort
    ${EndIf}
  ${EndIf}

  wireguard_done:
!macroend
