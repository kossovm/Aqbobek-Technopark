'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  getInventory, addInventoryItem,
  deleteInventoryItem, bulkAddInventory,
  bulkDeleteInventory, markLabelsPrinted,
  type NewInventoryInput,
} from '@/app/actions/inventory'
import { getCategories } from '@/app/actions/categories'
import { getLocationsWithCells } from '@/app/actions/cells'
import { UNITS, type Unit } from '@/lib/units'
import { CELL_COLORS, type CellColor } from '@/lib/cells'
import PrintableLabel, { type LabelFormat, type LabelItem } from './PrintableLabel'
import {
  Printer, Plus, Loader2, Trash2, Save, ListPlus,
} from 'lucide-react'

type Category = { id: string; name: string; is_consumable: boolean; default_unit: Unit }
type Cell = { id: string; code: string; color: CellColor; qr_code: string }
type LocationWithCells = {
  id: string
  name: string
  cells: Cell[]
}
type InvItem = {
  id: string
  name: string
  description: string | null
  qr_code: string
  status: 'available' | 'in_use' | 'partial' | 'maintenance' | 'lost'
  quantity: number
  quantity_available: number
  unit: string
  is_consumable: boolean
  label_printed: boolean
  category_id: string | null
  category?: string | null
  categories?: { name: string } | null
  home_cell_id: string | null
  home_cell?: {
    id: string; code: string; color: CellColor; qr_code: string
    locations?: { name: string } | { name: string }[] | null
  } | null
  active_transactions?: Array<{
    id: string
    issued_at: string
    quantity: number
    users?: { full_name?: string | null; username?: string | null } | null
    projects?: { name?: string | null } | null
  }>
}

type Row = {
  id: string
  name: string
  description: string
  category_id: string
  home_cell_id: string
  quantity: string
  unit: Unit
  is_consumable: boolean
  status?: 'ok' | 'error'
  errorMsg?: string
  createdId?: string
  createdQR?: string
}

function makeRow(): Row {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `r_${Math.random().toString(36).slice(2)}`,
    name: '',
    description: '',
    category_id: '',
    home_cell_id: '',
    quantity: '1',
    unit: 'piece',
    is_consumable: false,
  }
}

