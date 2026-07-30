-- 003_apartments_display_order.sql
-- IMMUTABLE once shipped. Further changes go in 004_*.sql.
--
-- ต้นแบบมีปุ่ม "จัดเรียงลำดับ" ให้เจ้าของลากสลับการ์ดหอพักเองได้ ลำดับนั้นต้องอยู่ถาวร
-- ไม่ใช่เรียงตาม apartment_id หรือชื่อ เพราะเจ้าของหอเรียงตามความถี่ที่ใช้งานจริง
-- (หอที่เข้าไปดูทุกวันควรอยู่บนสุด ไม่ใช่หอที่สร้างก่อน)
--
-- DEFAULT 0 ทำให้แถวเดิมที่มีอยู่แล้วเรียงตาม apartment_id ต่อไปเหมือนเดิม
-- (ตัว query เรียงด้วย display_order, apartment_id เป็นตัวตัดสินรอง)

ALTER TABLE apartments ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
