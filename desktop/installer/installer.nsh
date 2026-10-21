; Pharmacy CRM installer additions (electron-builder NSIS include).
;
; Pharmacy data lives in %PROGRAMDATA%\PharmacyCRM, outside the program folder, so uninstalling the program
; keeps it and reinstalling starts as before (architecture, section 2.4). The uninstaller asks whether to
; delete the data too, and separately the backups. Updates run the old uninstaller silently: they never
; delete data. Scripted uninstalls can pass /DELETEDATA (and with it /DELETEBACKUPS) instead of ticking
; the boxes. PCRM_DATA_DIR moves the data folder, as it does for the app (used by tests).

!include nsDialogs.nsh
!include LogicLib.nsh

; electron-builder compiles the uninstaller in a pass of its own; outside it, uninstaller code would only
; raise warnings (and warnings fail the build)
!ifdef BUILD_UNINSTALLER

Var pcrmDeleteData
Var pcrmDeleteBackups
Var pcrmDataBox
Var pcrmBackupsBox
Var pcrmDataRoot

!macro customUnInit
  ReadEnvStr $pcrmDataRoot PCRM_DATA_DIR
  ${If} $pcrmDataRoot == ""
    ReadEnvStr $pcrmDataRoot PROGRAMDATA
    StrCpy $pcrmDataRoot "$pcrmDataRoot\PharmacyCRM"
  ${EndIf}
  StrCpy $pcrmDeleteData ${BST_UNCHECKED}
  StrCpy $pcrmDeleteBackups ${BST_UNCHECKED}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/DELETEDATA" $R1
  ${IfNot} ${Errors}
    StrCpy $pcrmDeleteData ${BST_CHECKED}
    ClearErrors
    ${GetOptions} $R0 "/DELETEBACKUPS" $R1
    ${IfNot} ${Errors}
      StrCpy $pcrmDeleteBackups ${BST_CHECKED}
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.pcrmDataPage un.pcrmDataPageLeave
!macroend

Function un.pcrmDataPage
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 40u "All pharmacy data (sales, stock, purchases, accounts) and its backups are kept in $pcrmDataRoot. If you keep it, installing Pharmacy CRM again brings everything back."
  Pop $0
  ${NSD_CreateCheckbox} 0 48u 100% 12u "Also delete all pharmacy data on this computer"
  Pop $pcrmDataBox
  ${NSD_CreateCheckbox} 12u 64u 100% 12u "Also delete the backups"
  Pop $pcrmBackupsBox
  EnableWindow $pcrmBackupsBox 0
  ${NSD_OnClick} $pcrmDataBox un.pcrmToggleBackups
  nsDialogs::Show
FunctionEnd

Function un.pcrmToggleBackups
  ${NSD_GetState} $pcrmDataBox $0
  ${If} $0 == ${BST_CHECKED}
    EnableWindow $pcrmBackupsBox 1
  ${Else}
    ${NSD_Uncheck} $pcrmBackupsBox
    EnableWindow $pcrmBackupsBox 0
  ${EndIf}
FunctionEnd

Function un.pcrmDataPageLeave
  ${NSD_GetState} $pcrmDataBox $pcrmDeleteData
  ${NSD_GetState} $pcrmBackupsBox $pcrmDeleteBackups
  ${If} $pcrmDeleteData == ${BST_CHECKED}
    ${If} $pcrmDeleteBackups == ${BST_CHECKED}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "This permanently deletes all pharmacy data AND its backups from this computer. It cannot be undone. Continue?" IDYES +2
      Abort
    ${Else}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "This permanently deletes all pharmacy data from this computer. The backups are kept and can be restored with the recovery key. Continue?" IDYES +2
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

!endif

; Start menu: recovering the Developer account (new password, two-factor sign-in set up again). The app
; asks Windows for an administrator first (desktop/src/recover-owner.mjs).
!define PCRM_RECOVER_LINK "$SMPROGRAMS\Recover Pharmacy CRM Developer account.lnk"

!macro customInstall
  CreateShortCut "${PCRM_RECOVER_LINK}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--recover-owner" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  ; The app may have been closed by force, which leaves PostgreSQL running and its files in use. Stop it
  ; cleanly before anything is removed.
  IfFileExists "$pcrmDataRoot\data\postmaster.pid" 0 +2
    nsExec::Exec '"$INSTDIR\resources\postgres\bin\pg_ctl.exe" stop -D "$pcrmDataRoot\data" -m fast -w -t 60'

  ${ifNot} ${isUpdated}
    Delete "${PCRM_RECOVER_LINK}"
    ${If} $pcrmDeleteData == ${BST_CHECKED}
      RMDir /r "$pcrmDataRoot\data"
      RMDir /r "$pcrmDataRoot\logs"
      RMDir /r "$pcrmDataRoot\tmp"
      Delete "$pcrmDataRoot\keys.json"
      Delete "$pcrmDataRoot\config.json"
      ; the key that protects keys.json lives in the app's own Windows profile folder
      RMDir /r "$APPDATA\${PRODUCT_NAME}"
      ${If} $pcrmDeleteBackups == ${BST_CHECKED}
        RMDir /r "$pcrmDataRoot"
      ${EndIf}
    ${EndIf}
  ${endIf}
!macroend
