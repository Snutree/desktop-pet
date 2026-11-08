; Custom NSIS tweaks for LingX
;  - 升级：检测已安装的旧版本并提示覆盖升级（数据保存在 %APPDATA%，覆盖安装不会删除）
;  - 卸载：清理 electron-builder 可能残留的空安装目录（只删空目录，不动用户文件）
!include "LogicLib.nsh"

; 安装开始前（initMultiUser 之后）检测旧版本。
; 非静默安装时给用户确认；静默安装直接继续。
!macro customInit
  ReadRegStr $R0 HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ${If} $R0 == ""
    ReadRegStr $R0 HKLM "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
  ${EndIf}

  ${If} $R0 != ""
    ; 旧安装目录（可能为空；不强制改安装路径，交给 electron-builder 处理）
    StrCpy $R1 ""
    ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R1 == ""
      ReadRegStr $R1 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}

    ${If} ${Silent}
      DetailPrint "检测到已安装灵犀 $R0，将覆盖升级到 ${VERSION}（保留用户数据）"
    ${Else}
      StrCpy $R2 ""
      ${If} $R1 != ""
        StrCpy $R2 "$\r$\n安装目录：$R1"
      ${EndIf}
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "检测到已安装灵犀 $R0。$R2$\r$\n$\r$\n将覆盖升级到 ${VERSION}，并保留剪贴板、密码本和配置数据。$\r$\n（安装包不会删除 %APPDATA% 下的数据）$\r$\n$\r$\n继续安装？" IDOK LingXUpgradeContinue
      Quit
      LingXUpgradeContinue:
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  SetOutPath "$TEMP"
  RMDir "$INSTDIR"
!macroend
