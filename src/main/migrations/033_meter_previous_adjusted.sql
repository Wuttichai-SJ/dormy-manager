-- เลข "จดครั้งก่อน" ที่ผู้ใช้แก้เอง (กรอกเลขเริ่มผิด / มิเตอร์หมุนตอนห้องว่าง)
--
-- ปกติ main คิดเลขครั้งก่อนใหม่ทุกครั้งที่บันทึก (รอบก่อน / เลขวันเข้าพัก)
-- 1 = เก็บเลขที่ผู้ใช้กรอกไว้ ห้ามคิดใหม่ทับ · หน่วยที่ตกหล่นจากการแก้จะไม่ถูกคิดเงิน
ALTER TABLE meter_readings ADD COLUMN is_water_previous_adjusted    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meter_readings ADD COLUMN is_electric_previous_adjusted INTEGER NOT NULL DEFAULT 0;
