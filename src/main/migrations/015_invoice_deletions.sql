-- ลบใบแจ้งหนี้ที่ยกเลิกแล้วออกจากระบบ พร้อมเก็บเหตุผลไว้
--
-- ใบแจ้งหนี้ที่ยกเลิกแล้วยังค้างอยู่ในรายการไปเรื่อยๆ จนบังของที่ยังต้องตามเก็บเงิน
-- เจ้าของหอจึงต้องเก็บกวาดออกได้ (ต้นแบบก็มีปุ่มลบบนใบแจ้งหนี้)
--
-- แต่ "ลบแล้วหายไปเฉยๆ" ทำให้ตรวจย้อนหลังไม่ได้ว่าเลขที่หายไปคือใบอะไร ใครลบ เพราะอะไร
-- จึงลบตัวใบจริงแต่ทิ้งบันทึกการลบไว้ที่นี่ — เหตุผลที่บังคับกรอกจะได้มีที่อยู่จริง
-- ไม่ใช่ถามเอาแล้วโยนทิ้งไปพร้อมกับแถวที่ลบ
--
-- ตัวนับใน document_counters ไม่ถอยตามการลบอยู่แล้ว เลขที่ใบที่ถูกลบจึงไม่ถูกใช้ซ้ำ
CREATE TABLE invoice_deletions (
  invoice_deletion_id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id        INTEGER NOT NULL,
  -- คัดลอกไว้เป็นข้อความ ไม่ผูก FK กับใบที่ลบไปแล้ว (แถวนั้นไม่มีอยู่แล้ว)
  -- และห้องอาจถูกลบทีหลังด้วย บันทึกการลบต้องอ่านออกได้ด้วยตัวเองตลอดไป
  invoice_number      TEXT NOT NULL,
  room_number         TEXT,
  billing_month       TEXT,
  issue_date          TEXT,
  total_amount_cents  INTEGER NOT NULL,
  reason              TEXT NOT NULL,
  deleted_by          INTEGER NOT NULL,
  deleted_at          TEXT NOT NULL,
  FOREIGN KEY (apartment_id) REFERENCES apartments (apartment_id),
  FOREIGN KEY (deleted_by) REFERENCES users (user_id)
);
CREATE INDEX idx_invoice_deletions_apartment ON invoice_deletions (apartment_id);
