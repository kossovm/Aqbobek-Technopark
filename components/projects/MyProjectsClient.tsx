'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
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
  getMyProjects, getMyProjectDetails, updateMyProject,
} from '@/app/actions/projects'
import { CELL_COLORS, type CellColor } from '@/lib/cells'
import {
  Loader2, Save, FolderKanban, Users, Pencil,
  Package, Undo2, MapPin, ShieldCheck,
} from 'lucide-react'

type CellRef = {
  id: string
  code: string
  color: CellColor
  locations?: { name: string } | { name: string }[] | null
} | null

type Project = {
  id: string
  name: string
  description: string | null
  status: 'planning' | 'active' | 'completed' | 'archived'
  cell_id: string | null
  cells?: any
}

type Member = {
  user_id: string
  users: { id: string; full_name: string | null; username: string | null; role: string } | null
}

type ActiveTx = {
  id: string
  quantity: number
  issued_at: string
  user_id: string
  users: { full_name: string | null; username: string | null } | null
  inventory: {
    id: string
    name: string
    qr_code: string
    unit: string
    home_cell?: {
      code: string
      color: CellColor
      locations?: { name: string } | { name: string }[] | null
    } | null
  } | null
}

type Details = {
  project: Project & { cells?: CellRef }
  isStaff: boolean
  members: Member[]
  activeTransactions: ActiveTx[]
}

const STATUS_OPTIONS: { value: Project['status']; label: string; cls: string }[] = [
  { value: 'planning',  label: 'В планах',  cls: 'bg-blue-100 text-blue-700' },
  { value: 'active',    label: 'Активный',  cls: 'bg-green-100 text-green-700' },
  { value: 'completed', label: 'Завершён',  cls: 'bg-purple-100 text-purple-700' },
  { value: 'archived',  label: 'Архив',     cls: 'bg-muted text-muted-foreground' },
]

