'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import {
  getProjects, createProject, updateProject, deleteProject,
  getApprovedUsers, getProjectDetails, addProjectMember, removeProjectMember,
} from '@/app/actions/projects'
import { getAvailableBlueCells } from '@/app/actions/cells'
import { Loader2, Plus, Trash2, Save, Users, X, UserPlus } from 'lucide-react'

type Project = {
  id: string
  name: string
  description: string | null
  status: 'planning' | 'active' | 'completed' | 'archived'
  cell_id: string | null
  cells?: any
}

type BlueCell = {
  id: string
  code: string
  qr_code: string
  location_id: string
  locations: { name: string } | { name: string }[] | null
}

type Person = { id: string; full_name: string | null; username: string | null; role: string }

const STATUS_OPTIONS: { value: Project['status']; label: string }[] = [
  { value: 'planning',  label: 'В планах' },
  { value: 'active',    label: 'Активный' },
  { value: 'completed', label: 'Завершён' },
  { value: 'archived',  label: 'Архив' },
]

export default function ProjectManagement() {
  const { toast } = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [blueCells, setBlueCells] = useState<BlueCell[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [status, setStatus] = useState<Project['status']>('planning')
  const [cellId, setCellId] = useState<string>('none')
  const [isSaving, setIsSaving] = useState(false)

  // Members dialog
  const [memOpen, setMemOpen] = useState(false)
  const [memProject, setMemProject] = useState<Project | null>(null)
  const [memMembers, setMemMembers] = useState<Person[]>([])
  const [memSelectUser, setMemSelectUser] = useState('')
  const [memBusy, setMemBusy] = useState(false)

  const load = async () => {
    setIsLoading(true)
    try {
      const [p, u] = await Promise.all([getProjects(), getApprovedUsers()])
      setProjects(p as unknown as Project[])
      setPeople(u as Person[])
    } catch (e: any) {
      toast({ title: 'Ошибка загрузки', description: e.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const loadBlueCells = async (includeId?: string | null) => {
    const cells = await getAvailableBlueCells(includeId ?? null)
    setBlueCells(cells as BlueCell[])
  }

  const openCreate = async () => {
    setEditing(null)
    setName(''); setDesc(''); setStatus('planning'); setCellId('none')
    await loadBlueCells(null)
    setEditOpen(true)
  }

  const openEdit = async (p: Project) => {
    setEditing(p)
    setName(p.name); setDesc(p.description ?? '')
    setStatus(p.status); setCellId(p.cell_id ?? 'none')
    await loadBlueCells(p.cell_id ?? null)
    setEditOpen(true)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Введите название', variant: 'destructive' })
      return
    }
    setIsSaving(true)
    const payload = {
      name: name.trim(),
      description: desc.trim() || null,
      status,
      cell_id: cellId === 'none' ? null : cellId,
    }
    const res = editing
      ? await updateProject(editing.id, payload)
      : await createProject(payload)
    setIsSaving(false)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: editing ? 'Обновлено' : 'Создано' }); setEditOpen(false); load() }
  }

  const handleDelete = async (p: Project) => {
    if (!confirm(`Удалить проект «${p.name}» вместе со связями?`)) return
    const res = await deleteProject(p.id)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: 'Удалено' }); load() }
  }

  const openMembers = async (p: Project) => {
    setMemProject(p); setMemMembers([]); setMemSelectUser('')
    setMemOpen(true)
    const res = await getProjectDetails(p.id)
    if ('error' in res) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      return
    }
    setMemMembers(((res.members ?? []).map((m: any) => m.users).filter(Boolean)) as Person[])
  }

  const refreshMembers = async () => {
    if (!memProject) return
    const res = await getProjectDetails(memProject.id)
    if (!('error' in res)) {
      setMemMembers(((res.members ?? []).map((m: any) => m.users).filter(Boolean)) as Person[])
    }
  }

  const handleAddMember = async () => {
    if (!memProject || !memSelectUser) return
    setMemBusy(true)
    const res = await addProjectMember(memProject.id, memSelectUser)
    setMemBusy(false)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { setMemSelectUser(''); refreshMembers() }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!memProject) return
    setMemBusy(true)
    const res = await removeProjectMember(memProject.id, userId)
    setMemBusy(false)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else refreshMembers()
  }

  const memberIds = new Set(memMembers.map((m) => m.id))
  const availableToAdd = people.filter((p) => !memberIds.has(p.id))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Проекты</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Команды и их инвентарные коробки. При взятии оборудования ученик может выбрать проект.
          </p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Новый проект</Button>
      </div>

      <div className="border rounded-xl bg-card overflow-x-auto shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Название</TableHead>
              <TableHead>Описание</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Ячейка</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center h-24"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : projects.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground">Проектов пока нет</TableCell></TableRow>
            ) : (
              projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[280px] truncate">{p.description || '—'}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      p.status === 'active' ? 'bg-green-100 text-green-700' :
                      p.status === 'planning' ? 'bg-blue-100 text-blue-700' :
                      p.status === 'completed' ? 'bg-purple-100 text-purple-700' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {STATUS_OPTIONS.find((s) => s.value === p.status)?.label || p.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{
                    (() => {
                      const c = Array.isArray(p.cells) ? p.cells[0] : p.cells
                      if (!c) return '—'
                      const loc = Array.isArray(c.locations) ? c.locations[0] : c.locations
                      return (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#2567e7' }} />
                          <code className="font-bold">{c.code}</code>
                          {loc?.name && <span className="text-muted-foreground">· {loc.name}</span>}
                        </span>
                      )
                    })()
                  }</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => openMembers(p)}>
                      <Users className="w-4 h-4 mr-1" /> Команда
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>Изменить</Button>
                    <Button
                      size="icon" variant="ghost"
                      className="text-destructive hover:bg-destructive/10 ml-1"
                      onClick={() => handleDelete(p)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editing ? 'Изменить проект' : 'Новый проект'}</DialogTitle>
            <DialogDescription>Заполните поля и сохраните.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Название *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Описание</label>
              <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Кратко: что и для чего" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Статус</label>
                <Select value={status} onValueChange={(v) => setStatus(v as Project['status'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Синяя ячейка</label>
                <Select value={cellId} onValueChange={setCellId}>
                  <SelectTrigger><SelectValue placeholder="Не привязано" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не привязано</SelectItem>
                    {blueCells.map((c) => {
                      const loc = Array.isArray(c.locations) ? c.locations[0] : c.locations
                      return (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="font-bold">{c.code}</span>
                          {loc?.name && <span className="text-muted-foreground"> · {loc.name}</span>}
                        </SelectItem>
                      )
                    })}
                    {blueCells.length === 0 && (
                      <div className="text-xs text-muted-foreground p-2">Нет свободных синих ячеек</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={isSaving}>Отмена</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members dialog */}
      <Dialog open={memOpen} onOpenChange={setMemOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Команда: {memProject?.name}</DialogTitle>
            <DialogDescription>Добавляйте учеников и учителей в проект.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Select value={memSelectUser} onValueChange={setMemSelectUser}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Выберите пользователя" /></SelectTrigger>
                <SelectContent>
                  {availableToAdd.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name || u.username} <span className="text-muted-foreground">({u.role})</span>
                    </SelectItem>
                  ))}
                  {availableToAdd.length === 0 && (
                    <div className="text-sm text-muted-foreground p-2">Все одобренные уже добавлены</div>
                  )}
                </SelectContent>
              </Select>
              <Button onClick={handleAddMember} disabled={!memSelectUser || memBusy}>
                <UserPlus className="w-4 h-4 mr-1" /> Добавить
              </Button>
            </div>

            <div className="border rounded-lg max-h-[280px] overflow-auto">
              {memMembers.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Команда пока пуста</div>
              ) : (
                <div className="divide-y">
                  {memMembers.map((m) => (
                    <div key={m.id} className="flex items-center justify-between p-2.5">
                      <div>
                        <div className="font-medium text-sm">{m.full_name || m.username}</div>
                        <div className="text-xs text-muted-foreground">{m.username} · {m.role}</div>
                      </div>
                      <Button
                        size="icon" variant="ghost"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => handleRemoveMember(m.id)}
                        disabled={memBusy}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemOpen(false)}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
