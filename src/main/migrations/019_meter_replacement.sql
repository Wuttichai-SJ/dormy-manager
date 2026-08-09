-- บันทึกการเปลี่ยนมิเตอร์ลูกใหม่
--
-- มิเตอร์เสียแล้วช่างมาเปลี่ยนลูกใหม่ = เลขเริ่มนับใหม่จาก 0 เลขปัจจุบันจึงน้อยกว่า
-- ครั้งก่อน เหมือนกรณี "เกินรอบมิเตอร์" ทุกประการเมื่อมองจากตัวเลขสองตัว
--
-- แต่หน่วยที่ใช้จริงคนละเรื่องกันสิ้นเชิง เกินรอบคือ "วิ่งจนสุดหน้าปัดแล้ววนกลับ" ซึ่งต้อง
-- บวกส่วนที่วิ่งไปจนสุดเข้าไปด้วย ส่วนเปลี่ยนมิเตอร์คือ "ของเก่าหยุดตรงนี้ ของใหม่เริ่มตรงนั้น"
-- ไม่มีอะไรให้บวก ถ้าเจ้าของหอเจอกรณีเปลี่ยนมิเตอร์แล้วติ๊ก "เกินรอบมิเตอร์" แทน
-- ระบบจะคิดหน่วยเกินไปเป็นหลักพัน แล้วออกบิลหลักหมื่นโดยไม่เตือนอะไรเลย
--
-- ต้องเก็บสองเลขเพิ่มต่อฝั่ง: เลขตอนถอดมิเตอร์เก่า และเลขเริ่มต้นของมิเตอร์ลูกใหม่
--   หน่วยที่ใช้ = (เลขถอดเก่า − ครั้งก่อน) + (ปัจจุบัน − เลขเริ่มลูกใหม่)
--
-- ทั้งสองเลขต้องอยู่ในฐานข้อมูล ไม่ใช่คำนวณแล้วทิ้ง เพราะปีหน้ามีคนถามแน่ว่าทำไม
-- เลขมิเตอร์ห้องนี้กระโดด แล้วต้องตอบได้จากข้อมูลที่มี

ALTER TABLE meter_readings ADD COLUMN is_water_meter_replaced INTEGER;
ALTER TABLE meter_readings ADD COLUMN water_removed_reading DECIMAL(10,2);
ALTER TABLE meter_readings ADD COLUMN water_new_start_reading DECIMAL(10,2);

ALTER TABLE meter_readings ADD COLUMN is_electric_meter_replaced INTEGER;
ALTER TABLE meter_readings ADD COLUMN electric_removed_reading DECIMAL(10,2);
ALTER TABLE meter_readings ADD COLUMN electric_new_start_reading DECIMAL(10,2);