export default function MyProjectsClient() {
  const { toast } = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Details modal
  const [openId, setOpenId] = useState<string | null>(null)
  const [details, setDetails] = useState<Details | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)

  // Edit form
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editStatus, setEditStatus] = useState<Project['status']>('planning')
  const [isSaving, setIsSaving] = useState(false)

  const load = async () => {
    setIsLoading(true)
    try {
      const list = await getMyProjects()
      setProjects(list as Project[])
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const openDetails = async (id: string) => {
    setOpenId(id); setDetails(null); setDetailsLoading(true)
    const res: any = await getMyProjectDetails(id)
    setDetailsLoading(false)
    if ('error' in res) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      setOpenId(null)
      return
    }
    setDetails(res as Details)
    setEditName(res.project.name)
    setEditDesc(res.project.description ?? '')
    setEditStatus(res.project.status)
  }

  const closeDetails = () => { setOpenId(null); setDetails(null) }

  const handleSave = async () => {
    if (!details) return
    setIsSaving(true)
    const res = await updateMyProject(details.project.id, {
      name: editName, description: editDesc, status: editStatus,
    })
    setIsSaving(false)
    if (res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Сохранено' })
    await openDetails(details.project.id)
    load()
  }

  const renderCell = (project: Project) => {
    const c = Array.isArray(project.cells) ? project.cells[0] : project.cells
    if (!c) return null
    const loc = Array.isArray(c.locations) ? c.locations[0] : c.locations
    const color = CELL_COLORS[c.color as CellColor] ?? CELL_COLORS.blue
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color.hex }} />
        <code className="font-bold">{c.code}</code>
        {loc?.name && <span className="text-muted-foreground truncate">· {loc.name}</span>}
      </div>
    )
  }

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8 space-y-6 mt-2">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FolderKanban className="w-7 h-7" /> Мои проекты
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Здесь команды берут инвентарь, возвращают его друг за друга и редактируют свои проекты.
          </p>
        </div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← На главную</Link>
      </header>

      {isLoading ? (
        <div className="text-center py-12">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-card border border-dashed rounded-2xl p-10 text-center text-muted-foreground">
          <FolderKanban className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Вы пока не состоите ни в одном проекте.</p>
          <p className="text-xs mt-1">Попросите учителя добавить вас в команду.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {projects.map((p) => {
            const status = STATUS_OPTIONS.find((s) => s.value === p.status)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => openDetails(p.id)}
                className="text-left bg-card border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-lg leading-tight">{p.name}</h3>
                  <Pencil className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </div>
                {p.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>
                )}
                <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${status?.cls}`}>
                    {status?.label}
                  </span>
                  {renderCell(p)}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!openId} onOpenChange={(o) => !o && closeDetails()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {detailsLoading && (
            <div className="py-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          )}
          {details && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-2xl">
                  <FolderKanban className="w-6 h-6" /> {details.project.name}
                </DialogTitle>
                <DialogDescription>
                  Редактируйте основные поля и работайте с инвентарём команды.
                </DialogDescription>
              </DialogHeader>

              {/* ── Basic edit ── */}
              <section className="space-y-3 border rounded-xl p-3 bg-card">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Название</label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Описание</label>
                  <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Кратко: что и для чего" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Статус</label>
                  <Select value={editStatus} onValueChange={(v) => setEditStatus(v as Project['status'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {details.project.cell_id && details.project.cells && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1 border-t mt-2">
                    <MapPin className="w-3.5 h-3.5" />
                    Ячейка проекта: {(() => {
                      const c: any = Array.isArray(details.project.cells) ? details.project.cells[0] : details.project.cells
                      const color = CELL_COLORS[c.color as CellColor]?.hex
                      const loc = Array.isArray(c.locations) ? c.locations[0] : c.locations
                      return (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                          <code className="font-bold">{c.code}</code>
                          {loc?.name && <span>· {loc.name}</span>}
                        </span>
                      )
                    })()}
                    <span className="ml-auto text-[10px] uppercase tracking-wider opacity-70">меняет только админ</span>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                    Сохранить
                  </Button>
                </div>
              </section>

              {/* ── Members ── */}
              <section className="space-y-2">
                <h3 className="font-bold text-sm flex items-center gap-1.5 text-foreground/80">
                  <Users className="w-4 h-4" /> Команда ({details.members.length})
                </h3>
                {details.members.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Команда пока пуста</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {details.members.map((m) => (
                      <div key={m.user_id} className="bg-muted/50 rounded-lg px-2 py-1.5 text-xs">
                        <div className="font-medium truncate">{m.users?.full_name || m.users?.username}</div>
                        <div className="text-muted-foreground text-[10px] flex items-center gap-1">
                          {m.users?.role === 'teacher' && <ShieldCheck className="w-3 h-3" />}
                          {m.users?.role === 'admin' && <ShieldCheck className="w-3 h-3 text-primary" />}
                          {m.users?.username} · {m.users?.role}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── Active inventory ── */}
              <section className="space-y-2">
                <h3 className="font-bold text-sm flex items-center gap-1.5 text-foreground/80">
                  <Package className="w-4 h-4" /> Инвентарь команды на руках ({details.activeTransactions.length})
                </h3>
                {details.activeTransactions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">У команды сейчас ничего не взято.</p>
                ) : (
                  <div className="space-y-1.5">
                    {details.activeTransactions.map((tx) => {
                      const inv = tx.inventory
                      if (!inv) return null
                      const home = inv.home_cell
                      const homeLoc = home && (Array.isArray(home.locations) ? home.locations[0] : home.locations)
                      const hex = home ? CELL_COLORS[home.color as CellColor]?.hex : undefined
                      const returnUrl = '/scanner?mode=return'
                      return (
                        <div key={tx.id} className="border rounded-lg p-2.5 flex items-center gap-3 bg-card">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold truncate">
                              {inv.name}
                              {tx.quantity > 1 && <span className="ml-1 text-xs text-amber-700">×{tx.quantity}</span>}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              у {tx.users?.full_name || tx.users?.username || '—'} · {new Date(tx.issued_at).toLocaleDateString('ru-RU')}
                            </div>
                            {home && (
                              <div className="text-[11px] flex items-center gap-1.5 mt-0.5">
                                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: hex }} />
                                <code className="font-bold">{home.code}</code>
                                {homeLoc?.name && <span className="text-muted-foreground">· {homeLoc.name}</span>}
                              </div>
                            )}
                          </div>
                          <Link
                            href={returnUrl}
                            className="flex-shrink-0 text-xs font-bold text-primary bg-primary/10 px-3 py-1.5 rounded-lg hover:bg-primary/20 transition-colors flex items-center gap-1"
                          >
                            <Undo2 className="w-3.5 h-3.5" /> Вернуть
                          </Link>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              <DialogFooter>
                <Button variant="outline" onClick={closeDetails}>Закрыть</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}
