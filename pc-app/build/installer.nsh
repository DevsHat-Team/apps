; Let the phone reach TrackPad through Windows Firewall automatically (no popup for the user).
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="TrackPad"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="TrackPad" dir=in action=allow program="$INSTDIR\${PRODUCT_FILENAME}.exe" enable=yes profile=any'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="TrackPad"'
!macroend
