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
  getCategories, createCategory, updateCategory, deleteCategory,
} from '@/app/actions/categories'
import { UNITS, type Unit } from '@/lib/units'
import { Loader2, Plus, Trash2, Save } from 'lucide-react'

type Category = {
  id: string
  name: string
  is_consumable: boolean
  default_unit: Unit
  description: string | null
}

export default function CategoryManagement() {
  const { toast } = useToast()
  const [list, setList] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [formName, setFormName] = useState('')
  const [formIsConsumable, setFormIsConsumable] = useState(false)
  const [formUnit, setFormUnit] = useState<Unit>('piece')
  const [formDesc, setFormDesc] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const load = async () => {
    setIsLoading(true)
    try {
      const data = await getCategories()
      setList(data as Category[])
    } catch (e: any) {
      toast({ title: 'Ошибка загрузки', description: e.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setFormName(''); setFormIsConsumable(false); setFormUnit('piece'); setFormDesc('')
    setIsDialogOpen(true)
  }

  const openEdit = (c: Category) => {
    setEditing(c)
    setFormName(c.name)
    setFormIsConsumable(c.is_consumable)
    setFormUnit(c.default_unit)
    setFormDesc(c.description ?? '')
    setIsDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formName.trim()) {
      toast({ title: 'Введите название', variant: 'destructive' })
      return
    }
    setIsSaving(true)
    const payload = {
      name: formName.trim(),
      is_consumable: formIsConsumable,
      default_unit: formUnit,
      description: formDesc.trim() || null,
    }
    const res = editing
      ? await updateCategory(editing.id, payload)
      : await createCategory(payload)
    setIsSaving(false)
    if (res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      return
    }
    toast({ title: editing ? 'Обновлено' : 'Создано' })
    setIsDialogOpen(false)
    load()
  }

  const handleDelete = async (c: Category) => {
    if (!confirm(`Удалить категорию «${c.name}»?`)) return
    const res = await deleteCategory(c.id)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else { toast({ title: 'Удалено' }); load() }
  }

  const unitLabel = (u: string) => UNITS.find((x) => x.value === u)?.label ?? u

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Категории инвентаря</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Чем создаём — расходник это или нет, и в чём измеряется.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1" /> Новая категория
        </Button>
      </div>

      <div className="border rounded-xl bg-card overflow-x-auto shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Название</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Ед. изм.</TableHead>
              <TableHead>Описание</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center h-24"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
            ) : list.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center h-24 text-muted-foreground">Категорий пока нет</TableCell></TableRow>
            ) : (
              list.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      c.is_consumable ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {c.is_consumable ? 'Расходник' : 'Многоразовый'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{unitLabel(c.default_unit)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[260px] truncate">
                    {c.description || '—'}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>Изменить</Button>
                    <Button
                      size="icon" variant="ghost"
                      className="text-destructive hover:bg-destructive/10 ml-1"
                      onClick={() => handleDelete(c)}
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

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{editing ? 'Изменить категорию' : 'Новая категория'}</DialogTitle>
            <DialogDescription>Свойства определят, как считается инвентарь.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Название *</label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Например: Пайка" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Тип</label>
              <Select
                value={formIsConsumable ? 'consumable' : 'reusable'}
                onValueChange={(v) => setFormIsConsumable(v === 'consumable')}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reusable">Многоразовый (вернёт обратно)</SelectItem>
                  <SelectItem value="consumable">Расходник (тратится)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Единица измерения</label>
              <Select value={formUnit} onValueChange={(v) => setFormUnit(v as Unit)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Описание</label>
              <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Необязательно" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>Отмена</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
