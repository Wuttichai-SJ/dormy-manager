-- 004_deposit_refund_policy.sql
-- IMMUTABLE once shipped. Further changes go in 005_*.sql.
--
-- กฎคืนเงินประกันของหอนี้ — ต้นแบบ (app.yeeraf.com) ไม่มีเรื่องนี้เลย
-- ของเขาคือ "พนักงานพิมพ์ยอดคืนเอาเอง" ไม่มีเงื่อนไขอัตโนมัติใดๆ
-- ตรวจสอบจากคู่มือทางการหัวข้อ "ตั้งค่าสัญญาเช่ารายเดือน" (เก็บแค่วันเข้า/วันออก
-- ไม่มีแนวคิดระยะสัญญา) และ "ยกเลิกสัญญาเช่า / ย้ายออก" (เงินประกัน = ตัวเลขที่คนกรอก)
--
-- กฎที่ตกลงกันไว้:
--   อยู่ครบตามสัญญา          -> คืนเงินประกันเต็มจำนวน
--   ออกก่อนครบ               -> ริบทั้งหมด ไม่คืนบางส่วน
--   ออกโดยไม่แจ้งล่วงหน้า 15 วัน -> ริบทั้งหมด
--   ต่อสัญญา                  -> เงินประกันยกมาใช้ต่อ นับเดือนต่อเนื่องข้ามสัญญา
--   เจ้าของกดข้ามกฎได้ แต่ต้องบันทึกเหตุผล
--
-- ทุกคอลัมน์มี DEFAULT จึงใช้ ALTER TABLE ADD COLUMN ได้ ไม่ต้องสร้างตารางใหม่
-- แล้วย้ายข้อมูล (SQLite เปลี่ยน/ถอด NOT NULL ของคอลัมน์เดิมไม่ได้)

-- -----------------------------------------------------
-- apartments: ค่าตั้งต้นของหอ เอาไว้เติมให้สัญญาใหม่อัตโนมัติ
-- -----------------------------------------------------
-- NULL = ใช้ระยะสัญญาของสัญญาใบนั้นเป็นเกณฑ์ (สัญญา 6 เดือนต้องอยู่ครบ 6, 12 ต้องครบ 12)
-- ตั้งเป็นตัวเลขได้ถ้าหอต้องการเกณฑ์ตายตัวเช่น "ต้องครบ 12 เดือนเสมอ"
ALTER TABLE apartments ADD COLUMN default_deposit_min_stay_months INTEGER;
ALTER TABLE apartments ADD COLUMN default_deposit_notice_days INTEGER NOT NULL DEFAULT 15;

-- -----------------------------------------------------
-- contracts: snapshot กฎไว้ที่ตัวสัญญา + ระยะสัญญา + สายการต่อสัญญา
-- -----------------------------------------------------
-- ทำไมต้อง snapshot ไม่ใช่อ่านจาก apartments ตอนคำนวณ:
-- ถ้าปีหน้าเจ้าของเปลี่ยนกฎเป็น "แจ้งล่วงหน้า 60 วัน" สัญญาที่เซ็นไปแล้วต้องใช้กฎ
-- ที่ผู้เช่าตกลงไว้ตอนเซ็น ไม่ใช่โดนกฎใหม่ย้อนหลัง — เรื่องนี้กลายเป็นข้อพิพาทได้จริง

-- 6 | 12 | NULL (ไม่กำหนดระยะ เช่น สัญญารายเดือนต่อไปเรื่อยๆ)
ALTER TABLE contracts ADD COLUMN term_months INTEGER;

-- 'on_full_term' = คืนเมื่ออยู่ครบ | 'always' = คืนเสมอ | 'never' = ไม่คืน
-- SQLite ไม่มี ENUM ต้องตรวจค่าที่ฝั่ง JS ก่อนเขียนทุกครั้ง (ดู db/contracts.js)
ALTER TABLE contracts ADD COLUMN deposit_refund_policy TEXT NOT NULL DEFAULT 'on_full_term';

-- NULL = ใช้ term_months เป็นเกณฑ์ (ค่าปกติ) ใส่ตัวเลขเมื่อสัญญาใบนี้ตกลงกันเป็นอย่างอื่น
ALTER TABLE contracts ADD COLUMN deposit_min_stay_months INTEGER;
ALTER TABLE contracts ADD COLUMN deposit_notice_days INTEGER NOT NULL DEFAULT 15;

