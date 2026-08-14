-- "ยังไม่ได้นัดช่าง" ต้องแยกจาก "นัดวันนี้"
--
-- ของเดิม `appointment_date` เป็น NOT NULL ซึ่งใช้กับความจริงไม่ได้: ผู้เช่าโทรมาแจ้งว่า
-- น้ำรั่วตอนนี้ ยังไม่มีใครรู้ว่าช่างจะว่างวันไหน ถ้าบังคับกรอกตั้งแต่ตอนรับแจ้ง คนคีย์จะ
-- ใส่วันที่มั่วไปก่อน (วันนี้บ้าง พรุ่งนี้บ้าง) แล้วคอลัมน์นัดหมายจะเชื่อไม่ได้ทั้งตาราง —
-- รูปแบบเดียวกับที่เคยเจอใน 014 (เลขมิเตอร์ 0 ที่แปลว่า "ยังไม่ได้จด")
--
-- NULL = ยังไม่ได้นัด · มีค่า = นัดไว้วันนั้นจริง
--
-- SQLite ถอด NOT NULL ตรงๆ ไม่ได้ ต้องสร้างตารางใหม่/คัดลอก/เปลี่ยนชื่อ (เหมือน 009, 014)
-- ทั้งไฟล์อยู่ในธุรกรรมเดียวกันอยู่แล้วจาก migrate.js
--
-- `maintenance_request_images` (จาก 011) อ้างตารางนี้อยู่ แต่ทั้งสองตารางยังว่าง
-- (โมดูลแจ้งซ่อมเพิ่งเริ่มทำ) การ DROP จึงผ่าน และ RENAME จะพา FK ของตารางลูก
-- กลับมาชี้ที่ตารางใหม่ให้เอง

CREATE TABLE maintenance_requests_new (
  maintenance_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id           INTEGER NOT NULL,
  reported_date     TEXT NOT NULL,
  -- NULL = รับแจ้งแล้วแต่ยังไม่ได้นัดช่าง
  appointment_date  TEXT,
  -- 'pending' (รอดำเนินการ) | 'scheduled' (นัดช่างแล้ว) | 'done' (ซ่อมเสร็จ) | 'cancelled' (ยกเลิก)
  -- ตรวจค่าที่ db/maintenance.js (SQLite ไม่มี ENUM — กติกาเดิมของโปรเจกต์)
  status            TEXT NOT NULL,
  description       TEXT NOT NULL,
  -- เลิกใช้ตั้งแต่ 011 (รูปเก็บเป็น BLOB ที่ maintenance_request_images) ไม่ลบทิ้งเพราะ
  -- SQLite ต้องสร้างตารางใหม่ทั้งใบ และคอลัมน์ที่ไม่มีใครเขียนก็ไม่ได้ทำให้ใครเดือดร้อน
  image_url         TEXT,
  repaired_date     TEXT,
  -- ค่าซ่อมที่หอจ่ายไป · **ยังไม่ได้ผูกกับระบบเงินใดๆ** — รอคำตอบจากเจ้าของหอว่าค่าซ่อม
  -- ระหว่างผู้เช่ายังอยู่ หอออกเองหรือเรียกเก็บจากผู้เช่า (ต่างจากตอนย้ายออกที่ตกลงแล้วว่า
  -- หักจากเงินประกัน) ถ้าคำตอบคือเรียกเก็บได้ ให้ต่อทางเข้า "เพิ่มรายการ" ของใบแจ้งหนี้
  repair_cost_cents INTEGER,
  repair_details    TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms (room_id)
);

INSERT INTO maintenance_requests_new (
  maintenance_id, room_id, reported_date, appointment_date, status, description,
  image_url, repaired_date, repair_cost_cents, repair_details, created_at, updated_at
)
SELECT
  maintenance_id, room_id, reported_date, appointment_date, status, description,
  image_url, repaired_date, repair_cost_cents, repair_details, created_at, updated_at
FROM maintenance_requests;

DROP TABLE maintenance_requests;
ALTER TABLE maintenance_requests_new RENAME TO maintenance_requests;

CREATE INDEX idx_maintenance_room ON maintenance_requests (room_id);
-- หน้ารายการเรียงตามวันที่แจ้ง และกรองด้วยสถานะเป็นหลัก
CREATE INDEX idx_maintenance_status ON maintenance_requests (status, reported_date);
