'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Scanner } from '@yudiel/react-qr-scanner'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  processQRCode, checkoutItem, bulkCheckout,
  startReturn, confirmReturn, getApprovers,
} from '@/app/actions/scanner'
import { getMyProjects } from '@/app/actions/projects'
import { unitLabel } from '@/lib/units'
import { CELL_COLORS, type CellColor, isCellQR } from '@/lib/cells'
import {
  Loader2, ArrowUpFromLine, Layers,
  ShoppingCart, Trash2, Plus, Minus, ScanBarcode, CheckCircle2,
  XCircle, MapPin, AlertTriangle, Undo2,
} from 'lucide-react'

type Project = { id: string; name: string }
type Approver = { id: string; full_name: string | null; username: string | null; role: string }

type CellRef = {
  id: string
  code: string
  color: CellColor
  qr_code: string
  locations?: { id: string; name: string; image_url?: string | null } | null
}

type ScanInv = {
  id: string
  name: string
  description: string | null
  qr_code: string
  unit: string
  is_consumable: boolean
  quantity_total: number
  quantity_available: number
  my_quantity: number
  home_cell: CellRef | null
  cell_color: CellColor | null
  parked_project: { id: string; name: string } | null
}

type ReturnState = {
  inv: { id: string; name: string; qr_code: string; unit: string; my_quantity: number; home_cell: CellRef }
  qty: string
}

type Mode = 'one' | 'cart' | 'return'
type CartLine = {
  inv: ScanInv
  qty: number
  approverId?: string | null
  status?: 'pending' | 'ok' | 'error'
  errorMsg?: string
}

