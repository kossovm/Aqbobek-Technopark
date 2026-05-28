'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  getLocationsWithCells, updateLocation, deleteLocation,
  bulkAddCells, updateCell, deleteCell, markCellLabelsPrinted,
  placeCell,
  type NewCellInput,
} from '@/app/actions/cells'
import { createLocation } from '@/app/actions/inventory'
import { CELL_COLORS, isValidCellCode, type CellColor } from '@/lib/cells'
import { createClient } from '@/utils/supabase/client'
import PrintableLabel, { type LabelFormat, type LabelItem } from './PrintableLabel'
import {
  Plus, Loader2, Trash2, Save, Image as ImageIcon, Printer,
  Upload, Pencil, ListPlus, Grid2x2, GripVertical, Eraser,
} from 'lucide-react'

type Cell = {
  id: string
  code: string
  color: CellColor
  qr_code: string
  label_printed: boolean
  position_row: number | null
  position_col: number | null
}

type Location = {
  id: string
  name: string
  description: string | null
  image_url: string | null
  grid_rows: number | null
  grid_cols: number | null
  cells: Cell[]
}

type CellRow = {
  id: string
  code: string
  color: CellColor
  status?: 'ok' | 'error'
  errorMsg?: string
}

const newCellRow = (): CellRow => ({
  id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID() : `r_${Math.random().toString(36).slice(2)}`,
  code: '',
  color: 'green',
})

