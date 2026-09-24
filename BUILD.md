# BUILD.md — วิธีประกอบ Dormy Manager เป็นตัวติดตั้ง `.exe`

เอกสารนี้เขียนให้คนที่กลับมาเปิดโปรเจกต์นี้อีกหลายปีข้างหน้าอ่านรู้เรื่องโดยไม่ต้องไล่โค้ด
ทุกข้อที่ขึ้นต้นด้วย 🔴 คือกับดักที่เคยทำให้แอปพังมาแล้วจริง อย่าแก้โดยไม่อ่านเหตุผล

---

## 1. สิ่งที่ต้องมีก่อน build

- **Node.js** (รุ่นที่ใช้พัฒนา: Node 20 ขึ้นไป) และ **npm**
- ติดตั้ง dependency ด้วย **`npm ci` เท่านั้น** — ห้าม `npm install`, `npm update`,
  `npm audit fix` เพราะโปรเจกต์นี้ตรึงเวอร์ชันแบบตายตัว (ไม่มี `^` / `~` ใน `package.json`)
  การปล่อยให้ npm ขยับรุ่นเองเคยทำระบบพังมาแล้ว
- **ไม่ต้องมี C++ toolchain / Visual Studio Build Tools** เพราะไฟล์ `.npmrc` สั่งให้ npm
  ดาวน์โหลดไบนารีของ `better-sqlite3` ที่คอมไพล์มาแล้วสำหรับ Electron 33 โดยตรง
  (`runtime=electron`, `target=33.2.1`, `build_from_source=false`)
- **ต้องต่ออินเทอร์เน็ต** ตอน build ครั้งแรกบนเครื่องใหม่ เพราะ electron-builder ต้องโหลด
  `nsis` กับ `nsis-resources` (รวมราว 2 MB) มาเก็บไว้ที่
  `%LOCALAPPDATA%\electron-builder\Cache`

---

## 2. คำสั่ง

| คำสั่ง | ได้อะไร | ใช้เมื่อไหร่ |
| --- | --- | --- |
| `npm run build` | คอมไพล์โค้ดลง `out/` เฉย ๆ | อยากรู้ว่าโค้ด build ผ่านไหม |
| `npm run dist:dir` | แพ็กเป็นโฟลเดอร์ `release/win-unpacked/` ที่กดเปิด `.exe` ได้เลย **แต่ไม่มีตัวติดตั้ง** | ทดสอบโหมด packaged เร็ว ๆ |
| `npm run dist` | ได้ตัวติดตั้ง `release/DormyManager-Setup-<version>.exe` | ตอนจะส่งมอบจริง |

ผลลัพธ์อยู่ที่ `out/` กับ `release/` ซึ่ง **อยู่ใน `.gitignore` ทั้งคู่** — build กี่รอบก็ได้
ไม่ทำให้ repo รก และไม่มีการแก้ไฟล์ใน `src/` เลย (ยืนยันได้ด้วย `git status` หลัง build)

ขนาดไฟล์ที่ควรได้ราว **80–90 MB** (รุ่น 1.0.0 = 81.7 MB) ถ้าเล็กกว่านี้มากแปลว่ามีอะไรไม่ถูกแพ็กเข้าไป

---

## 3. 🔴 สี่จุดใน `electron-builder.yml` ที่ห้ามแก้

### 3.1 `npmRebuild: false`
ปกติ electron-builder จะเรียก `@electron/rebuild` ให้คอมไพล์ `better-sqlite3` ใหม่ให้ตรง ABI
ของ Electron ซึ่ง **ทำไม่ได้บนเครื่องที่ไม่มี C++ toolchain และไม่จำเป็นด้วย** เพราะ `.npmrc`
โหลดไบนารีที่ตรง ABI มาตั้งแต่ `npm ci` แล้ว ถ้าเปิดค่านี้จะได้ error `node-gyp failed to rebuild`

### 3.2 `asarUnpack: '**/*.node'`
ไฟล์ `.node` คือไบนารีของ `better-sqlite3` ต้องอยู่ **นอก** ไฟล์ asar เพราะการโหลด native module
ใช้กลไกของระบบปฏิบัติการ ซึ่งมองไม่เห็นไฟล์ที่ถูกห่ออยู่ใน asar
**อาการถ้าลืม: แอปเปิดไม่ติดเลย** ไม่ใช่พังบางหน้า

### 3.3 `extraResources: src/main/migrations → migrations`
ไฟล์ migration เป็น `.sql` ซึ่ง vite ไม่ bundle ให้ (มันรวมแต่ JS) จึงต้องคัดลอกเข้าไปเองที่
`resources/migrations` ให้ตรงกับ `resolveMigrationsDir()` ใน `src/main/database.js`
ที่ชี้ไป `process.resourcesPath/migrations` เมื่อ `app.isPackaged`
**เพิ่มไฟล์ migration ใหม่ไม่ต้องแก้บรรทัดนี้** เพราะคัดลอกทั้งโฟลเดอร์

