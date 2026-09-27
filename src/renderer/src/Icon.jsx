// ไอคอน SVG ในเครื่อง (?raw) ย้อมสีตาม currentColor · เพิ่มไอคอน: import แล้วใส่ใน ICONS
import dashboard from './assets/icons/heroicons/24/outline/squares-2x2.svg?raw'
import apartments from './assets/icons/heroicons/24/outline/building-office-2.svg?raw'
import rooms from './assets/icons/heroicons/24/outline/key.svg?raw'
import tenants from './assets/icons/heroicons/24/outline/users.svg?raw'
import contracts from './assets/icons/heroicons/24/outline/document-text.svg?raw'
import bookings from './assets/icons/heroicons/24/outline/calendar-days.svg?raw'
import calendar from './assets/icons/heroicons/24/outline/calendar-days.svg?raw'
import meters from './assets/icons/heroicons/24/outline/bolt.svg?raw'
import invoices from './assets/icons/heroicons/24/outline/receipt-percent.svg?raw'
import payments from './assets/icons/heroicons/24/outline/banknotes.svg?raw'
import moveOuts from './assets/icons/heroicons/24/outline/user-minus.svg?raw'
import maintenance from './assets/icons/heroicons/24/outline/wrench-screwdriver.svg?raw'
import settings from './assets/icons/heroicons/24/outline/cog-6-tooth.svg?raw'
import eye from './assets/icons/heroicons/24/outline/eye.svg?raw'
import eyeOff from './assets/icons/heroicons/24/outline/eye-slash.svg?raw'
import lock from './assets/icons/heroicons/24/outline/lock-closed.svg?raw'
import shield from './assets/icons/heroicons/24/outline/shield-check.svg?raw'
import warning from './assets/icons/heroicons/24/outline/exclamation-triangle.svg?raw'
import check from './assets/icons/heroicons/24/outline/check-circle.svg?raw'
import checkSolid from './assets/icons/heroicons/24/solid/check-circle.svg?raw'
import warningSolid from './assets/icons/heroicons/24/solid/exclamation-circle.svg?raw'
import copy from './assets/icons/heroicons/24/outline/clipboard-document.svg?raw'
import minusCircle from './assets/icons/heroicons/24/outline/minus-circle.svg?raw'
import close from './assets/icons/heroicons/24/outline/x-mark.svg?raw'
import info from './assets/icons/heroicons/24/outline/information-circle.svg?raw'
import plus from './assets/icons/heroicons/24/outline/plus.svg?raw'
import search from './assets/icons/heroicons/24/outline/magnifying-glass.svg?raw'
import chevronDown from './assets/icons/heroicons/24/outline/chevron-down.svg?raw'
import chevronLeft from './assets/icons/heroicons/24/outline/chevron-left.svg?raw'
import chevronRight from './assets/icons/heroicons/24/outline/chevron-right.svg?raw'
import trash from './assets/icons/heroicons/24/outline/trash.svg?raw'
import back from './assets/icons/heroicons/24/outline/arrow-left.svg?raw'
import logoutIcon from './assets/icons/heroicons/24/outline/arrow-right-on-rectangle.svg?raw'
import account from './assets/icons/heroicons/24/outline/user-circle.svg?raw'
import electric from './assets/icons/heroicons/24/solid/bolt.svg?raw'
import water from './assets/icons/custom/water-drop.svg?raw'
import printer from './assets/icons/heroicons/24/outline/printer.svg?raw'
import download from './assets/icons/heroicons/24/outline/arrow-down-tray.svg?raw'
import upload from './assets/icons/heroicons/24/outline/arrow-up-tray.svg?raw'

const ICONS = {
  dashboard,
  apartments,
  rooms,
  tenants,
  contracts,
  bookings,
  meters,
  invoices,
  payments,
  moveOuts,
  maintenance,
  settings,
  eye,
  eyeOff,
  lock,
  shield,
  warning,
  check,
  checkSolid,
  warningSolid,
  minusCircle,
  close,
  info,
  plus,
  search,
  chevronDown,
  chevronLeft,
  chevronRight,
  trash,
  copy,
  back,
  logout: logoutIcon,
  account,
  water,
  electric,
  calendar,
  printer,
  download,
  upload
}

export default function Icon({ name, className = '' }) {
  const svg = ICONS[name]
  if (!svg) return null

  return (
    <span
      className={`icon ${className}`.trim()}
      aria-hidden="true"
      // ปลอดภัย — SVG มาจากไฟล์ในโปรเจกต์
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