export default function LocationsManagement() {
  const { toast } = useToast()
  const [locations, setLocations] = useState<Location[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // ─── New location dialog
  const [newOpen, setNewOpen] = useState(false)
  const [nlName, setNlName] = useState('')
  const [nlDesc, setNlDesc] = useState('')
  const [nlFile, setNlFile] = useState<File | null>(null)
  const [nlPreview, setNlPreview] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // ─── Edit location
  const [editLoc, setEditLoc] = useState<Location | null>(null)
  const [elName, setElName] = useState('')
  const [elDesc, setElDesc] = useState('')
  const [elFile, setElFile] = useState<File | null>(null)
  const [elPreview, setElPreview] = useState<string | null>(null)
  const [elRows, setElRows] = useState<string>('')
  const [elCols, setElCols] = useState<string>('')

  // ─── Bulk add cells
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkLoc, setBulkLoc] = useState<Location | null>(null)
  const [cellRows, setCellRows] = useState<CellRow[]>([newCellRow()])
  const [isBulkSaving, setIsBulkSaving] = useState(false)

  // ─── Print
  const [labelsToPrint, setLabelsToPrint] = useState<LabelItem[] | null>(null)
  const [labelFormat, setLabelFormat] = useState<LabelFormat>('qr')

  // ─── Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = async () => {
    setIsLoading(true)
    try {
      const data = await getLocationsWithCells()
      setLocations(data as Location[])
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // ─── Загрузка картинки локации в Storage ────────────────────────────────
  async function uploadImage(file: File): Promise<string> {
    const supabase = createClient()
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    const path = `maps/${filename}`
    const { error } = await supabase.storage
      .from('location-maps')
      .upload(path, file, { cacheControl: '3600', upsert: false })
    if (error) throw new Error('Загрузка карты: ' + error.message)
    const { data } = supabase.storage.from('location-maps').getPublicUrl(path)
    return data.publicUrl
  }

  // ─── Create location ────────────────────────────────────────────────────
  const handleCreateLocation = async () => {
    if (!nlName.trim()) {
      toast({ title: 'Введите название', variant: 'destructive' })
      return
    }
    setIsCreating(true)
    try {
      let imageUrl: string | null = null
      if (nlFile) imageUrl = await uploadImage(nlFile)

      const res = await createLocation({ name: nlName, description: nlDesc || null })
      if ('error' in res && res.error) throw new Error(res.error)

      // Получаем созданный id и проставляем картинку
      if (imageUrl) {
        const all = await getLocationsWithCells()
        const created = (all as Location[]).find((l) => l.name === nlName.trim())
        if (created) await updateLocation(created.id, { image_url: imageUrl })
      }

      toast({ title: 'Создано' })
      setNewOpen(false)
      setNlName(''); setNlDesc(''); setNlFile(null); setNlPreview(null)
      load()
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsCreating(false)
    }
  }

  // ─── Edit location ──────────────────────────────────────────────────────
  const openEdit = (loc: Location) => {
    setEditLoc(loc)
    setElName(loc.name); setElDesc(loc.description ?? '')
    setElFile(null); setElPreview(loc.image_url)
    setElRows(loc.grid_rows ? String(loc.grid_rows) : '')
    setElCols(loc.grid_cols ? String(loc.grid_cols) : '')
  }
  const handleEditSave = async () => {
    if (!editLoc || !elName.trim()) return
    try {
      const patch: any = { name: elName, description: elDesc || null }
      if (elFile) {
        patch.image_url = await uploadImage(elFile)
      }
      const rowsNum = elRows.trim() === '' ? null : parseInt(elRows, 10)
      const colsNum = elCols.trim() === '' ? null : parseInt(elCols, 10)
      if (rowsNum !== null && (Number.isNaN(rowsNum) || rowsNum < 1)) {
        return toast({ title: 'Строк', description: 'Должно быть число ≥ 1', variant: 'destructive' })
      }
      if (colsNum !== null && (Number.isNaN(colsNum) || colsNum < 1)) {
        return toast({ title: 'Столбцов', description: 'Должно быть число ≥ 1', variant: 'destructive' })
      }
      patch.grid_rows = rowsNum
      patch.grid_cols = colsNum

      const res = await updateLocation(editLoc.id, patch)
      if (res.error) throw new Error(res.error)
      toast({ title: 'Сохранено' })
      setEditLoc(null)
      load()
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    }
  }
  const handleDeleteLocation = async (loc: Location) => {
    if (!confirm(`Удалить локацию «${loc.name}»?`)) return
    const res = await deleteLocation(loc.id)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: 'Удалено' }); load() }
  }

  // ─── Bulk add cells ─────────────────────────────────────────────────────
  const openBulk = (loc: Location) => {
    setBulkLoc(loc); setCellRows([newCellRow()]); setBulkOpen(true)
  }
  const updateCellRow = (id: string, patch: Partial<CellRow>) =>
    setCellRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch, status: undefined } : r))
  const addCellRow = () => setCellRows((prev) => [...prev, newCellRow()])
  const removeCellRow = (id: string) => setCellRows((prev) =>
    prev.length <= 1 ? [newCellRow()] : prev.filter((r) => r.id !== id)
  )

  const handleBulkSave = async () => {
    if (!bulkLoc) return
    const items: NewCellInput[] = cellRows
      .filter((r) => r.code.trim())
      .map((r) => ({ location_id: bulkLoc.id, code: r.code.trim().toUpperCase(), color: r.color }))
    if (items.length === 0) {
      toast({ title: 'Пусто', description: 'Заполните хотя бы одну строку', variant: 'destructive' })
      return
    }
    setIsBulkSaving(true)
    const res = await bulkAddCells(items)
    setIsBulkSaving(false)
    if ('error' in res && res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      return
    }
    const errMap = new Map((res.errors ?? []).map((e) => [e.code, e.error]))
    setCellRows((prev) => prev.map((r) => {
      const code = r.code.trim().toUpperCase()
      if (errMap.has(code)) return { ...r, status: 'error', errorMsg: errMap.get(code) }
      if (r.code.trim()) return { ...r, status: 'ok' }
      return r
    }))
    toast({
      title: 'Готово',
      description: `Создано: ${res.created?.length ?? 0}. Ошибок: ${res.errors?.length ?? 0}.`,
    })

    // Сразу предложить распечатать
    const created = res.created ?? []
    if (created.length > 0 && confirm(`Распечатать ${created.length} этикеток ячеек?`)) {
      const items: LabelItem[] = created.map((c: any) => ({
        qrCode: c.qr_code, name: bulkLoc.name, cellCode: c.code, cellColor: c.color,
      }))
      printLabels(items)
      await markCellLabelsPrinted(created.map((c: any) => c.id))
    }
    load()
  }

  // ─── Inline edit cell color/code ────────────────────────────────────────
  const handleSetColor = async (cellId: string, color: CellColor) => {
    const res = await updateCell(cellId, { color })
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else load()
  }
  const handleDeleteCell = async (cell: Cell) => {
    if (!confirm(`Удалить ячейку ${cell.code}?`)) return
    const res = await deleteCell(cell.id)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: 'Удалено' }); load() }
  }

  // ─── Drag-and-drop ячеек по сетке ───────────────────────────────────────
  const [dragId, setDragId] = useState<string | null>(null)

  const handleDragStart = (cellId: string) => (e: React.DragEvent) => {
    setDragId(cellId)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', cellId) } catch {}
  }
  const handleDragEnd = () => setDragId(null)
  const allowDrop = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }

  const handleDropOnSlot = (row: number | null, col: number | null) => async (e: React.DragEvent) => {
    e.preventDefault()
    const cellId = dragId || e.dataTransfer.getData('text/plain')
    setDragId(null)
    if (!cellId) return
    const res = await placeCell(cellId, row, col)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else load()
  }

  // ─── Print ──────────────────────────────────────────────────────────────
  const printLabels = (items: LabelItem[]) => setLabelsToPrint(items)

  const handlePrintCell = async (loc: Location, cell: Cell) => {
    printLabels([{
      qrCode: cell.qr_code, name: loc.name, cellCode: cell.code, cellColor: cell.color,
    }])
    if (!cell.label_printed) await markCellLabelsPrinted([cell.id])
    load()
  }

  const handleBulkPrint = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    const items: LabelItem[] = []
    for (const loc of locations) {
      for (const c of loc.cells) {
        if (ids.includes(c.id)) {
          items.push({ qrCode: c.qr_code, name: loc.name, cellCode: c.code, cellColor: c.color })
        }
      }
    }
    printLabels(items)
    await markCellLabelsPrinted(ids)
    setSelected(new Set())
    load()
  }

  const toggleSelect = (id: string) => setSelected((p) => {
    const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s
  })

  // ─── Cell chip (общий рендер ячейки внутри карточки локации) ────────────
  const renderCellChip = (cell: Cell, loc: Location, opts: { compact?: boolean } = {}) => {
    const c = CELL_COLORS[cell.color]
    const isSel = selected.has(cell.id)
    const isDragging = dragId === cell.id
    return (
      <div
        key={cell.id}
        className={`relative group ${opts.compact ? 'w-12' : ''}`}
        draggable
        onDragStart={handleDragStart(cell.id)}
        onDragEnd={handleDragEnd}
      >
        <button
          type="button"
          onClick={() => toggleSelect(cell.id)}
          className={`relative w-full aspect-square rounded-md flex flex-col items-center justify-center text-xs font-bold transition-all border-2 cursor-grab active:cursor-grabbing ${
            isSel ? 'ring-2 ring-offset-2 ring-primary scale-95' : ''
          } ${isDragging ? 'opacity-40' : ''}`}
          style={{
            backgroundColor: c.hex,
            color: '#ffffff',
            borderColor: c.hex,
          }}
          title={`${cell.code} · ${c.label}\n${cell.qr_code}\nПеретащите в слот сетки`}
        >
          <GripVertical className="absolute top-0.5 left-0.5 w-2.5 h-2.5 opacity-50" />
          <span className="drop-shadow">{cell.code}</span>
          {!cell.label_printed && (
            <span className="text-[7px] opacity-90 mt-0.5">NEW</span>
          )}
        </button>
        <div className="absolute inset-x-0 -bottom-1 translate-y-full opacity-0 group-hover:opacity-100 transition-opacity z-10 flex justify-center gap-0.5 pointer-events-none">
          <div className="bg-popover border shadow-md rounded-md p-1 flex gap-0.5 pointer-events-auto">
            {(['green', 'blue', 'purple'] as CellColor[]).map((col) => (
              <button
                key={col}
                onClick={(e) => { e.stopPropagation(); handleSetColor(cell.id, col) }}
                className={`w-4 h-4 rounded ${
                  cell.color === col ? 'ring-2 ring-offset-1 ring-foreground' : ''
                }`}
                style={{ backgroundColor: CELL_COLORS[col].hex }}
                title={CELL_COLORS[col].label}
              />
            ))}
            <button
              onClick={(e) => { e.stopPropagation(); handlePrintCell(loc, cell) }}
              className="text-foreground hover:bg-muted rounded px-1 text-[10px]"
              title="Печать"
            >
              <Printer className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeleteCell(cell) }}
              className="text-destructive hover:bg-destructive/10 rounded px-1"
              title="Удалить"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Локации и ячейки</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Каждая локация — шкаф / стол / зона. Внутри неё ячейки трёх цветов:
            <span className="ml-1 inline-block w-3 h-3 rounded-sm align-middle" style={{ background: '#32ba68' }} /> зелёные,
            <span className="ml-1 inline-block w-3 h-3 rounded-sm align-middle" style={{ background: '#2567e7' }} /> синие,
            <span className="ml-1 inline-block w-3 h-3 rounded-sm align-middle" style={{ background: '#6300a1' }} /> фиолетовые.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="w-4 h-4 mr-1" /> Новая локация
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border rounded-xl px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Этикетка:</span>
          <Select value={labelFormat} onValueChange={(v) => setLabelFormat(v as LabelFormat)}>
            <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="qr">QR + бейдж кода</SelectItem>
              <SelectItem value="code128">Штрихкод Code128</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {selected.size > 0 && (
          <Button size="sm" variant="outline" onClick={handleBulkPrint}>
            <Printer className="w-4 h-4 mr-1" /> Печать выбранных ({selected.size})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
      ) : locations.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-xl bg-card">
          Локаций нет. Создайте первую — например, «Металлический шкаф 3».
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {locations.map((loc) => (
            <div key={loc.id} className="border rounded-xl bg-card shadow-sm overflow-hidden">
              {/* Header с картой */}
              <div className="relative bg-muted/30">
                {loc.image_url ? (
                  <img src={loc.image_url} alt={loc.name} className="w-full aspect-[4/3] object-contain bg-muted" />
                ) : (
                  <div className="w-full aspect-[4/3] flex items-center justify-center text-muted-foreground bg-muted">
                    <ImageIcon className="w-10 h-10 opacity-30" />
                  </div>
                )}
                <div className="absolute top-2 right-2 flex gap-1">
                  <Button size="icon" variant="secondary" className="h-8 w-8" onClick={() => openEdit(loc)} title="Изменить">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="destructive" className="h-8 w-8" onClick={() => handleDeleteLocation(loc)} title="Удалить">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-bold text-lg truncate">{loc.name}</h3>
                    {loc.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{loc.description}</p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openBulk(loc)} className="flex-shrink-0">
                    <ListPlus className="w-4 h-4 mr-1" /> Ячейки
                  </Button>
                </div>

                {loc.cells.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded-lg">
                    Ещё нет ячеек
                  </div>
                ) : loc.grid_rows && loc.grid_cols ? (
                  <CellGridLayout
                    loc={loc}
                    selected={selected}
                    dragId={dragId}
                    onChip={renderCellChip}
                    allowDrop={allowDrop}
                    onDropSlot={handleDropOnSlot}
                  />
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                    {loc.cells.map((cell) => renderCellChip(cell, loc))}
                  </div>
                )}

                {/* Незаполненные позиции (если grid задан и есть ячейки без позиции) */}
                {loc.grid_rows && loc.grid_cols && loc.cells.some((c) => c.position_row === null || c.position_col === null) && (
                  <div
                    className="border border-dashed rounded-lg p-2 bg-muted/30"
                    onDragOver={allowDrop}
                    onDrop={handleDropOnSlot(null, null)}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                      <Eraser className="w-3 h-3" /> Не размещены — перетащите в сетку
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {loc.cells
                        .filter((c) => c.position_row === null || c.position_col === null)
                        .map((cell) => renderCellChip(cell, loc, { compact: true }))}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground pt-1">
                  <span>Зелёных: <b>{loc.cells.filter((c) => c.color === 'green').length}</b></span>
                  <span>Синих: <b>{loc.cells.filter((c) => c.color === 'blue').length}</b></span>
                  <span>Фиолетовых: <b>{loc.cells.filter((c) => c.color === 'purple').length}</b></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New location dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Новая локация</DialogTitle>
            <DialogDescription>Например: «Металлический шкаф 3».</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input value={nlName} onChange={(e) => setNlName(e.target.value)} placeholder="Название" />
            <Input value={nlDesc} onChange={(e) => setNlDesc(e.target.value)} placeholder="Описание (опционально)" />
            <ImageDrop
              file={nlFile}
              preview={nlPreview}
              onFile={(f) => {
                setNlFile(f)
                setNlPreview(f ? URL.createObjectURL(f) : null)
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={isCreating}>Отмена</Button>
            <Button onClick={handleCreateLocation} disabled={isCreating}>
              {isCreating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit location dialog */}
      <Dialog open={!!editLoc} onOpenChange={(o) => !o && setEditLoc(null)}>
        <DialogContent className="sm:max-w-[480px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Изменить локацию</DialogTitle>
            <DialogDescription>
              Можно задать сетку — для шкафов, где ячейки физически расположены строками и столбцами.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input value={elName} onChange={(e) => setElName(e.target.value)} placeholder="Название" />
            <Input value={elDesc} onChange={(e) => setElDesc(e.target.value)} placeholder="Описание" />

            <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Grid2x2 className="w-4 h-4" /> Сетка ячеек <span className="text-xs text-muted-foreground font-normal">опционально</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Строк</label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={elRows}
                    onChange={(e) => setElRows(e.target.value)}
                    placeholder="напр. 4"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Столбцов</label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={elCols}
                    onChange={(e) => setElCols(e.target.value)}
                    placeholder="напр. 5"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Оставьте поля пустыми, если сетка не нужна. После сохранения перетаскивайте ячейки в нужные слоты прямо на карточке локации.
                Уменьшение размеров — не страшно: «выпавшие» ячейки автоматически снимутся в «Не размещены».
              </p>
            </div>

            <ImageDrop
              file={elFile}
              preview={elPreview}
              onFile={(f) => {
                setElFile(f)
                setElPreview(f ? URL.createObjectURL(f) : (editLoc?.image_url ?? null))
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLoc(null)}>Отмена</Button>
            <Button onClick={handleEditSave}><Save className="w-4 h-4 mr-1" /> Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk add cells dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ячейки: {bulkLoc?.name}</DialogTitle>
            <DialogDescription>
              Формат кода: буква + 2 цифры (И02, П01). После сохранения предложим напечатать этикетки.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {cellRows.map((row) => {
              const valid = !row.code || isValidCellCode(row.code.trim())
              return (
                <div key={row.id} className={`flex gap-2 items-center p-2 rounded-lg border ${
                  row.status === 'ok' ? 'bg-green-50 border-green-200' :
                  row.status === 'error' ? 'bg-red-50 border-red-200' :
                  'bg-card'
                }`}>
                  <Input
                    value={row.code}
                    onChange={(e) => updateCellRow(row.id, { code: e.target.value })}
                    placeholder="И02"
                    className="w-24 uppercase"
                    maxLength={5}
                    disabled={row.status === 'ok'}
                  />
                  <div className="flex gap-1">
                    {(['green', 'blue', 'purple'] as CellColor[]).map((c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={row.status === 'ok'}
                        onClick={() => updateCellRow(row.id, { color: c })}
                        className={`w-9 h-9 rounded-md ${
                          row.color === c ? 'ring-2 ring-offset-1 ring-foreground' : ''
                        } disabled:opacity-50`}
                        style={{ backgroundColor: CELL_COLORS[c].hex }}
                        title={CELL_COLORS[c].label}
                      />
                    ))}
                  </div>
                  <div className="flex-1 text-xs">
                    {row.status === 'ok'    && <span className="text-green-700 font-semibold">✓ Создана</span>}
                    {row.status === 'error' && <span className="text-red-700">{row.errorMsg}</span>}
                    {!row.status && !valid && <span className="text-amber-600">Формат: буква + 2 цифры</span>}
                  </div>
                  <Button
                    size="icon" variant="ghost" className="text-destructive hover:bg-destructive/10"
                    onClick={() => removeCellRow(row.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )
            })}
            <Button variant="outline" size="sm" onClick={addCellRow} className="w-full">
              <Plus className="w-4 h-4 mr-1" /> Ещё ячейка
            </Button>
          </div>
          {bulkLoc && bulkLoc.cells.length > 0 && (
            <div className="text-xs text-muted-foreground pt-2 border-t">
              Уже в этой локации: {bulkLoc.cells.map((c) => c.code).join(', ')}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={isBulkSaving}>Закрыть</Button>
            <Button onClick={handleBulkSave} disabled={isBulkSaving}>
              {isBulkSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Сохранить и печатать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PrintableLabel
        items={labelsToPrint}
        format={labelFormat}
        onAfterPrint={() => setLabelsToPrint(null)}
      />
    </div>
  )
}

function CellGridLayout({
  loc, selected: _selected, dragId, onChip, allowDrop, onDropSlot,
}: {
  loc: Location
  selected: Set<string>
  dragId: string | null
  onChip: (cell: Cell, loc: Location, opts?: { compact?: boolean }) => React.ReactNode
  allowDrop: (e: React.DragEvent) => void
  onDropSlot: (row: number | null, col: number | null) => (e: React.DragEvent) => void
}) {
  const rows = loc.grid_rows ?? 0
  const cols = loc.grid_cols ?? 0
  if (rows < 1 || cols < 1) return null

  const placed = new Map<string, Cell>()
  for (const c of loc.cells) {
    if (c.position_row !== null && c.position_col !== null) {
      placed.set(`${c.position_row}-${c.position_col}`, c)
    }
  }

  return (
    <div
      className="grid gap-1.5 p-2 rounded-lg bg-muted/40 border"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: rows }).flatMap((_, r) =>
        Array.from({ length: cols }).map((__, c) => {
          const cell = placed.get(`${r}-${c}`)
          const isDropTarget = !!dragId
          return (
            <div
              key={`${r}-${c}`}
              onDragOver={allowDrop}
              onDrop={onDropSlot(r, c)}
              className={`aspect-square rounded-md transition-colors ${
                cell
                  ? ''
                  : `border border-dashed ${isDropTarget ? 'bg-primary/10 border-primary/40' : 'border-muted-foreground/30 bg-background/40'}`
              }`}
              title={cell ? '' : `r${r + 1} · c${c + 1} (пусто)`}
            >
              {cell ? onChip(cell, loc) : null}
            </div>
          )
        }),
      )}
    </div>
  )
}

function ImageDrop({ file, preview, onFile }: {
  file: File | null
  preview: string | null
  onFile: (f: File | null) => void
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Карта-картинка (4:3)</label>
      <div className="border-2 border-dashed rounded-xl p-3 relative bg-muted/30 hover:bg-muted/50 transition-colors min-h-[120px]">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        {preview ? (
          <img src={preview} alt="preview" className="max-h-48 rounded-lg object-contain mx-auto pointer-events-none" />
        ) : (
          <div className="flex flex-col items-center text-muted-foreground gap-1 pointer-events-none py-6">
            <Upload className="w-6 h-6 opacity-50" />
            <span className="text-xs">Нажмите или перетащите</span>
          </div>
        )}
      </div>
      {(file || preview) && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-destructive"
          onClick={() => onFile(null)}
        >
          Убрать картинку
        </button>
      )}
    </div>
  )
}
