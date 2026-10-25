; Prefrontal Windows installer hooks (electron-builder nsis.include).
;
; Updating normally runs the OLD version's uninstaller first. On some lab PCs that
; step keeps failing, and after 5 tries electron-builder shows the misleading
; "Prefrontal cannot be closed" box and stops (seen on the Arun Lab PC, 24 Oct 2026,
; with Prefrontal not running). Skip that step: hide the old UninstallString so the
; installer finds nothing to uninstall and overwrites the program files in place.
; App data (%APPDATA%\Prefrontal — analyzer pairing, queues) is never touched, and
; the new install writes a fresh uninstall entry. The running-app check still runs.
!macro customInit
  DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
  !endif
!macroend
