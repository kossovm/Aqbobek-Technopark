export type CellColor = 'green' | 'blue' | 'purple'

export const CELL_COLORS: Record<CellColor, { bg: string; text: string; border: string; hex: string; label: string; rule: string }> = {
  green: {
    bg: 'bg-[#32ba68]',
    text: 'text-white',
    border: 'border-[#32ba68]',
    hex: '#32ba68',
    label: 'Зелёная',
    rule: 'Свободно для всех',
  },
  blue: {
    bg: 'bg-[#2567e7]',
    text: 'text-white',
    border: 'border-[#2567e7]',
    hex: '#2567e7',
    label: 'Синяя',
    rule: 'Только для своего проекта или с разрешения учителя',
  },
  purple: {
    bg: 'bg-[#6300a1]',
    text: 'text-white',
    border: 'border-[#6300a1]',
    hex: '#6300a1',
    label: 'Фиолетовая',
    rule: 'Только учителям; ученикам — с разрешения учителя',
  },
}

/** Префикс для QR-кодов ячеек, чтобы отличать от инвентаря (AQB-...). */
export const CELL_QR_PREFIX = 'CELL-'

export function isCellQR(qr: string): boolean {
  return qr.toUpperCase().startsWith(CELL_QR_PREFIX)
}

export function isInventoryQR(qr: string): boolean {
  return qr.toUpperCase().startsWith('AQB-') && !isCellQR(qr)
}

const cellCodeRe = /^[А-ЯA-Z]\d{2}$/i

/** Валидация формата кода ячейки: одна буква + 2 цифры (И02, П01). */
export function isValidCellCode(code: string): boolean {
  return cellCodeRe.test(code.trim())
}
