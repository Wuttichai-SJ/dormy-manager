-- ค่าน้ำ-ค่าไฟงวดสุดท้ายตอนย้ายออก คิดจากมิเตอร์และเรตของห้อง
--
-- เดิมแท็บ "ค่ามิเตอร์" ให้กรอกชื่อรายการกับยอดเงินเอง ระบบจึงไม่รู้ว่ายอดนั้นมาจากเลขไหน
-- ตอนนี้ระบบดึงเลขครั้งก่อน รับเลขวันย้ายออก แล้วคิดด้วยสูตรเดียวกับบิลรายเดือน
-- จึงต้องเก็บเลขที่ใช้คิดไว้กับรายการ เพื่อให้ใบสรุปตรวจย้อนหลังได้
--
-- item_type ใช้ 'water' | 'electricity' (001 กำกับไว้แล้ว) · 'meter' ของใบเก่ายังอ่านได้
-- คอลัมน์ VAT (amount_before_vat_cents / vat_percent / vat_amount_cents) มีอยู่แล้วตั้งแต่ 001
-- NULL ทั้งหมด = รายการที่ไม่ได้มาจากมิเตอร์ หรือห้องเหมาจ่าย
ALTER TABLE contract_termination_items ADD COLUMN previous_reading DECIMAL(10,2);
ALTER TABLE contract_termination_items ADD COLUMN current_reading  DECIMAL(10,2);
ALTER TABLE contract_termination_items ADD COLUMN units_used       DECIMAL(10,2);
ALTER TABLE contract_termination_items ADD COLUMN unit_price_cents INTEGER;
