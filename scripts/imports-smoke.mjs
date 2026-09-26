// ตรวจว่าทุกฟังก์ชันที่ถูก "เรียก" ในโค้ดฝั่ง main มีที่มาจริง — รันด้วย: npm run test:imports
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, check, group, summarize } from './lib/harness.mjs'

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = [
  path.join(projectRoot, 'src', 'main'),
  path.join(projectRoot, 'src', 'renderer', 'src')
]

const GLOBALS = new Set([
  'console', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'Error', 'TypeError', 'RangeError', 'Promise', 'Set', 'Map', 'WeakMap', 'RegExp',
  'Symbol', 'BigInt', 'Buffer', 'URL', 'process', 'require', 'fetch', 'structuredClone',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask',
  'atob', 'btoa', 'Blob', 'File', 'FileReader', 'FormData', 'Image', 'alert',
  'requestAnimationFrame', 'cancelAnimationFrame', 'window', 'document', 'navigator'
])

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

function stripNoise(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""')
}

function collectDeclared(code) {
  const names = new Set()
  const add = (raw) => {
    for (const token of String(raw).match(/[A-Za-z_$][\w$]*/g) ?? []) names.add(token)
  }

  for (const match of code.matchAll(/import\s+([\s\S]*?)\s+from\s+/g)) add(match[1])
  for (const match of code.matchAll(/\b(?:function\s*\*?|class|const|let|var)\s+([^=;\n{]*)/g)) {
    add(match[1])
  }
  for (const match of code.matchAll(/\b(?:const|let|var)\s*(\{[^}]*\}|\[[^\]]*\])/g)) add(match[1])
  for (const match of code.matchAll(/\bfunction\s*\*?\s*[\w$]*\s*\(([^)]*)\)/g)) add(match[1])
  for (const match of code.matchAll(/\(([^()]*)\)\s*=>/g)) add(match[1])
  for (const match of code.matchAll(/(?:^|[\s(,])([\w$]+)\s*=>/gm)) add(match[1])
  for (const match of code.matchAll(/\bcatch\s*\(([^)]*)\)/g)) add(match[1])
  for (const match of code.matchAll(/^\s*(?:static\s+)?(?:async\s+)?([\w$]+)\s*\([^)]*\)\s*\{/gm)) {
    add(match[1])
  }

  return names
}

function collectCalls(code) {
  const calls = new Map()
  for (const match of code.matchAll(/(^|[^\w$.?])([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const name = match[2]
    if (KEYWORDS.has(name)) continue
    if (!calls.has(name)) calls.set(name, match.index)
  }
  return calls
}

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
