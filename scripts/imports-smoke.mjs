// ตรวจว่าทุกฟังก์ชันที่ถูก "เรียก" ในโค้ดฝั่ง main มีที่มาจริง — รันด้วย: npm run test:imports
//
// 🔴 ทำไมต้องมีไฟล์นี้ (บทเรียน 2026-08-17)
//
// `utilityHandlers.js` กับ `apartmentServiceHandlers.js` เรียก `requireOwnerUserId()`
// โดยไม่มีบรรทัด import ของมันเลย โค้ดโหลดผ่านปกติ (JavaScript ไม่บ่นจนกว่าจะเรียกจริง)
// แล้วพังเป็น "requireOwnerUserId is not defined" ตอนเจ้าของหอกดบันทึกค่าบริการ/ค่าน้ำ-ค่าไฟ
// — คือ **ตั้งค่าหอพักไม่ได้เลยทั้งสองหัวข้อ** และมันหลุดไปถึงไฟล์ .exe
//
// ทำไมไม่มีอะไรจับได้: ชั้น `handlers/*.js` import `electron` ซึ่งชุดทดสอบเข้าไม่ถึง
// (รันใต้ ELECTRON_RUN_AS_NODE) · `npm run build` ก็ไม่จับ เพราะ rollup รวมไฟล์ที่ import
// กันไว้ในบันเดิลเดียว ชื่อที่หายไปจึงไม่ใช่ "โมดูลหาไม่เจอ" แต่เป็นตัวแปรที่ไม่มีใครประกาศ
// ซึ่งรู้ตัวได้ตอนรันบรรทัดนั้นเท่านั้น
//
// ตัวตรวจนี้จึงเป็น **การอ่านตัวหนังสือ ไม่ได้รันโค้ด**: ไล่หาทุกจุดที่เขียน `ชื่อ(` แล้ว
// ถามว่าชื่อนั้นถูก import / ประกาศ / เป็นพารามิเตอร์ / เป็นของที่มีอยู่ในภาษา หรือไม่
// ไม่ใช่ linter ครบเครื่อง แต่ดักบั๊กชนิดที่เพิ่งหลุดไปได้ทั้งชนิด ด้วยศูนย์ dependency
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, check, group, summarize } from './lib/harness.mjs'

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// ตรวจฝั่งหน้าจอด้วย — ลืม import ในหน้าใดหน้าหนึ่งก็พังแบบเดียวกัน (หน้าเปล่า/error ตอนกด)
const roots = [
  path.join(projectRoot, 'src', 'main'),
  path.join(projectRoot, 'src', 'renderer', 'src')
]

// ของที่ภาษา/สภาพแวดล้อมมีให้อยู่แล้ว ไม่ต้อง import
const GLOBALS = new Set([
  'console', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'Error', 'TypeError', 'RangeError', 'Promise', 'Set', 'Map', 'WeakMap', 'RegExp',
  'Symbol', 'BigInt', 'Buffer', 'URL', 'process', 'require', 'fetch', 'structuredClone',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask',
  // ของที่เบราว์เซอร์มีให้ (ใช้ในฝั่งหน้าจอ) — atob/Blob ใช้ตอนแปลง PDF ที่ส่งมาจาก main
  // ให้ตัวอ่านของ Chromium แสดง
  'atob', 'btoa', 'Blob', 'File', 'FileReader', 'FormData', 'Image', 'alert',
  'requestAnimationFrame', 'cancelAnimationFrame', 'window', 'document', 'navigator'
])

// คำที่ตามด้วยวงเล็บได้แต่ไม่ใช่การเรียกฟังก์ชัน
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'instanceof',
  'await', 'async', 'new', 'delete', 'void', 'do', 'else', 'try', 'throw', 'yield',
  'in', 'of', 'case', 'default', 'export', 'import', 'const', 'let', 'var', 'class',
  'extends', 'super', 'this', 'true', 'false', 'null', 'undefined'
])

function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listJsFiles(full)
    return /\.jsx?$/.test(entry.name) ? [full] : []
  })
}

// ตัดคอมเมนต์กับข้อความในเครื่องหมายคำพูดออกก่อน ไม่งั้นชื่อที่ถูกพูดถึงในคอมเมนต์
// (ซึ่งไฟล์นี้ทั้งโปรเจกต์มีเยอะมาก) จะถูกนับเป็นการเรียกใช้จริง
function stripNoise(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""')
}

