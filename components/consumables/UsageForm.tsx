'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import {
  getConsumables, logUsage, findConsumableByQR,
} from '@/app/actions/consumables'
import { getMyProjects } from '@/app/actions/projects'
import { getApprovers } from '@/app/actions/scanner'
import { createClient } from '@/utils/supabase/client'
import { UNITS } from '@/lib/units'
import { CELL_COLORS, type CellColor } from '@/lib/cells'
import {
  Loader2, UploadCloud, FileImage, X, Clipboard, AlertTriangle,
  ScanBarcode,
} from 'lucide-react'

type CellRef = {
  id: string
  color: CellColor
  code: string
  locations?: { name: string } | { name: string }[] | null
}

type Consumable = {
  id: string
  name: string
  description: string | null
  unit: string
  quantity: number
  quantity_available: number
  home_cell?: CellRef | CellRef[] | null
  categories?: { name: string } | { name: string }[] | null
}

type Project = { id: string; name: string }
type Approver = { id: string; full_name: string | null; username: string | null; role: string }

const unitLabel = (u: string) => UNITS.find((x) => x.value === u)?.label ?? u

export default function UsageForm() {
  const { toast } = useToast()
  const [consumables, setConsumables] = useState<Consumable[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [approvers, setApprovers] = useState<Approver[]>([])

  const [selectedConsumable, setSelectedConsumable] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [projectId, setProjectId] = useState<string>('none')
  const [approverId, setApproverId] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerBusy, setScannerBusy] = useState(false)
  const lastScanRef = useRef<{ qr: string; ts: number } | null>(null)

  useEffect(() => {
    Promise.all([getConsumables(), getMyProjects(), getApprovers()])
      .then(([c, p, a]: any[]) => {
        setConsumables(c as unknown as Consumable[])
        setProjects(p as Project[])
        setApprovers(a as Approver[])
      })
      .catch((err) => {
        console.error(err)
        toast({ title: 'Ошибка загрузки', description: err.message, variant: 'destructive' })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Глобальный paste — скриншот из буфера
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || (target as any)?.isContentEditable) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile()
          if (f) {
            setFileWithPreview(f)
            toast({ title: 'Скриншот вставлен', description: 'Изображение готово к загрузке' })
          }
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setFileWithPreview = (f: File) => {
    setFile(f)
    if (filePreview) URL.revokeObjectURL(filePreview)
    setFilePreview(URL.createObjectURL(f))
  }

  const clearFile = () => {
    if (filePreview) URL.revokeObjectURL(filePreview)
    setFile(null)
    setFilePreview(null)
    const input = document.getElementById('proof-upload') as HTMLInputElement | null
    if (input) input.value = ''
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setFileWithPreview(f)
  }

  const currentConsumable = useMemo(
    () => consumables.find((c) => c.id === selectedConsumable),
    [consumables, selectedConsumable]
  )

  const handleScannedQR = async (qr: string) => {
    if (!qr || scannerBusy) return
    const now = Date.now()
    if (lastScanRef.current && lastScanRef.current.qr === qr && now - lastScanRef.current.ts < 1500) return
    lastScanRef.current = { qr, ts: now }

    setScannerBusy(true)
    try {
      const res: any = await findConsumableByQR(qr)
      if ('error' in res && res.error) {
        toast({ title: 'Не подходит', description: res.error, variant: 'destructive' })
        return
      }
      const inv = res.inventory as { id: string; name: string }
      // Если расходник пока не в локальном списке — обновим
      let exists = consumables.some((c) => c.id === inv.id)
      if (!exists) {
        const refreshed = (await getConsumables()) as unknown as Consumable[]
        setConsumables(refreshed)
        exists = refreshed.some((c) => c.id === inv.id)
      }
      if (!exists) {
        toast({ title: 'Не найдено', description: `«${inv.name}» нет в актуальном списке`, variant: 'destructive' })
        return
      }
      setSelectedConsumable(inv.id)
      setApproverId('')
      setScannerOpen(false)
      toast({ title: 'Расходник выбран', description: inv.name })
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setScannerBusy(false)
    }
  }

  const cellColor: CellColor | null = useMemo(() => {
    if (!currentConsumable?.home_cell) return null
    const hc = Array.isArray(currentConsumable.home_cell)
      ? currentConsumable.home_cell[0]
      : currentConsumable.home_cell
    return hc?.color ?? null
  }, [currentConsumable])

  const needsApprover = !!cellColor && cellColor !== 'green'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedConsumable || !amount || !file) {
      toast({ title: 'Заполните поля', description: 'Материал, количество и скриншот обязательны', variant: 'destructive' })
      return
    }
    if (needsApprover && !approverId) {
      toast({ title: 'Нужен учитель', description: 'Укажите учителя-разрешившего', variant: 'destructive' })
      return
    }

    setIsUploading(true)
    const supabase = createClient()
    try {
      const fileExt = (file.name.split('.').pop() || 'png').toLowerCase()
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
      const filePath = `usage/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('proofs')
        .upload(filePath, file, { cacheControl: '3600', upsert: false })
      if (uploadError) throw new Error('Ошибка загрузки скриншота: ' + uploadError.message)

      const { data: publicUrlData } = supabase.storage.from('proofs').getPublicUrl(filePath)
      const proofUrl = publicUrlData.publicUrl

      await logUsage({
        inventoryId: selectedConsumable,
        amount: parseFloat(amount),
        proofUrl,
        projectId,
        description: description || null,
        teacherApproverId: approverId || null,
      })

      toast({ title: 'Готово', description: 'Списание зафиксировано' })

      setAmount('')
      setSelectedConsumable('')
      setProjectId('none')
      setApproverId('')
      setDescription('')
      clearFile()

      // Перезагружаем расходники, чтобы остаток обновился
      const refreshed = await getConsumables()
      setConsumables(refreshed as Consumable[])
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-card border rounded-2xl shadow-sm">
      <div className="mb-5">
        <h2 className="text-2xl font-bold tracking-tight">Списание материала</h2>
        <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1">
          <Clipboard className="w-3.5 h-3.5" />
          Можно вставить скриншот: <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono ml-1">Ctrl + V</kbd>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Материал <span className="text-red-500">*</span></label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => setScannerOpen(true)}
              disabled={isUploading}
            >
              <ScanBarcode className="w-3.5 h-3.5" /> Сканировать
            </Button>
          </div>
          <Select value={selectedConsumable} onValueChange={(v) => { setSelectedConsumable(v); setApproverId('') }} disabled={isUploading}>
            <SelectTrigger><SelectValue placeholder="Выберите расходник" /></SelectTrigger>
            <SelectContent>
              {consumables.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">
                  Расходников нет — попросите админа добавить инвентарь с галочкой «Считать расходником».
                </div>
              )}
              {consumables.map((c) => {
                const hc = Array.isArray(c.home_cell) ? c.home_cell[0] : c.home_cell
                const color: CellColor | undefined = hc?.color
                return (
                  <SelectItem key={c.id} value={c.id} disabled={c.quantity_available <= 0}>
                    <span className="inline-flex items-center gap-1.5">
                      {color && <span className="inline-block w-2 h-2 rounded-sm" style={{ background: CELL_COLORS[color].hex }} />}
                      {c.name}
                      <span className="text-xs text-muted-foreground">
                        (остаток: {c.quantity_available} {unitLabel(c.unit)})
                      </span>
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          {currentConsumable?.description && (
            <p className="text-[11px] text-muted-foreground">{currentConsumable.description}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Количество <span className="text-red-500">*</span>
            {currentConsumable && (
              <span className="ml-2 text-xs text-muted-foreground font-normal">в {unitLabel(currentConsumable.unit)}</span>
            )}
          </label>
          <div className="relative">
            <Input
              type="number"
              placeholder="120"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0.01"
              step="0.01"
              max={currentConsumable?.quantity_available}
              disabled={isUploading || !currentConsumable}
              className="pr-16"
            />
            {currentConsumable && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium pointer-events-none">
                {unitLabel(currentConsumable.unit)}
              </span>
            )}
          </div>
        </div>

        {needsApprover && (
          <div className="space-y-1.5 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
            <label className="text-sm font-medium flex items-center gap-1.5 text-amber-900">
              <AlertTriangle className="w-4 h-4" /> Кто разрешил
              <span className="text-[10px] uppercase tracking-wider ml-1">
                {cellColor === 'purple' ? 'фиолетовая ячейка' : 'синяя ячейка'}
              </span>
            </label>
            <Select value={approverId} onValueChange={setApproverId} disabled={isUploading}>
              <SelectTrigger><SelectValue placeholder="Выберите учителя/админа" /></SelectTrigger>
              <SelectContent>
                {approvers.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.full_name || a.username} <span className="text-muted-foreground">({a.role})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Проект <span className="text-xs text-muted-foreground font-normal">опционально</span></label>
          <Select value={projectId} onValueChange={setProjectId} disabled={isUploading}>
            <SelectTrigger><SelectValue placeholder="Без проекта" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Без проекта</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Описание <span className="text-xs text-muted-foreground font-normal">что это и для чего</span></label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Корпус робота, деталь №3"
            disabled={isUploading}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center justify-between">
            <span>Скриншот слайсера <span className="text-red-500">*</span></span>
            {file && (
              <button type="button" onClick={clearFile} className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1">
                <X className="w-3 h-3" /> Убрать
              </button>
            )}
          </label>
          <div className="border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center relative bg-muted/30 transition-colors hover:bg-muted/50 min-h-[140px]">
            <input
              id="proof-upload"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={isUploading}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            {filePreview ? (
              <img src={filePreview} alt="preview" className="max-h-48 rounded-lg object-contain pointer-events-none" />
            ) : file ? (
              <div className="flex items-center gap-2 text-primary pointer-events-none">
                <FileImage className="w-5 h-5" />
                <span className="text-sm font-medium truncate max-w-[200px]">{file.name}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center text-muted-foreground gap-1 pointer-events-none">
                <UploadCloud className="w-7 h-7 mb-1" />
                <span className="text-sm">Нажмите, перетащите или вставьте Ctrl+V</span>
              </div>
            )}
          </div>
        </div>

        <Button type="submit" className="w-full h-12 text-base mt-2" disabled={isUploading}>
          {isUploading ? (
            <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Отправка…</>
          ) : 'Подтвердить списание'}
        </Button>
      </form>

      <Dialog open={scannerOpen} onOpenChange={(o) => { if (!o) { setScannerOpen(false); lastScanRef.current = null } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanBarcode className="w-5 h-5" /> Сканировать расходник
            </DialogTitle>
            <DialogDescription>
              Наведите камеру на QR-код или штрихкод расходника. Не-расходники сюда не пройдут.
            </DialogDescription>
          </DialogHeader>
          <div className="aspect-square w-full overflow-hidden rounded-xl relative bg-black">
            {scannerOpen && (
              <Scanner
                onScan={(result) => {
                  if (result && result.length > 0) handleScannedQR(result[0].rawValue)
                }}
                onError={(err) => console.error(err)}
              />
            )}
            {scannerBusy && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white backdrop-blur-sm">
                <span className="animate-pulse font-medium text-sm">Поиск…</span>
              </div>
            )}
          </div>
          <Button type="button" variant="outline" onClick={() => setScannerOpen(false)}>
            Закрыть
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
