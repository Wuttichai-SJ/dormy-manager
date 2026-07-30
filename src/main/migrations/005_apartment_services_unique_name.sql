-- 005_apartment_services_unique_name.sql
-- IMMUTABLE once shipped. Further changes go in 006_*.sql.
--
-- ห้ามมีค่าบริการชื่อซ้ำกันในหอเดียวกัน
-- ถ้ามี "ค่าที่จอดรถ" สองรายการคนละราคา พอไปผูกกับห้องแล้วออกบิล จะไม่มีใครรู้ว่า
-- ห้องนั้นโดนคิดใบไหน และยอดในบิลจะอธิบายให้ผู้เช่าฟังไม่ได้
--
-- ฝั่ง JS ตรวจซ้ำก่อนอยู่แล้วเพื่อให้ข้อความอ่านรู้เรื่อง index นี้เป็นตาข่ายชั้นสุดท้าย
-- กันกรณีที่มีทางเขียนข้อมูลทางอื่นในอนาคต (นำเข้าไฟล์ กู้ข้อมูล ฯลฯ)
--
-- ชื่อถูก trim ก่อนเขียนเสมอ (ดู db/apartmentServices.js) index จึงเทียบตรงตัวได้

CREATE UNIQUE INDEX idx_apartment_services_name
  ON apartment_services (apartment_id, name);