// ชื่อทุกชื่อที่ "มีที่มา" ในไฟล์นี้: import / ประกาศ / พารามิเตอร์ / ชื่อที่ผูกใน catch
//
// เก็บแบบกว้างโดยตั้งใจ — พลาดฝั่งเก็บไม่ครบจะได้ผลบวกลวงซึ่งทำให้คนเลิกเชื่อตัวตรวจ
// ส่วนเก็บเกินไปหน่อยยังจับบั๊กที่ตั้งใจจับได้อยู่ (ชื่อที่ไม่มีอยู่ในไฟล์เลยจริงๆ)
function collectDeclared(code) {
  const names = new Set()
  const add = (raw) => {
    for (const token of String(raw).match(/[A-Za-z_$][\w$]*/g) ?? []) names.add(token)
  }

  // import { a, b as c } from '...' · import d from '...' · import * as ns from '...'
  for (const match of code.matchAll(/import\s+([\s\S]*?)\s+from\s+/g)) add(match[1])
  // ประกาศทุกชนิด (รวม const { a, b } = ... ซึ่ง add() จะเก็บชื่อในวงเล็บปีกกาให้)
  for (const match of code.matchAll(/\b(?:function\s*\*?|class|const|let|var)\s+([^=;\n{]*)/g)) {
    add(match[1])
  }
  for (const match of code.matchAll(/\b(?:const|let|var)\s*(\{[^}]*\}|\[[^\]]*\])/g)) add(match[1])
  // พารามิเตอร์: ทั้งของ function ปกติ, arrow function และ catch
  for (const match of code.matchAll(/\bfunction\s*\*?\s*[\w$]*\s*\(([^)]*)\)/g)) add(match[1])
  for (const match of code.matchAll(/\(([^()]*)\)\s*=>/g)) add(match[1])
  for (const match of code.matchAll(/(?:^|[\s(,])([\w$]+)\s*=>/gm)) add(match[1])
  for (const match of code.matchAll(/\bcatch\s*\(([^)]*)\)/g)) add(match[1])
  // เมธอดในคลาส/ออบเจกต์ (`name() {` · `static name() {`) — ถูกเรียกผ่านจุดหรือผ่านคลาส
  // อยู่แล้ว แต่เก็บไว้กันพลาด (React เรียก getDerivedStateFromError ให้เอง)
  for (const match of code.matchAll(/^\s*(?:static\s+)?(?:async\s+)?([\w$]+)\s*\([^)]*\)\s*\{/gm)) {
    add(match[1])
  }

  return names
}

// ทุกจุดที่เขียน `ชื่อ(` โดยที่ตัวอักษรก่อนหน้าไม่ใช่จุด (ไม่ใช่การเรียกเมธอดของออบเจกต์)
function collectCalls(code) {
  const calls = new Map()
  for (const match of code.matchAll(/(^|[^\w$.?])([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const name = match[2]
    if (KEYWORDS.has(name)) continue
    if (!calls.has(name)) calls.set(name, match.index)
  }
  return calls
}

// -----------------------------------------------------
group('ทุกชื่อที่ถูกเรียกใช้ต้องมีที่มา')

const files = roots.flatMap((dir) => listJsFiles(dir))

check(`มีไฟล์ให้ตรวจจริง (${files.length} ไฟล์)`, () => {
  assert(files.length > 60, `เจอแค่ ${files.length} ไฟล์ — เส้นทางน่าจะผิด`)
})

for (const file of files) {
  const relative = path.relative(projectRoot, file).replace(/\\/g, '/')
  const code = stripNoise(fs.readFileSync(file, 'utf8'))
  const declared = collectDeclared(code)

  check(relative, () => {
    const missing = []
    for (const [name] of collectCalls(code)) {
      if (declared.has(name) || GLOBALS.has(name)) continue
      missing.push(name)
    }
    assert(
      missing.length === 0,
      `เรียกใช้แต่ไม่มีที่มา (ลืม import?): ${missing.join(', ')}`
    )
  })
}

summarize('ทุกชื่อที่ถูกเรียกใช้ (ทั้ง main และหน้าจอ) มี import หรือการประกาศรองรับ')
