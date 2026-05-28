'use client'

import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import JsBarcode from 'jsbarcode'

export type LabelFormat = 'qr' | 'code128'

export type LabelItem = {
  qrCode: string
  name: string
  /** Если задан, этикетка считается «ячеечной» — выводим цветной бейдж с кодом. */
  cellCode?: string
  cellColor?: 'green' | 'blue' | 'purple'
}

interface Props {
  items: LabelItem[] | null
  format: LabelFormat
  /** Срабатывает после window.print() диалога — родитель должен очистить items. */
  onAfterPrint?: () => void
}

/**
 * Печать через скрытый iframe. Это самый надёжный способ:
 *   - не зависит от стилей родительской страницы;
 *   - не нужны @media print трюки с display:none у родителей;
 *   - размер страницы 40×30 мм фиксируется внутри iframe.
 *
 * Когда меняется prop items (с null на массив), мы:
 *   1. Генерим SVG QR (через пакет qrcode) и Code128 (через jsbarcode).
 *   2. Создаём iframe, пишем туда полный HTML с print-стилями.
 *   3. Вызываем iframe.contentWindow.print().
 *   4. После закрытия диалога печати удаляем iframe и зовём onAfterPrint.
 */
export default function PrintableLabel({ items, format, onAfterPrint }: Props) {
  const printedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!items || items.length === 0) return
    const fingerprint = JSON.stringify({ format, items })
    if (printedRef.current === fingerprint) return
    printedRef.current = fingerprint

    let cancelled = false
    ;(async () => {
      const html = await buildPrintDocument(items, format)
      if (cancelled) return
      runPrint(html, () => {
        printedRef.current = null
        onAfterPrint?.()
      })
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, format])

  return null
}

// ─── Генерация HTML документа ───────────────────────────────────────────────

async function buildPrintDocument(items: LabelItem[], format: LabelFormat): Promise<string> {
  const labelsHtml = (await Promise.all(items.map((it) => buildLabelHtml(it, format)))).join('\n')

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Этикетки</title>
<style>
  @page { size: 40mm 30mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body {
    margin: 0; padding: 0; background: white; color: black;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .label {
    width: 40mm; height: 30mm;
    display: flex; align-items: center; justify-content: center;
    padding: 1mm;
    page-break-after: always;
    break-after: page;
    overflow: hidden;
  }
  .label:last-child { page-break-after: auto; }

  /* QR layout: QR слева, текст справа в столбик */
  .qr-wrap {
    display: flex; flex-direction: row; align-items: center; gap: 1.5mm;
    width: 100%; height: 100%;
  }
  .qr-img { width: 25mm; height: 25mm; flex-shrink: 0; }
  .qr-img svg { width: 100%; height: 100%; display: block; }
  .qr-text { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 0.5mm; line-height: 1.05; }
  .qr-num { font-family: 'Courier New', monospace; font-weight: 800; font-size: 8pt; letter-spacing: 0.2px; }
  .qr-name {
    font-size: 7pt; font-weight: 600; word-break: break-word;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }

  /* Цветной бейдж кода ячейки (большой) */
  .cell-badge {
    display: inline-block;
    padding: 0.5mm 1.5mm;
    border-radius: 1mm;
    color: white;
    font-family: 'Courier New', monospace;
    font-weight: 900;
    font-size: 11pt;
    letter-spacing: 0.5px;
    line-height: 1;
  }
  .cell-badge.green  { background: #32ba68; }
  .cell-badge.blue   { background: #2567e7; }
  .cell-badge.purple { background: #6300a1; }

  /* Code128 layout: штрихкод сверху, ниже № жирно, ниже название */
  .bc-wrap {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 0.6mm; width: 100%; height: 100%;
  }
  .bc-img { width: 36mm; height: 14mm; }
  .bc-img svg { width: 100%; height: 100%; display: block; }
  .bc-num { font-family: 'Courier New', monospace; font-weight: 800; font-size: 9pt; }
  .bc-name {
    font-size: 7pt; font-weight: 600; text-align: center; line-height: 1; word-break: break-word; max-width: 38mm;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
</style>
</head>
<body>
${labelsHtml}
</body>
</html>`
}

async function buildLabelHtml(item: LabelItem, format: LabelFormat): Promise<string> {
  const safeNum = escapeHtml(item.qrCode)
  const safeName = escapeHtml(item.name)
  const isCell = !!item.cellCode

  // Бейдж кода ячейки вместо названия (если это ячейка)
  const captionHtml = isCell
    ? `<span class="cell-badge ${item.cellColor ?? 'green'}">${escapeHtml(item.cellCode!)}</span>`
    : safeName

  const numHtml = safeNum

  if (format === 'qr') {
    const svg = await renderQRSvg(item.qrCode)
    return `<div class="label">
  <div class="qr-wrap">
    <div class="qr-img">${svg}</div>
    <div class="qr-text">
      <div class="qr-num">${numHtml}</div>
      <div class="qr-name">${captionHtml}</div>
    </div>
  </div>
</div>`
  }

  const svg = renderBarcodeSvg(item.qrCode)
  return `<div class="label">
  <div class="bc-wrap">
    <div class="bc-img">${svg}</div>
    <div class="bc-num">${numHtml}</div>
    <div class="bc-name">${captionHtml}</div>
  </div>
</div>`
}

// ─── Генерация SVG для QR через qrcode пакет ─────────────────────────────────

async function renderQRSvg(value: string): Promise<string> {
  try {
    const svg = await QRCode.toString(value, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 0,
      color: { dark: '#000000', light: '#ffffff' },
    })
    return svg
  } catch (e) {
    console.error('QR generation failed', e)
    return `<text>${escapeHtml(value)}</text>`
  }
}

// ─── Генерация SVG штрихкода через JsBarcode (нужен реальный SVG элемент) ────

function renderBarcodeSvg(value: string): string {
  if (typeof document === 'undefined') return ''
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try {
    JsBarcode(svg, value, {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      height: 50,
      width: 1.6,
      background: '#ffffff',
      lineColor: '#000000',
    })
  } catch (e) {
    console.error('Barcode generation failed', e)
    return `<text>${escapeHtml(value)}</text>`
  }
  return new XMLSerializer().serializeToString(svg)
}

// ─── Утилиты ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function runPrint(html: string, onDone: () => void) {
  if (typeof window === 'undefined') return

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  iframe.style.pointerEvents = 'none'
  document.body.appendChild(iframe)

  const cleanup = () => {
    try { document.body.removeChild(iframe) } catch {}
    onDone()
  }

  let alreadyCleaned = false
  const safeCleanup = () => {
    if (alreadyCleaned) return
    alreadyCleaned = true
    cleanup()
  }

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) {
    safeCleanup()
    return
  }
  doc.open()
  doc.write(html)
  doc.close()

  // Ждём загрузки шрифтов / SVG
  const printNow = () => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } catch (e) {
      console.error('print failed', e)
    }
    // На большинстве браузеров afterprint срабатывает синхронно при закрытии диалога.
    // На случай, если нет — fallback по таймеру.
    iframe.contentWindow?.addEventListener('afterprint', safeCleanup)
    setTimeout(safeCleanup, 4000)
  }

  if (iframe.contentDocument?.readyState === 'complete') {
    setTimeout(printNow, 50)
  } else {
    iframe.addEventListener('load', () => setTimeout(printNow, 50))
  }
}
