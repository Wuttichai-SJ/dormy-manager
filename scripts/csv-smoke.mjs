// ทดสอบการสร้างไฟล์ CSV — รันด้วย: npm run test:csv
import { assert, check, group, summarize, throws } from './lib/harness.mjs'

const { UTF8_BOM, buildCsv, safeFileName } = await import('../src/main/csv.js')

const COLUMNS = [
  { key: 'no', label: 'เลขที่' },
  { key: 'name', label: 'ชื่อผู้เช่า' },
  { key: 'amount', label: 'จำนวนเงิน' }
]

group('รูปแบบไฟล์ที่ Excel บน Windows อ่านออก')

check('ขึ้นต้นไฟล์ด้วย BOM ของ UTF-8', () => {
  const csv = buildCsv(COLUMNS, [{ no: 'R-001', name: 'สมชาย ใจดี', amount: '3,500.00' }])
  assert(csv.startsWith(UTF8_BOM), 'ไม่มี BOM นำหน้า')
  assert(csv.charCodeAt(0) === 0xfeff, `อักขระแรกคือ ${csv.charCodeAt(0).toString(16)}`)
})

check('จบบรรทัดด้วย \\r\\n ทุกบรรทัด รวมบรรทัดสุดท้าย', () => {
  const csv = buildCsv(COLUMNS, [
    { no: 'R-001', name: 'ก', amount: '1' },
    { no: 'R-002', name: 'ข', amount: '2' }
  ])
  assert(csv.endsWith('\r\n'), 'บรรทัดสุดท้ายไม่จบด้วย \\r\\n')

  assert(!/[^\r]\n/.test(csv), 'มี \\n ที่ไม่มี \\r นำหน้า')
})

check('ภาษาไทยอยู่ในไฟล์ครบ ไม่ถูกแปลงระหว่างทาง', () => {
  const csv = buildCsv(COLUMNS, [{ no: 'R-001', name: 'สมหญิง รักเรียน', amount: '3,500.00' }])
  assert(csv.includes('สมหญิง รักเรียน'), 'ชื่อภาษาไทยหายไป')
  assert(csv.includes('ชื่อผู้เช่า'), 'หัวตารางภาษาไทยหายไป')
})

group('การใส่เครื่องหมายคำพูด')

check('แถวแรกคือหัวตารางตามลำดับคอลัมน์ที่ส่งมา', () => {
  const csv = buildCsv(COLUMNS, [{ no: '1', name: 'ก', amount: '2' }])
  const [header] = csv.slice(1).split('\r\n')
  assert(header === '"เลขที่","ชื่อผู้เช่า","จำนวนเงิน"', header)
})

check('เครื่องหมายคำพูดในข้อมูลถูกคูณเป็นสองตัว', () => {
  const csv = buildCsv([{ key: 'note', label: 'หมายเหตุ' }], [{ note: 'ห้อง "A" ชั้น 2' }])
  const rows = csv.slice(1).split('\r\n')
  assert(rows[1] === '"ห้อง ""A"" ชั้น 2"', rows[1])
})

check('ลูกน้ำและการขึ้นบรรทัดใหม่ในข้อมูลไม่ทำให้คอลัมน์เลื่อน', () => {
  const csv = buildCsv(
    [
      { key: 'a', label: 'ก' },
      { key: 'b', label: 'ข' }
    ],
    [{ a: '1,234', b: 'บรรทัดแรก\nบรรทัดสอง' }]
  )
  assert(csv.includes('"1,234","บรรทัดแรก\nบรรทัดสอง"'), csv)
})

check('ช่องที่เป็น null หรือไม่มีค่า กลายเป็นช่องว่าง ไม่ใช่คำว่า null', () => {
  const csv = buildCsv(COLUMNS, [{ no: 'R-001', name: null, amount: undefined }])
  const rows = csv.slice(1).split('\r\n')
  assert(rows[1] === '"R-001","",""', rows[1])
})

