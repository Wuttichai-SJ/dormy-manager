-- 007_rooms_unique_number.sql
-- IMMUTABLE once shipped. Further changes go in 008_*.sql.
--
-- ห้ามมีเลขห้องซ้ำกันในชั้นเดียวกัน
-- ถ้ามีห้อง 101 สองห้อง พอผู้เช่าโอนเงินมาบอกว่า "ค่าห้อง 101" จะไม่มีใครรู้ว่าห้องไหน
-- และตอนจดมิเตอร์ก็จะกรอกลงผิดห้องได้โดยไม่มีอะไรเตือน
--
-- บังคับที่ระดับ "ชั้น" เพราะ rooms ไม่มีคอลัมน์ apartment_id (ผูกผ่าน floor_id)
-- ส่วนความซ้ำข้ามชั้นในหอเดียวกัน ตรวจที่ฝั่ง JS อีกชั้น (ดู db/rooms.js)
-- เพราะหอส่วนใหญ่ตั้งเลขห้องไม่ซ้ำกันทั้งตึกอยู่แล้ว

CREATE UNIQUE INDEX idx_rooms_number_per_floor ON rooms (floor_id, room_number);
