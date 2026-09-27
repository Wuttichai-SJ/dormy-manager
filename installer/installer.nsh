; บังคับติดตั้งแบบ "เฉพาะผู้ใช้นี้" เสมอ — ไม่ต้องใช้ admin และไม่มีหน้าให้เลือก
; ข้อมูลอยู่ใน %APPDATA% ของบัญชี Windows อยู่แล้ว การติดตั้งแบบ all users จะได้โปรแกรมซ้อนสองตัว
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
