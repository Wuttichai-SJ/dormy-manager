-- ค่าบริการของสัญญาที่ใช้งานอยู่ต้องตามห้อง (นำออกจากห้อง = บิลถัดไปไม่เก็บ)
--
-- ก่อนหน้านี้นำออกจากห้องแล้วสัญญายังเก็บต่อ · ล้างที่ค้างครั้งเดียว ลบอย่างเดียว ไม่เพิ่ม
DELETE FROM contract_services
 WHERE contract_id IN (SELECT contract_id FROM contracts WHERE status = 'active')
   AND NOT EXISTS (
         SELECT 1
           FROM room_services rs
           JOIN contracts c ON c.room_id = rs.room_id
          WHERE c.contract_id = contract_services.contract_id
            AND rs.apartment_service_id = contract_services.apartment_service_id
       );