-- สายการต่อสัญญา — ตัวนี้คือหัวใจของกฎ "นับเดือนต่อเนื่อง"
-- ถ้าไม่มี ระบบจะเห็นคนที่ต่อสัญญา 6+6 เป็นสัญญาสั้น 2 ใบแยกกัน แล้วไม่มีใคร
-- ผ่านเกณฑ์ 12 เดือนได้เลยตลอดกาล การนับต้องไล่ย้อน chain ไปหาสัญญาใบแรก
ALTER TABLE contracts ADD COLUMN previous_contract_id INTEGER REFERENCES contracts (contract_id);

-- 1 = เงินประกันก้อนนี้ยกมาจากสัญญาใบก่อน ไม่ได้เก็บเงินใหม่
-- ยอดยังคัดลอกมาไว้ที่ deposit_amount_cents เหมือนเดิม เพื่อให้ตอนคิดเงินย้ายออก
-- อ่านจากสัญญาที่ใช้งานอยู่ใบเดียวจบ ไม่ต้องไล่ chain หาว่าเงินอยู่ใบไหน
-- แต่ฝั่งบัญชีต้องแยกออกว่า "ไม่ใช่รายรับใหม่" จึงต้องมีธงนี้
ALTER TABLE contracts ADD COLUMN is_deposit_carried_over INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_contracts_previous ON contracts (previous_contract_id);

-- -----------------------------------------------------
-- contract_terminations: เก็บ "ผลการตัดสิน" ไม่ใช่แค่ยอดเงิน
-- -----------------------------------------------------
-- ต้องเก็บเหตุผลไว้ด้วย เพราะอีก 3 ปีถ้าผู้เช่าเก่ามาถามว่าทำไมไม่ได้เงินคืน
-- ต้องตอบได้จากฐานข้อมูล ไม่ใช่เดาจากตัวเลขที่เหลืออยู่

-- notice_date เดิมเป็น NOT NULL จึงถอดออกไม่ได้ — คนที่ออกเงียบๆ ไม่แจ้งเลย
-- ให้บันทึก is_notice_given = 0 แล้วใส่ notice_date เป็นวันที่ "ทราบว่าย้ายออก" แทน
ALTER TABLE contract_terminations ADD COLUMN is_notice_given INTEGER NOT NULL DEFAULT 1;

-- จำนวนวันที่แจ้งล่วงหน้าจริง (actual_move_out_date - notice_date)
-- คำนวณได้จากสองคอลัมน์นั้นก็จริง แต่เก็บไว้เพื่อให้ใบสรุปย้ายออกที่พิมพ์ไปแล้ว
-- ตรงกับสิ่งที่ระบบใช้ตัดสินในวันนั้นเสมอ
ALTER TABLE contract_terminations ADD COLUMN notice_days_given INTEGER;

-- นับรวมทั้งสาย previous_contract_id แล้ว (ไม่ใช่แค่สัญญาใบสุดท้าย)
ALTER TABLE contract_terminations ADD COLUMN months_stayed_total INTEGER;

ALTER TABLE contract_terminations ADD COLUMN is_deposit_refundable INTEGER NOT NULL DEFAULT 1;

-- 'early_move_out' | 'insufficient_notice' | 'both' | 'policy_never' | NULL (ไม่ริบ)
ALTER TABLE contract_terminations ADD COLUMN forfeit_reason TEXT;

-- ยอดเงินประกันที่คืนได้หลังใช้กฎแล้ว (0 เมื่อริบ) ยังไม่หักบิลค้าง
-- net_refund_amount_cents ที่มีอยู่เดิมคือยอดสุทธิหลังหักทุกอย่าง และ "ติดลบได้"
-- เพราะริบเงินประกันแล้วผู้เช่าอาจยังค้างค่าน้ำค่าไฟอยู่ ต้องเรียกเก็บเพิ่ม
ALTER TABLE contract_terminations ADD COLUMN refundable_deposit_cents INTEGER NOT NULL DEFAULT 0;

-- เจ้าของกดข้ามผลการตัดสินของระบบได้ แต่ต้องพิมพ์เหตุผล
-- ถ้าไม่เปิดช่องนี้ไว้ เจ้าของจะเลี่ยงไปพิมพ์ "รายการคืนเงินเพิ่มเติม" แทน
-- แล้วเหตุผลจริงจะหายไปจากประวัติ กลายเป็นตัวเลขลอยๆ ที่ไม่มีใครอธิบายได้
ALTER TABLE contract_terminations ADD COLUMN is_manual_override INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contract_terminations ADD COLUMN override_reason TEXT;
