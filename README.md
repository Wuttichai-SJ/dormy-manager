# Dormy Manager

ระบบจัดการหอพักแบบ Desktop (offline-first) — ElectronJS + React 19 + better-sqlite3 (raw SQL, no ORM).
อ้างอิงการออกแบบจากเว็บต้นฉบับ `app.yeeraf.com` (layout ตาม, โทนสีต่าง/สุขุม).

## สถานะ
Phase 0 — วางราก (เสร็จ: แอปเปิดได้, migration รัน, IPC ping/pong ผ่าน)

## ติดตั้ง / รัน

```
npm ci        # ใช้ npm ci เท่านั้น ห้าม npm install/update หลังมี lockfile แล้ว
npm run dev       # แอปจริง (Electron + ฐานข้อมูล)
npm run dev:web   # เฉพาะหน้าจอในเบราว์เซอร์ที่ http://localhost:5173 ไม่มี Electron/IPC/DB
```

`dev:web` ใช้ `vite.config.mjs` ซึ่ง `electron.vite.config.mjs` import ไปใช้ต่อ — ตั้งค่า
หน้าจอไว้ที่เดียว สองโหมดจะได้ไม่เพี้ยนกัน เหมาะกับตอนจัด layout เพราะรีเฟรชไว
แต่ปุ่มไหนที่เรียก IPC จะขึ้นว่าอยู่ในโหมดเบราว์เซอร์แทน

## ดู log เวลาแอปมีปัญหา

Electron บน Windows เป็น GUI subsystem — `console.log` ฝั่ง main process **ไม่โผล่ใน
terminal** ทุกอย่างจึงถูกเขียนลงไฟล์:

```
C:\Users\<user>\AppData\Roaming\dormy-manager\logs\main.log
```

เวลาผู้ใช้แจ้งว่า "เปิดไม่ขึ้น" ให้ขอไฟล์นี้มาดูก่อนเสมอ

better-sqlite3 ใช้ **prebuilt binary ของ Electron ABI** (ไม่ต้องมี C++ toolchain) โดยอ่านค่า
`runtime` / `target` / `disturl` จาก `.npmrc` — ต้องแก้ `target` ให้ตรงกับเวอร์ชัน `electron`
ใน package.json ทุกครั้งที่อัปเกรด Electron

⚠️ npm 11 เตือนว่าคีย์พวกนี้เป็น "Unknown project config" และ **จะเลิกรองรับใน npm major ถัดไป**
ถ้าวันหนึ่ง `.npmrc` ใช้ไม่ได้แล้ว ให้ส่งเป็น env var แทน (ได้ผลเหมือนกัน):

```powershell
$env:npm_config_runtime='electron'; $env:npm_config_target='33.2.1'
$env:npm_config_disturl='https://electronjs.org/headers'; $env:npm_config_build_from_source='false'
npm ci
```

ตรวจว่า native module ผูกกับ ABI ถูกตัว:
`ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe -e "require('better-sqlite3')"`
(ต้องได้ `process.versions.modules` = 130 สำหรับ Electron 33)

## เอกสารอ้างอิง
- `../dormitory.sql` — สคีมาต้นฉบับ (MySQL) รอแปลงเป็น SQLite migrations
- `../ร่าง database.pdf` — สำรวจ yeeraf 20 โมดูล