### 3.4 `productName` ต้องอยู่ในไฟล์นี้เท่านั้น
**ห้ามย้าย `productName` ไปใส่ใน `package.json`** เพราะ Electron ใช้ `productName` จาก
`package.json` (ถ้ามี) เป็นชื่อโฟลเดอร์ข้อมูลผู้ใช้ ถ้าใส่ไว้ที่นั่นโฟลเดอร์จะย้ายจาก
`%APPDATA%\dormy-manager` เป็น `%APPDATA%\Dormy Manager` แล้ว **ฐานข้อมูลของหอที่ใช้อยู่
จะหายไปทั้งก้อนในสายตาแอป** (ไฟล์ยังอยู่ แต่แอปเปิดไฟล์ใหม่ที่ว่างเปล่าแทน)
`package.json` ต้องมีแค่ `name`

---

## 4. ขั้นตอนออกรุ่นใหม่

1. แก้ `version` ใน **`package.json`**
2. แก้ `version` ใน **`package-lock.json` ให้ตรงกัน 2 จุด** — ที่ root และใน `packages[""]`
   (แก้ด้วยมือ **ไม่ใช้ `npm version`** เพราะมันจะสร้าง git tag ให้ด้วย และไม่ใช้
   `npm install` เพื่อไม่ให้ lockfile ถูกคำนวณใหม่ทั้งไฟล์)
3. `npm run test` ให้ผ่านก่อน
4. `npm run dist`
5. ชื่อไฟล์จะขึ้นตาม `artifactName: DormyManager-Setup-${version}.${ext}` เอง

---

## 5. ตอนอัปเกรด Electron

**แก้ `target` ใน `.npmrc` ให้ตรงกับรุ่น Electron ใหม่ แล้วลง dependency ใหม่**
อย่าไปเปิด `npmRebuild` เพื่อแก้ปัญหา ABI ไม่ตรง — `npm run rebuild` (electron-rebuild)
ใช้บนเครื่องที่ไม่มี C++ toolchain ไม่ได้

---

## 6. ตอนติดตั้งบนเครื่องลูกค้า

- ตัวติดตั้งตั้งค่าเป็น **`perMachine: false`** คือ ติดตั้งเฉพาะผู้ใช้ปัจจุบัน
  จึงไม่ต้องใช้รหัสผู้ดูแลเครื่องและไม่มีหน้าต่าง UAC
- **โปรแกรมไม่ได้เซ็นดิจิทัล (ไม่ได้ซื้อ code signing certificate)** ครั้งแรกที่เปิด
  Windows SmartScreen จะขึ้นหน้าจอน้ำเงินว่า *"Windows protected your PC"* →
  กด **More info → Run anyway** เป็นเรื่องปกติ ไม่ใช่ไวรัส ควรบอกเจ้าของหอไว้ล่วงหน้า
- ตัวติดตั้งจะสร้างทางลัดให้ทั้งบนเดสก์ท็อปและเมนูเริ่ม ชื่อ **Dormy Manager**

---

## 7. ข้อมูลของผู้ใช้อยู่ที่ไหน

```
%APPDATA%\dormy-manager\
├─ dormy.sqlite        ← ฐานข้อมูลตัวจริง (แอปที่ติดตั้งแล้วใช้ไฟล์นี้)
├─ dormy-dev.sqlite    ← ฐานข้อมูลตอน npm run dev เท่านั้น ไม่เกี่ยวกับตัวที่แพ็ก
├─ backups\            ← ไฟล์สำรองที่สร้างจากเมนูสำรองข้อมูลในแอป
└─ logs\main.log       ← log ของ main process
```

- **โฟลเดอร์นี้อยู่นอกโฟลเดอร์ติดตั้ง** ถอนการติดตั้งหรือลงรุ่นใหม่ทับแล้วข้อมูลไม่หาย
- 🔴 **ทดสอบตัวที่แพ็กแล้วบนเครื่องพัฒนา = ไปแตะ `dormy.sqlite` ตัวจริง ไม่ใช่ dev**
  สำรองไฟล์นี้ก่อนทุกครั้ง (ธรรมเนียมของโปรเจกต์คือคัดลอกเป็น
  `dormy.sqlite.before-<เหตุผล>-<วันที่>.bak`)
- **ตอนส่งมอบจริงให้ลูกค้า** ต้องส่งเครื่องที่ยังไม่มี `dormy.sqlite` หรือเปลี่ยนชื่อไฟล์เดิม
  ออกไปก่อน เพื่อให้ลูกค้าเริ่มจากฐานข้อมูลเปล่าและกรอกข้อมูลเอง

---

## 8. Electron main process ไม่พิมพ์อะไรออกเทอร์มินัล

Electron บน Windows เป็น GUI-subsystem exe → `console.log` ใน main process **ไม่ไปโผล่ที่
PowerShell** ถ้าจะ debug ตัวที่แพ็กแล้วให้อ่านไฟล์ `%APPDATA%\dormy-manager\logs\main.log`
