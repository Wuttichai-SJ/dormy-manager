-- 002_users_unique_identifier.sql
-- IMMUTABLE once shipped. Further changes go in 003_*.sql.
--
-- เหตุผล: หน้า login รับ "อีเมล / เบอร์โทรศัพท์" ในช่องเดียว (ตามหน้าจอต้นแบบ) แล้วค้นหา
-- ผู้ใช้จากค่านั้น ถ้ามีผู้ใช้สองคนเบอร์ซ้ำกัน ระบบจะไม่รู้ว่าใครคือใคร → ต้องกันที่ฐานข้อมูล
-- ไม่ใช่กันแค่ในโค้ด JS
--
-- SQLite เพิ่ม UNIQUE constraint เข้าตารางเดิมด้วย ALTER TABLE ไม่ได้ แต่สร้าง
-- UNIQUE INDEX ได้ ซึ่งบังคับใช้เหมือนกัน
--
-- หมายเหตุเรื่อง NULL: ใน SQLite ค่า NULL ไม่ชนกันเองใน unique index ดังนั้นผู้ใช้หลายคน
-- ที่ไม่กรอกอีเมล (email = NULL) ยังอยู่ร่วมกันได้ — เก็บอีเมลเป็น NULL เสมอเมื่อไม่กรอก
-- ห้ามเก็บเป็นสตริงว่าง ไม่งั้นคนที่สองจะเพิ่มไม่ได้

CREATE UNIQUE INDEX idx_users_phone ON users (phone);
CREATE UNIQUE INDEX idx_users_email ON users (email);
