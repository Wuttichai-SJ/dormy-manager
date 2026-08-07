-- แยก "ยังไม่ได้จด" ออกจาก "จดได้ 0"
--
-- แถวหนึ่งใน meter_readings เก็บทั้งเลขน้ำและเลขไฟ แต่หน้าจอกรอกทีละฝั่ง
-- ตอนบันทึกฝั่งแรก คอลัมน์ของอีกฝั่งถูกเขียนเป็น 0 ไว้ก่อนเพราะเป็น NOT NULL
--
-- ผลคือหน้าจอของฝั่งที่สองเห็นเลข 0 แล้วเข้าใจว่า "บันทึกไว้แล้ว" จึงไม่ไปไล่หา
-- เลขครั้งก่อนจากรอบที่แล้วหรือจากเลขมิเตอร์วันเข้าพักในสัญญาต่อ — ผู้ใช้เลยต้อง
-- พิมพ์เลขครั้งก่อนของฝั่งไฟเองทุกเดือน ทั้งที่ฝั่งน้ำเติมให้อัตโนมัติ
--
-- SQLite ถอด NOT NULL ตรงๆ ไม่ได้ ต้องสร้างตารางใหม่/คัดลอก/เปลี่ยนชื่อ
-- ทำใน migration เดียวจึงอยู่ในธุรกรรมเดียวกับ migrate.js อยู่แล้ว

CREATE TABLE meter_readings_new (
  meter_reading_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meter_batch_id            INTEGER NOT NULL,
  room_id                   INTEGER NOT NULL,
  -- NULL = ฝั่งนี้ยังไม่ได้จดในรอบนี้ · 0 = จดแล้วอ่านได้ 0
  water_previous_reading    DECIMAL(10,2),
  water_current_reading     DECIMAL(10,2),
  water_units_used          DECIMAL(10,2),
  is_water_over_cycle       INTEGER,
  electric_previous_reading DECIMAL(10,2),
  electric_current_reading  DECIMAL(10,2),
  electric_units_used       DECIMAL(10,2),
  is_electric_over_cycle    INTEGER,
  created_at                TEXT NOT NULL,
  updated_at                TEXT,
  FOREIGN KEY (meter_batch_id) REFERENCES meter_batches (batch_id),
  FOREIGN KEY (room_id) REFERENCES rooms (room_id)
);

-- คัดลอกของเดิม พร้อมกู้แถวที่เป็นรอยของบั๊กนี้กลับเป็น NULL
--
-- ฝั่งที่ "ก่อนหน้า=0 และ ปัจจุบัน=0 และ หน่วย=0" คือแถวที่ถูกเขียนไว้เป็นที่ว่าง
-- ตอนบันทึกอีกฝั่ง ไม่ใช่การจดจริง — มิเตอร์ที่อ่านได้ 0 ทั้งก่อนและหลังในรอบเดียวกัน
-- แปลว่าห้องนั้นไม่มีมิเตอร์ให้จดตั้งแต่แรก
INSERT INTO meter_readings_new (
  meter_reading_id, meter_batch_id, room_id,
  water_previous_reading, water_current_reading, water_units_used, is_water_over_cycle,
  electric_previous_reading, electric_current_reading, electric_units_used, is_electric_over_cycle,
  created_at, updated_at
)
SELECT
  meter_reading_id, meter_batch_id, room_id,
  CASE WHEN water_previous_reading = 0 AND water_current_reading = 0 AND water_units_used = 0
       THEN NULL ELSE water_previous_reading END,
  CASE WHEN water_previous_reading = 0 AND water_current_reading = 0 AND water_units_used = 0
       THEN NULL ELSE water_current_reading END,
  CASE WHEN water_previous_reading = 0 AND water_current_reading = 0 AND water_units_used = 0
       THEN NULL ELSE water_units_used END,
  is_water_over_cycle,
  CASE WHEN electric_previous_reading = 0 AND electric_current_reading = 0 AND electric_units_used = 0
       THEN NULL ELSE electric_previous_reading END,
  CASE WHEN electric_previous_reading = 0 AND electric_current_reading = 0 AND electric_units_used = 0
       THEN NULL ELSE electric_current_reading END,
  CASE WHEN electric_previous_reading = 0 AND electric_current_reading = 0 AND electric_units_used = 0
       THEN NULL ELSE electric_units_used END,
  is_electric_over_cycle,
  created_at, updated_at
FROM meter_readings;

DROP TABLE meter_readings;
ALTER TABLE meter_readings_new RENAME TO meter_readings;

CREATE INDEX idx_meter_readings_batch ON meter_readings (meter_batch_id);
CREATE INDEX idx_meter_readings_room ON meter_readings (room_id);
CREATE UNIQUE INDEX idx_meter_readings_unique ON meter_readings (meter_batch_id, room_id);
