-- เลขที่เอกสารซ้ำข้ามหอ แล้วออกบิลไม่ได้ทั้งหอ
--
-- **บั๊กที่เจอจริง 2026-08-10 กับหอพักประตู 5** — ออกบิลได้ห้องเดียวจากสามห้อง
-- ที่เหลือล้มด้วย `UNIQUE constraint failed: invoices.invoice_number`
--
-- ต้นเหตุ: migration 012 สร้างของสองอย่างที่ขัดกันเองในไฟล์เดียวกัน
--   · `document_counters` เดินเลข **แยกรายหอ** (apartment_id, doc_type, period)
--   · `idx_invoices_number` บังคับเลขไม่ซ้ำ **ทั้งฐานข้อมูล**
-- หอที่สองจึงเดินเลขจาก 0001 ใหม่เสมอ แล้วไปชนกับเลขของหอแรกในงวดเดียวกัน
--
-- เลือกแก้ทางไหน: ให้เลขไม่ซ้ำ "รายหอ" ตามที่ตัวนับตั้งใจไว้แต่แรก ไม่ใช่เปลี่ยนตัวนับ
-- ให้เดินร่วมกันทั้งบัญชี เพราะเลขบนเอกสารของแต่ละหอควรเริ่มที่ 0001 ของตัวเอง
-- (ถ้าเดินร่วมกัน หอเล็กจะได้เลขกระโดดเป็น 0004 0009 0015 แล้วเจ้าของหอจะถามว่าหายไปไหน)
--
-- ตารางเอกสารไม่มี apartment_id เพราะเคยอ้อมผ่าน contract → room → floor เสมอ
-- ตอนนี้ต้องมีจริงๆ ไม่งั้นสร้าง unique index แบบผสมไม่ได้ — ห้องย้ายหอไม่ได้อยู่แล้ว
-- (floor ผูกกับหอ ห้องผูกกับ floor) ค่านี้จึงไม่มีวันเพี้ยนจากทางอ้อม

ALTER TABLE invoices ADD COLUMN apartment_id INTEGER;
ALTER TABLE payments ADD COLUMN apartment_id INTEGER;
ALTER TABLE room_bookings ADD COLUMN apartment_id INTEGER;

UPDATE invoices SET apartment_id = (
  SELECT f.apartment_id
    FROM contracts c
    JOIN rooms r  ON r.room_id = c.room_id
    JOIN floors f ON f.floor_id = r.floor_id
   WHERE c.contract_id = invoices.contract_id
);

-- ใบเสร็จผูกกับใบแจ้งหนี้ *หรือ* สัญญา อย่างใดอย่างหนึ่ง (ดู 012) ต้องไล่ทั้งสองทาง
UPDATE payments SET apartment_id = (
  SELECT f.apartment_id
    FROM contracts c
    JOIN rooms r  ON r.room_id = c.room_id
    JOIN floors f ON f.floor_id = r.floor_id
   WHERE c.contract_id = COALESCE(
     payments.contract_id,
     (SELECT i.contract_id FROM invoices i WHERE i.invoice_id = payments.invoice_id)
   )
);

UPDATE room_bookings SET apartment_id = (
  SELECT f.apartment_id
    FROM rooms r
    JOIN floors f ON f.floor_id = r.floor_id
   WHERE r.room_id = room_bookings.room_id
);

DROP INDEX idx_invoices_number;
DROP INDEX idx_payments_receipt_number;
DROP INDEX idx_room_bookings_number;

-- **ต้องเขียน apartment_id ทุกครั้งที่ INSERT** — SQLite ถือว่า NULL ไม่ซ้ำกับ NULL
-- ถ้าปล่อยว่าง unique index จะไม่กันอะไรเลย และบั๊กนี้จะกลับมาแบบเงียบกว่าเดิม
CREATE UNIQUE INDEX idx_invoices_number ON invoices (apartment_id, invoice_number);
CREATE UNIQUE INDEX idx_payments_receipt_number ON payments (apartment_id, receipt_number);
CREATE UNIQUE INDEX idx_room_bookings_number ON room_bookings (apartment_id, booking_number);