export default function QRScanner() {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const initialMode: Mode =
    searchParams?.get('mode') === 'return' ? 'return'
    : searchParams?.get('mode') === 'cart'   ? 'cart'
    : 'one'

  const [mode, setMode] = useState<Mode>(initialMode)
  const [isProcessing, setIsProcessing] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [approvers, setApprovers] = useState<Approver[]>([])

  // ─── Single ─────────────────────────────────────────────────────────────
  const [single, setSingle] = useState<ScanInv | null>(null)
  const [singleQty, setSingleQty] = useState('1')
  const [singleProject, setSingleProject] = useState<string>('none')
  const [singleApprover, setSingleApprover] = useState<string>('')

  // ─── Return flow ─────────────────────────────────────────────────────────
  const [retState, setRetState] = useState<ReturnState | null>(null)

  // ─── Cart ───────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartLine[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [cartProject, setCartProject] = useState<string>('none')
  const lastScanRef = useRef<{ qr: string; ts: number } | null>(null)

  useEffect(() => {
    Promise.all([getMyProjects(), getApprovers()])
      .then(([p, a]: any[]) => { setProjects(p as Project[]); setApprovers(a as Approver[]) })
      .catch(() => { setProjects([]); setApprovers([]) })
  }, [])

  // ─── Scan handler ───────────────────────────────────────────────────────
  const handleScan = async (text: string) => {
    if (!text) return
    const now = Date.now()
    if (lastScanRef.current && lastScanRef.current.qr === text && now - lastScanRef.current.ts < 1200) return
    lastScanRef.current = { qr: text, ts: now }

    // ─── Режим «Возврат»: первый скан = деталь, открываем диалог ──────────
    if (mode === 'return' && !retState) {
      if (isProcessing) return
      if (isCellQR(text)) {
        toast({ title: 'Это ячейка', description: 'Сначала отсканируйте предмет', variant: 'destructive' })
        return
      }
      setIsProcessing(true)
      try {
        const res = await startReturn(text)
        if ('error' in res) {
          toast({ title: 'Возврат', description: res.error, variant: 'destructive' })
          return
        }
        setRetState({ inv: res.inventory as ReturnState['inv'], qty: '1' })
      } catch (e: any) {
        toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
      } finally {
        setIsProcessing(false)
      }
      return
    }

    // ─── В процессе возврата: ожидаем код ячейки ──────────────────────────
    if (retState) {
      if (!isCellQR(text)) {
        toast({ title: 'Это не ячейка', description: 'Отсканируйте QR ячейки', variant: 'destructive' })
        return
      }
      const qty = Math.max(1, Math.floor(Number(retState.qty) || 1))
      setIsProcessing(true)
      try {
        const res = await confirmReturn(retState.inv.id, text, qty)
        if (!res.ok) {
          toast({
            title: 'Возврат не удался',
            description: `Это другая ячейка. Нужна ${res.expected_code}.`,
            variant: 'destructive',
          })
          return
        }
        toast({ title: 'Возврат принят', description: `${retState.inv.name} · ${qty} ${unitLabel(retState.inv.unit)}` })
        setRetState(null)
      } catch (e: any) {
        toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
      } finally {
        setIsProcessing(false)
      }
      return
    }

    // ─── По одному ────────────────────────────────────────────────────────
    if (mode === 'one') {
      if (single || isProcessing) return
      setIsProcessing(true)
      try {
        const result: any = await processQRCode(text)
        if (result.kind === 'error') {
          toast({ title: 'Ошибка', description: result.message, variant: 'destructive' })
          return
        }
        if (result.kind === 'cell') {
          toast({ title: 'Это ячейка', description: `${result.cell.code} · отсканируйте предмет` })
          return
        }
        // kind: 'item'
        const inv: ScanInv = result.inventory
        setSingle(inv)
        setSingleQty('1')
        setSingleProject(inv.parked_project?.id ?? 'none')
        setSingleApprover('')
      } catch (e: any) {
        toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
      } finally {
        setIsProcessing(false)
      }
      return
    }

    // ─── Корзина ──────────────────────────────────────────────────────────
    if (cartOpen) return
    setIsProcessing(true)
    try {
      const result: any = await processQRCode(text)
      if (result.kind === 'error') {
        toast({ title: 'Не добавлено', description: result.message, variant: 'destructive' })
        return
      }
      if (result.kind === 'cell') {
        toast({ title: 'Это ячейка', description: 'В корзине нужны предметы' })
        return
      }
      const inv: ScanInv = result.inventory
      setCart((prev) => {
        const idx = prev.findIndex((l) => l.inv.id === inv.id)
        if (idx >= 0) {
          const next = [...prev]
          const cur = next[idx]
          const newQty = Math.min(cur.qty + 1, inv.quantity_available || cur.qty + 1)
          next[idx] = { ...cur, qty: newQty, inv }
          toast({ title: 'Уже в корзине', description: `${inv.name}: +1, итого ${newQty}` })
          return next
        }
        if (inv.quantity_available <= 0) {
          toast({ title: 'Нет свободных', description: inv.name, variant: 'destructive' })
          return prev
        }
        toast({ title: 'В корзину', description: `${inv.name} ×1` })
        return [...prev, { inv, qty: 1 }]
      })
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsProcessing(false)
    }
  }

  // ─── Single actions ─────────────────────────────────────────────────────
  const resetSingle = () => {
    setSingle(null); setSingleQty('1'); setSingleProject('none'); setSingleApprover('')
  }

  // Нужен ли учитель-подтверждающий?
  function needsApprover(inv: ScanInv | null, projectId: string): boolean {
    if (!inv?.cell_color) return false
    if (inv.cell_color === 'green') return false
    // blue: если выбран проект, к которому привязана home_cell — не нужно
    if (inv.cell_color === 'blue' && inv.parked_project && projectId === inv.parked_project.id) return false
    // на сервере же сделана дополнительная проверка по ролям
    return true
  }

  const confirmSingle = async () => {
    if (!single) return
    const max = single.quantity_available
    const n = Math.max(1, Math.floor(Number(singleQty) || 1))
    if (n > max) {
      toast({ title: 'Превышение', description: `Доступно только ${max}`, variant: 'destructive' })
      return
    }
    setIsProcessing(true)
    try {
      const res: any = await checkoutItem(
        single.id,
        singleProject,
        n,
        singleApprover || null,
      )
      const hint = res?.storageHint
      toast({
        title: 'Готово',
        description: hint
          ? `Взято ${n}: ${single.name}. Храните на полке ${hint.code}${hint.location_name ? ` (${hint.location_name})` : ''}.`
          : `Взято ${n}: ${single.name}`,
      })
      resetSingle()
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsProcessing(false)
    }
  }

  // ─── Cart actions ───────────────────────────────────────────────────────
  const cartTotal = cart.reduce((sum, l) => sum + l.qty, 0)
  const updateCartQty = (id: string, qty: number) => setCart((prev) =>
    prev.map((l) => l.inv.id === id
      ? { ...l, qty: Math.max(1, Math.min(qty, l.inv.quantity_available || qty)), status: undefined }
      : l)
  )
  const updateCartApprover = (id: string, val: string) => setCart((prev) =>
    prev.map((l) => l.inv.id === id ? { ...l, approverId: val || null } : l)
  )
  const removeCartItem = (id: string) => setCart((prev) => prev.filter((l) => l.inv.id !== id))
  const clearCart = () => {
    if (!confirm('Очистить корзину полностью?')) return
    setCart([]); setCartProject('none')
  }

  const submitCart = async () => {
    if (cart.length === 0) return
    // Доводим approver там, где нужно
    for (const line of cart) {
      if (needsApprover(line.inv, cartProject) && !line.approverId) {
        toast({
          title: 'Нужен учитель',
          description: `${line.inv.name}: укажите учителя в строке корзины`,
          variant: 'destructive',
        })
        return
      }
    }

    setIsProcessing(true)
    try {
      const items = cart.map((l) => ({ inventoryId: l.inv.id, quantity: l.qty, teacherApproverId: l.approverId ?? null }))
      const res = await bulkCheckout(items, cartProject)
      const byId = new Map(res.results.map((r) => [r.inventoryId, r]))
      setCart((prev) => prev.map((l) => {
        const r = byId.get(l.inv.id)
        if (!r) return l
        return { ...l, status: r.ok ? 'ok' : 'error', errorMsg: r.error }
      }))
      toast({
        title: res.errorCount === 0 ? 'Корзина оформлена' : 'Готово с ошибками',
        description: `Успешно: ${res.okCount}. Ошибок: ${res.errorCount}.`,
        variant: res.errorCount === 0 ? 'default' : 'destructive',
      })
      if (res.errorCount === 0) {
        setTimeout(() => { setCart([]); setCartProject('none'); setCartOpen(false) }, 1200)
      }
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsProcessing(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-start min-h-screen bg-black/90 p-4 pt-6">
      <div className="w-full max-w-md mb-4 grid grid-cols-3 bg-white/10 rounded-2xl p-1 backdrop-blur-sm gap-1">
        <ModeTab
          active={mode === 'one'}
          onClick={() => { setMode('one'); setRetState(null) }}
          icon={ScanBarcode} label="Взять" hint="по одному"
        />
        <ModeTab
          active={mode === 'cart'}
          onClick={() => { setMode('cart'); setRetState(null) }}
          icon={ShoppingCart} label="Корзина" hint={cart.length ? `${cart.length} поз.` : 'подряд'}
        />
        <ModeTab
          active={mode === 'return'}
          onClick={() => { setMode('return'); setSingle(null) }}
          icon={Undo2} label="Вернуть" hint="по одному"
        />
      </div>

      <div className="w-full max-w-md aspect-square overflow-hidden rounded-2xl relative bg-black">
        <Scanner
          onScan={(result) => { if (result && result.length > 0) handleScan(result[0].rawValue) }}
          onError={(err) => console.error(err)}
        />
        {isProcessing && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white backdrop-blur-sm">
            <span className="animate-pulse font-medium">Обработка…</span>
          </div>
        )}
        {mode === 'cart' && !retState && cart.length > 0 && (
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="absolute top-3 right-3 bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-sm font-bold shadow-lg flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <ShoppingCart className="w-4 h-4" />
            {cart.length} · {cartTotal}
          </button>
        )}
      </div>

      <p className="text-white/60 mt-5 text-sm text-center max-w-md px-2">
        {retState
          ? `Шаг 2: отсканируйте ячейку «${retState.inv.home_cell.code}»`
          : mode === 'return'
            ? 'Шаг 1: отсканируйте QR-код возвращаемого предмета.'
            : mode === 'one'
              ? 'Наведите камеру на QR-код предмета.'
              : cart.length === 0
                ? 'Сканируйте подряд — собираем в корзину.'
                : `В корзине ${cart.length} позиций (${cartTotal} шт.).`}
      </p>

      {mode === 'cart' && !retState && cart.length > 0 && (
        <div className="w-full max-w-md mt-4">
          <Button size="lg" className="w-full h-14 text-base" onClick={() => setCartOpen(true)}>
            <ShoppingCart className="w-5 h-5 mr-2" />
            Открыть корзину ({cart.length})
          </Button>
        </div>
      )}

      {/* ─── Return panel ─────────────────────────────────────────────────── */}
      <Dialog open={!!retState} onOpenChange={(o) => { if (!o) setRetState(null) }}>
        <DialogContent className="sm:max-w-lg">
          {retState && (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl flex items-center gap-2">
                  <ArrowUpFromLine className="w-6 h-6" /> Возврат
                </DialogTitle>
                <DialogDescription>{retState.inv.name}</DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="rounded-xl bg-muted/50 p-3 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-inner"
                       style={{ background: CELL_COLORS[retState.inv.home_cell.color].hex }}>
                    {retState.inv.home_cell.code}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">Положите в ячейку</div>
                    <div className="text-xs text-muted-foreground truncate">
                      <MapPin className="w-3 h-3 inline mr-0.5" />
                      {retState.inv.home_cell.locations?.name || '—'}
                    </div>
                  </div>
                </div>

                {retState.inv.home_cell.locations?.image_url && (
                  <img
                    src={retState.inv.home_cell.locations.image_url}
                    alt="карта"
                    className="rounded-xl w-full aspect-[4/3] object-contain bg-muted"
                  />
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center justify-between">
                    <span>Сколько возвращаем</span>
                    <span className="text-xs text-muted-foreground">макс. {retState.inv.my_quantity}</span>
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="number" min={1} max={retState.inv.my_quantity} step={1}
                      value={retState.qty}
                      onChange={(e) => setRetState((s) => s ? { ...s, qty: e.target.value } : s)}
                      className="h-11 text-base"
                    />
                    <Button
                      type="button" variant="outline"
                      onClick={() => setRetState((s) => s ? { ...s, qty: String(s.inv.my_quantity) } : s)}
                      className="h-11 px-4 whitespace-nowrap"
                    >
                      <Layers className="w-4 h-4 mr-1" /> Все
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 flex items-start gap-2 text-amber-900">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p className="text-xs leading-snug">
                    Теперь поднесите камеру к QR-коду <b>именно этой ячейки</b>. Возврат закроется только после совпадения.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setRetState(null)} disabled={isProcessing}>Отмена</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Single dialog ────────────────────────────────────────────── */}
      <Dialog open={!!single} onOpenChange={(o) => !o && resetSingle()}>
        <DialogContent className="sm:max-w-md">
          {single && (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl">{single.name}</DialogTitle>
                <DialogDescription className="space-y-1 pt-1">
                  {single.description && (
                    <span className="block text-sm text-muted-foreground">{single.description}</span>
                  )}
                  <span className="block text-xs text-muted-foreground font-mono">
                    {single.qr_code}
                    {single.home_cell && (
                      <> · ячейка <b>{single.home_cell.code}</b>
                        {single.home_cell.locations?.name && ` (${single.home_cell.locations.name})`}
                      </>
                    )}
                  </span>
                  {single.cell_color && (
                    <span className="inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                          style={{ background: CELL_COLORS[single.cell_color].hex }}>
                      {CELL_COLORS[single.cell_color].label}
                    </span>
                  )}
                  {single.parked_project && (
                    <span className="block text-[11px] text-blue-700 mt-1">
                      Ячейка закреплена за проектом «{single.parked_project.name}»
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-3 gap-2 my-2">
                <Stat label="Всего" value={`${single.quantity_total}`} hint={unitLabel(single.unit)} />
                <Stat label="Свободно" value={`${single.quantity_available}`} accent={single.quantity_available > 0 ? 'green' : 'red'} />
                <Stat label="У вас" value={`${single.my_quantity}`} accent={single.my_quantity > 0 ? 'amber' : 'gray'} />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center justify-between">
                  <span>Сколько берём ({unitLabel(single.unit)})</span>
                  <span className="text-xs text-muted-foreground">макс. {single.quantity_available}</span>
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number" min={1} max={single.quantity_available} step={1}
                    value={singleQty}
                    onChange={(e) => setSingleQty(e.target.value)}
                    className="h-12 text-base"
                    disabled={single.quantity_available <= 0}
                  />
                  <Button
                    type="button" variant="outline"
                    onClick={() => setSingleQty(String(single.quantity_available))}
                    disabled={single.quantity_available <= 0}
                    className="h-12 px-4 whitespace-nowrap"
                  >
                    <Layers className="w-4 h-4 mr-1" /> Все ({single.quantity_available})
                  </Button>
                </div>
              </div>

              {projects.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Проект</label>
                  <Select value={singleProject} onValueChange={setSingleProject}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Без проекта" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Без проекта</SelectItem>
                      {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {needsApprover(single, singleProject) && (
                <div className="space-y-1.5 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  <label className="text-sm font-medium flex items-center gap-1.5 text-amber-900">
                    <AlertTriangle className="w-4 h-4" /> Учитель-разрешивший
                  </label>
                  <Select value={singleApprover} onValueChange={setSingleApprover}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Выберите учителя" /></SelectTrigger>
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

              <DialogFooter className="flex-col gap-2 sm:flex-col mt-2">
                <Button
                  size="lg" className="w-full text-lg h-14"
                  onClick={confirmSingle}
                  disabled={
                    isProcessing
                    || single.quantity_available <= 0
                    || (needsApprover(single, singleProject) && !singleApprover)
                  }
                >
                  {isProcessing && <Loader2 className="w-5 h-5 animate-spin mr-2" />}
                  Взять {singleQty || '?'}
                </Button>
                <Button variant="ghost" className="w-full h-12 text-muted-foreground" onClick={resetSingle}>
                  Отмена
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Cart dialog ────────────────────────────────────────────── */}
      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <ShoppingCart className="w-6 h-6" /> Корзина ({cart.length} поз.)
            </DialogTitle>
            <DialogDescription>
              Уточните количества и нажмите «Взять всё». Сканер за фоном пока заморожен.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-2">
            {cart.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                Корзина пуста. Закройте окно и сканируйте.
              </div>
            ) : (
              cart.map((line) => (
                <CartRow
                  key={line.inv.id}
                  line={line}
                  approvers={approvers}
                  needsApprover={needsApprover(line.inv, cartProject)}
                  onChangeQty={(q) => updateCartQty(line.inv.id, q)}
                  onChangeApprover={(v) => updateCartApprover(line.inv.id, v)}
                  onRemove={() => removeCartItem(line.inv.id)}
                />
              ))
            )}
          </div>

          {cart.length > 0 && projects.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t">
              <label className="text-sm font-medium">Проект (общий для всей корзины)</label>
              <Select value={cartProject} onValueChange={setCartProject}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Без проекта" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Без проекта</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-2 border-t">
            <Button variant="ghost" onClick={clearCart} disabled={isProcessing || cart.length === 0} className="text-destructive">
              <Trash2 className="w-4 h-4 mr-1" /> Очистить
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={() => setCartOpen(false)} disabled={isProcessing}>
              Продолжить сканирование
            </Button>
            <Button onClick={submitCart} disabled={isProcessing || cart.length === 0} className="min-w-[180px]">
              {isProcessing
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Оформление…</>
                : <><CheckCircle2 className="w-4 h-4 mr-2" /> Взять всё ({cartTotal})</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── UI helpers ───────────────────────────────────────────────────────────

function CartRow({
  line, approvers, needsApprover, onChangeQty, onChangeApprover, onRemove,
}: {
  line: CartLine
  approvers: Approver[]
  needsApprover: boolean
  onChangeQty: (q: number) => void
  onChangeApprover: (v: string) => void
  onRemove: () => void
}) {
  const { inv, qty, status, errorMsg, approverId } = line
  const max = inv.quantity_available
  const cls =
    status === 'ok' ? 'bg-green-50 border-green-200' :
    status === 'error' ? 'bg-red-50 border-red-200' :
    'bg-card'

  return (
    <div className={`border rounded-xl p-3 space-y-2 ${cls}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate flex items-center gap-2">
            {status === 'ok' && <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />}
            {status === 'error' && <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
            {inv.cell_color && (
              <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: CELL_COLORS[inv.cell_color].hex }} />
            )}
            <span className="truncate">{inv.name}</span>
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {inv.qr_code} · доступно: {max} {unitLabel(inv.unit)}
          </div>
          {errorMsg && <div className="text-xs text-red-600 mt-1">{errorMsg}</div>}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => onChangeQty(qty - 1)} disabled={qty <= 1 || status === 'ok'}>
            <Minus className="w-3.5 h-3.5" />
          </Button>
          <Input
            type="number" min={1} max={max} step={1}
            value={qty}
            onChange={(e) => onChangeQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="w-16 h-8 text-center px-1"
            disabled={status === 'ok'}
          />
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => onChangeQty(qty + 1)} disabled={qty >= max || status === 'ok'}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive ml-1" onClick={onRemove} disabled={status === 'ok'}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {needsApprover && status !== 'ok' && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-md p-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-700 flex-shrink-0" />
          <Select value={approverId ?? ''} onValueChange={onChangeApprover}>
            <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Учитель-разрешивший" /></SelectTrigger>
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
    </div>
  )
}

function ModeTab({
  active, onClick, icon: Icon, label, hint,
}: {
  active: boolean
  onClick: () => void
  icon: any
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
        active ? 'bg-white text-black shadow' : 'text-white/70 hover:text-white'
      }`}
    >
      <span className="flex items-center gap-1.5">
        <Icon className="w-4 h-4" /> {label}
      </span>
      {hint && <span className={`text-[10px] font-normal ${active ? 'text-black/60' : 'text-white/50'}`}>{hint}</span>}
    </button>
  )
}

function Stat({
  label, value, hint, accent = 'gray',
}: { label: string; value: string; hint?: string; accent?: 'green' | 'amber' | 'red' | 'gray' }) {
  const cls =
    accent === 'green' ? 'text-green-700' :
    accent === 'amber' ? 'text-amber-700' :
    accent === 'red'   ? 'text-red-700'   :
                         'text-foreground'
  return (
    <div className="bg-muted/50 rounded-xl p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-xl font-bold leading-tight mt-1 ${cls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  )
}