export default function InventoryTable() {
  const { toast } = useToast()

  const [inventory, setInventory] = useState<InvItem[]>([])
  const [locsWithCells, setLocsWithCells] = useState<LocationWithCells[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Single add modal
  const [singleOpen, setSingleOpen] = useState(false)
  const [sName, setSName] = useState('')
  const [sDesc, setSDesc] = useState('')
  const [sCategory, setSCategory] = useState<string>('none')
  const [sCell, setSCell] = useState<string>('none')
  const [sQuantity, setSQuantity] = useState('1')
  const [sUnit, setSUnit] = useState<Unit>('piece')
  const [sIsConsumable, setSIsConsumable] = useState(false)
  const [isAdding, setIsAdding] = useState(false)

  // Bulk add modal
  const [bulkOpen, setBulkOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([makeRow()])
  const [isBulkSaving, setIsBulkSaving] = useState(false)

  // Print state
  const [labelsToPrint, setLabelsToPrint] = useState<LabelItem[] | null>(null)
  const [labelFormat, setLabelFormat] = useState<LabelFormat>('qr')

  // Selection for bulk operations
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setIsLoading(true)
    try {
      const [inv, locs, cats] = await Promise.all([
        getInventory(), getLocationsWithCells(), getCategories(),
      ])
      setInventory(inv as InvItem[])
      setLocsWithCells(locs as LocationWithCells[])
      setCategories(cats as Category[])
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  // Все ячейки в одном плоском списке для селектов
  const allCells = useMemo(() => {
    const arr: Array<Cell & { locationName: string }> = []
    for (const loc of locsWithCells) {
      for (const c of loc.cells) arr.push({ ...c, locationName: loc.name })
    }
    return arr
  }, [locsWithCells])

  // ─── Single add ────────────────────────────────────────────────────────────
  const onCategoryChange = (val: string) => {
    setSCategory(val)
    const cat = categories.find((c) => c.id === val)
    if (cat) {
      setSIsConsumable(cat.is_consumable)
      setSUnit(cat.default_unit)
    }
  }

  const handleSingleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sName.trim()) {
      toast({ title: 'Введите название', variant: 'destructive' })
      return
    }
    setIsAdding(true)
    try {
      const newItem = await addInventoryItem({
        name: sName.trim(),
        description: sDesc.trim() || null,
        category_id: sCategory === 'none' ? null : sCategory,
        home_cell_id: sCell === 'none' ? null : sCell,
        quantity: Number(sQuantity) || 1,
        unit: sUnit,
        is_consumable: sIsConsumable,
      })
      toast({ title: 'Добавлено', description: 'Этикетка готова к печати' })
      setSingleOpen(false)
      setSName(''); setSDesc(''); setSCategory('none'); setSCell('none')
      setSQuantity('1'); setSUnit('piece'); setSIsConsumable(false)
      loadData()
      printLabels([{ qrCode: newItem.qr_code, name: newItem.name }])
      // помечаем как напечатанную
      await markLabelsPrinted([newItem.id])
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsAdding(false)
    }
  }

  // ─── Bulk add ──────────────────────────────────────────────────────────────
  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch, status: undefined } : r))

  const onRowCategory = (id: string, val: string) => {
    const cat = categories.find((c) => c.id === val)
    updateRow(id, {
      category_id: val,
      ...(cat ? { is_consumable: cat.is_consumable, unit: cat.default_unit } : {}),
    })
  }

  const handleBulkSave = async () => {
    const payload: NewInventoryInput[] = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        description: r.description.trim() || null,
        category_id: r.category_id || null,
        home_cell_id: r.home_cell_id || null,
        quantity: Number(r.quantity) || 1,
        unit: r.unit,
        is_consumable: r.is_consumable,
      }))
    if (payload.length === 0) {
      toast({ title: 'Пусто', description: 'Заполните хотя бы одну строку', variant: 'destructive' })
      return
    }
    setIsBulkSaving(true)
    const res = await bulkAddInventory(payload)
    setIsBulkSaving(false)

    if ('error' in res && res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      return
    }
    const created = res.created ?? []
    const successItems: LabelItem[] = []
    const successIds: string[] = []

    setRows((prev) => prev.map((r) => {
      if (!r.name.trim()) return r
      const matched = created.find((c: any) => c?.name === r.name.trim() && c?.id)
      if (matched && matched.qr_code) {
        successItems.push({ qrCode: matched.qr_code, name: matched.name })
        successIds.push(matched.id)
        return { ...r, status: 'ok', createdId: matched.id, createdQR: matched.qr_code }
      }
      const errorMatch = created.find((c: any) => c?.name === r.name.trim() && c?.error)
      if (errorMatch) return { ...r, status: 'error', errorMsg: errorMatch.error }
      return r
    }))

    toast({
      title: 'Готово',
      description: `Добавлено: ${successItems.length}. Этикетки готовятся к печати.`,
    })

    if (successItems.length > 0) {
      // Предлагаем напечатать все
      if (confirm(`Распечатать ${successItems.length} этикеток сейчас?`)) {
        printLabels(successItems)
        await markLabelsPrinted(successIds)
      }
    }
    loadData()
  }

  // ─── Печать ───────────────────────────────────────────────────────────────
  function printLabels(items: LabelItem[]) {
    setLabelsToPrint(items)
  }

  const handlePrintOne = async (it: InvItem) => {
    printLabels([{ qrCode: it.qr_code, name: it.name }])
    if (!it.label_printed) await markLabelsPrinted([it.id])
    loadData()
  }

  const handleBulkPrint = async () => {
    const ids = Array.from(selected)
    const items = inventory.filter((i) => ids.includes(i.id))
    if (items.length === 0) return
    printLabels(items.map((i) => ({ qrCode: i.qr_code, name: i.name })))
    await markLabelsPrinted(ids)
    setSelected(new Set())
    loadData()
  }

  // ─── Удаление ─────────────────────────────────────────────────────────────
  const handleDeleteOne = async (it: InvItem) => {
    if (!confirm(`Удалить «${it.name}» (${it.qr_code})?`)) return
    const res = await deleteInventoryItem(it.id)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: 'Удалено' }); loadData() }
  }

  const handleBulkDelete = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (!confirm(`Удалить ${ids.length} единиц инвентаря?`)) return
    const res = await bulkDeleteInventory(ids)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: `Удалено: ${ids.length}` }); setSelected(new Set()); loadData() }
  }

  // ─── Селект всех / переключение ────────────────────────────────────────────
  const toggleAll = () =>
    setSelected(selected.size === inventory.length ? new Set() : new Set(inventory.map((i) => i.id)))

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })

  const allChecked = inventory.length > 0 && selected.size === inventory.length

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="w-full space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Управление инвентарем</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">База оборудования, этикетки и массовые операции.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { setRows([makeRow()]); setBulkOpen(true) }}>
            <ListPlus className="w-4 h-4 mr-1" /> Массовое добавление
          </Button>
          <Button onClick={() => setSingleOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> Добавить
          </Button>
        </div>
      </div>

      {/* Toolbar выбора + формат этикеток */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border rounded-xl px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Этикетка:</span>
          <Select value={labelFormat} onValueChange={(v) => setLabelFormat(v as LabelFormat)}>
            <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="qr">QR + текст рядом</SelectItem>
              <SelectItem value="code128">Штрихкод Code128</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Выбрано: {selected.size}</span>
            <Button size="sm" variant="outline" onClick={handleBulkPrint}>
              <Printer className="w-4 h-4 mr-1" /> Напечатать
            </Button>
            <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
              <Trash2 className="w-4 h-4 mr-1" /> Удалить
            </Button>
          </div>
        )}
      </div>

      {/* Таблица инвентаря */}
      <div className="border rounded-xl shadow-sm bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={allChecked}
                  onChange={toggleAll}
                />
              </TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Категория</TableHead>
              <TableHead>Кол-во</TableHead>
              <TableHead>Ячейка</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Кем занято</TableHead>
              <TableHead>Инв. №</TableHead>
              <TableHead>Этикетка</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center h-32"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : inventory.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center h-32 text-muted-foreground">Инвентарь пока пуст</TableCell></TableRow>
            ) : (
              inventory.map((item) => {
                const cat = item.categories?.name || item.category || '—'
                const unitLabel = UNITS.find((u) => u.value === item.unit)?.label ?? item.unit
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-primary"
                        checked={selected.has(item.id)}
                        onChange={() => toggleOne(item.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{item.name}</div>
                      {item.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1 max-w-[280px]">{item.description}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {cat}
                      {item.is_consumable && (
                        <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1 rounded uppercase">расх</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {item.quantity_available}/{item.quantity} <span className="text-xs text-muted-foreground">{unitLabel}</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {item.home_cell ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{
                            background: CELL_COLORS[item.home_cell.color]?.hex,
                          }} />
                          <code className="font-bold">{item.home_cell.code}</code>
                          <span className="text-xs text-muted-foreground">·{' '}
                            {Array.isArray(item.home_cell.locations)
                              ? item.home_cell.locations[0]?.name
                              : item.home_cell.locations?.name}
                          </span>
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                        item.status === 'available' ? 'bg-green-100 text-green-700' :
                        item.status === 'partial'   ? 'bg-blue-100 text-blue-700' :
                        item.status === 'in_use'    ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {item.status === 'available' ? 'Свободно' :
                         item.status === 'partial'   ? 'Частично' :
                         item.status === 'in_use'    ? 'Занято' :
                         item.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.active_transactions && item.active_transactions.length > 0 ? (
                        <div className="space-y-0.5 max-w-[200px]">
                          {item.active_transactions.map((tx) => (
                            <div key={tx.id} className="leading-tight">
                              <div className="font-medium truncate">
                                {tx.users?.full_name || tx.users?.username || '—'}
                                {tx.quantity > 1 && (
                                  <span className="ml-1 text-amber-700">×{tx.quantity}</span>
                                )}
                              </div>
                              <div className="text-muted-foreground text-[10px]">
                                {new Date(tx.issued_at).toLocaleString('ru-RU', {
                                  day: '2-digit', month: '2-digit',
                                  hour: '2-digit', minute: '2-digit',
                                })}
                                {tx.projects?.name && <span> · {tx.projects.name}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.qr_code}</TableCell>
                    <TableCell>
                      {item.label_printed ? (
                        <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-semibold">PRINTED</span>
                      ) : (
                        <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-semibold">NEW</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => handlePrintOne(item)}>
                        <Printer className="w-4 h-4 mr-1" /> Печать
                      </Button>
                      <Button
                        size="icon" variant="ghost"
                        className="text-destructive hover:bg-destructive/10 ml-1"
                        onClick={() => handleDeleteOne(item)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Single Add Dialog */}
      <Dialog open={singleOpen} onOpenChange={setSingleOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Регистрация инвентаря</DialogTitle>
            <DialogDescription>
              QR-код будет сгенерирован автоматически. После сохранения вам предложат печать этикетки.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSingleAdd} className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Название *</label>
              <Input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Паяльная станция Hakko" disabled={isAdding} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Описание</label>
              <Input value={sDesc} onChange={(e) => setSDesc(e.target.value)} placeholder="Кратко: что и для чего" disabled={isAdding} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Категория</label>
                <Select value={sCategory} onValueChange={onCategoryChange} disabled={isAdding}>
                  <SelectTrigger><SelectValue placeholder="Без категории" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без категории</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.is_consumable && <span className="text-xs text-amber-700">· расх</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Домашняя ячейка</label>
                <Select value={sCell} onValueChange={setSCell} disabled={isAdding}>
                  <SelectTrigger><SelectValue placeholder="Не привязано" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не привязано</SelectItem>
                    {allCells.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: CELL_COLORS[c.color].hex }} />
                          <code className="font-bold">{c.code}</code>
                          <span className="text-muted-foreground">· {c.locationName}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Количество</label>
                <Input type="number" min="0.1" step="0.1" value={sQuantity} onChange={(e) => setSQuantity(e.target.value)} disabled={isAdding} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Ед. изм.</label>
                <Select value={sUnit} onValueChange={(v) => setSUnit(v as Unit)} disabled={isAdding}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 accent-primary"
                checked={sIsConsumable}
                onChange={(e) => setSIsConsumable(e.target.checked)}
                disabled={isAdding}
              />
              Считать расходником
            </label>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setSingleOpen(false)} disabled={isAdding}>Отмена</Button>
              <Button type="submit" disabled={isAdding}>
                {isAdding ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Сохранить и печатать
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Add Dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-[920px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Массовое добавление инвентаря</DialogTitle>
            <DialogDescription>Заполните строки. После сохранения предложим напечатать все этикетки.</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="min-w-[180px]">Название *</TableHead>
                  <TableHead className="min-w-[160px]">Категория</TableHead>
                  <TableHead className="min-w-[100px]">Кол-во</TableHead>
                  <TableHead className="min-w-[120px]">Ед. изм.</TableHead>
                  <TableHead className="min-w-[180px]">Ячейка</TableHead>
                  <TableHead className="min-w-[200px]">Описание</TableHead>
                  <TableHead className="w-[120px]">Статус</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={
                    row.status === 'error' ? 'bg-red-50/40' :
                    row.status === 'ok' ? 'bg-green-50/40' : ''
                  }>
                    <TableCell>
                      <Input value={row.name} onChange={(e) => updateRow(row.id, { name: e.target.value })} placeholder="Паяльник…" disabled={row.status === 'ok'} />
                    </TableCell>
                    <TableCell>
                      <Select value={row.category_id || 'none'} onValueChange={(v) => onRowCategory(row.id, v === 'none' ? '' : v)} disabled={row.status === 'ok'}>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Без категории</SelectItem>
                          {categories.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input type="number" min="0.1" step="0.1" value={row.quantity} onChange={(e) => updateRow(row.id, { quantity: e.target.value })} disabled={row.status === 'ok'} />
                    </TableCell>
                    <TableCell>
                      <Select value={row.unit} onValueChange={(v) => updateRow(row.id, { unit: v as Unit })} disabled={row.status === 'ok'}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={row.home_cell_id || 'none'} onValueChange={(v) => updateRow(row.id, { home_cell_id: v === 'none' ? '' : v })} disabled={row.status === 'ok'}>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не привязано</SelectItem>
                          {allCells.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              <span className="inline-flex items-center gap-1.5">
                                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: CELL_COLORS[c.color].hex }} />
                                <code className="font-bold">{c.code}</code>
                                <span className="text-muted-foreground">· {c.locationName}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input value={row.description} onChange={(e) => updateRow(row.id, { description: e.target.value })} placeholder="Опционально" disabled={row.status === 'ok'} />
                    </TableCell>
                    <TableCell>
                      {row.status === 'ok' ? (
                        <span className="text-green-700 text-xs font-semibold">✓ {row.createdQR}</span>
                      ) : row.status === 'error' ? (
                        <span className="text-red-700 text-xs" title={row.errorMsg}>✗ {row.errorMsg}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon" variant="ghost"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => setRows((p) => p.length <= 1 ? [makeRow()] : p.filter((r) => r.id !== row.id))}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setRows((p) => [...p, makeRow()])} className="sm:mr-auto">
              <Plus className="w-4 h-4 mr-1" /> Ещё строка
            </Button>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={isBulkSaving}>Закрыть</Button>
            <Button onClick={handleBulkSave} disabled={isBulkSaving}>
              {isBulkSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Сохранить всех
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