check('ตัวเลขที่เป็นชนิด number ก็ส่งออกได้', () => {
  const csv = buildCsv([{ key: 'n', label: 'จำนวน' }], [{ n: 0 }, { n: 3500 }])
  const rows = csv.slice(1).split('\r\n')
  assert(rows[1] === '"0"', rows[1])
  assert(rows[2] === '"3500"', rows[2])
})

group('กันสูตรแฝงในข้อความ (Excel ไม่คำนวณตอนเปิดไฟล์)')

const cellOf = (value) => buildCsv([{ key: 'v', label: 'ค่า' }], [{ v: value }]).slice(1).split('\r\n')[1]

check("ข้อความขึ้นต้นด้วย = + - @ ถูกเติม ' นำหน้า", () => {
  assert(cellOf('=HYPERLINK("http://x","คลิก")') === `"'=HYPERLINK(""http://x"",""คลิก"")"`, cellOf('=HYPERLINK("http://x","คลิก")'))
  assert(cellOf('+1+1') === `"'+1+1"`, cellOf('+1+1'))
  assert(cellOf('-2+3') === `"'-2+3"`, cellOf('-2+3'))
  assert(cellOf('@SUM(A1)') === `"'@SUM(A1)"`, cellOf('@SUM(A1)'))
})

check("ยอดติดลบยังเป็นตัวเลข ไม่ถูกเติม '", () => {
  assert(cellOf(-500) === '"-500"', cellOf(-500))
  assert(cellOf('-500') === '"-500"', cellOf('-500'))
  assert(cellOf('-12.50') === '"-12.50"', cellOf('-12.50'))
})

check('ข้อความปกติไม่ถูกแตะ', () => {
  assert(cellOf('สมชาย ใจดี') === '"สมชาย ใจดี"', cellOf('สมชาย ใจดี'))
  assert(cellOf('ห้อง 101 - ชั้น 1') === '"ห้อง 101 - ชั้น 1"', cellOf('ห้อง 101 - ชั้น 1'))
  assert(cellOf('2026-09-26') === '"2026-09-26"', cellOf('2026-09-26'))
})

group('ข้อมูลที่ส่งออกไม่ได้')

check('ไม่มีแถวเลย ต้องบอกเป็นภาษาไทย', () => {
  throws(() => buildCsv(COLUMNS, []), 'ไม่มีข้อมูลให้ส่งออก', 'ควรกันไว้')
})

check('ไม่ได้ระบุคอลัมน์ ต้องบอกเป็นภาษาไทย', () => {
  throws(() => buildCsv([], [{ a: 1 }]), 'ไม่ได้ระบุคอลัมน์', 'ควรกันไว้')
  throws(() => buildCsv(null, [{ a: 1 }]), 'ไม่ได้ระบุคอลัมน์', 'ควรกันไว้')
})

group('ชื่อไฟล์')

check('ตัดอักขระที่ตั้งเป็นชื่อไฟล์บน Windows ไม่ได้ออก', () => {
  assert(safeFileName('ใบเสร็จ 01/08/2569') === 'ใบเสร็จ 01082569', safeFileName('ใบเสร็จ 01/08/2569'))
  assert(safeFileName('a\\b:c*d?e"f<g>h|i') === 'abcdefghi', safeFileName('a\\b:c*d?e"f<g>h|i'))
})

check('ชื่อว่างหรือไม่มีชื่อ ใช้ค่าสำรอง', () => {
  assert(safeFileName('') === 'export', safeFileName(''))
  assert(safeFileName(null) === 'export', safeFileName(null))
  assert(safeFileName('   ') === 'export', safeFileName('   '))
  assert(safeFileName('///') === 'export', safeFileName('///'))
  assert(safeFileName(null, 'ใบเสร็จ') === 'ใบเสร็จ', safeFileName(null, 'ใบเสร็จ'))
})

check('ชื่อภาษาไทยปกติไม่ถูกแตะ', () => {
  assert(safeFileName('รายงานใบเสร็จรับเงิน') === 'รายงานใบเสร็จรับเงิน', 'ชื่อถูกเปลี่ยน')
})

summarize('การส่งออก CSV ทำงานครบทุกเส้นทาง')
