'use client'

import { useEffect, useState } from 'react'
import {
  getScheduleForDay, createScheduleEvent, deleteScheduleEvent,
  type ScheduleEvent, type DayOfWeek, DAY_NAMES,
} from '@/app/actions/schedule'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { LogoSpinner } from '@/components/Logo'
import { Plus, Trash2, Clock, Users, CalendarDays } from 'lucide-react'

function getISODay(): DayOfWeek {
  const d = new Date().getDay()
  return (d === 0 ? 7 : d) as DayOfWeek
}

function useLocalTime() {
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')
  useEffect(() => {
    const fmt = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setDate(now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))
    }
    fmt()
    const id = setInterval(fmt, 1000)
    return () => clearInterval(id)
  }, [])
  return { time, date }
}

export default function ScheduleWidget({
  userId,
  role,
}: {
  userId: string
  role: string
}) {
  const { toast } = useToast()
  const { time, date } = useLocalTime()
  const today = getISODay()

  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [classGroup, setClassGroup] = useState('')
  const [dayOfWeek, setDayOfWeek] = useState<DayOfWeek>(today)
  const [timeStart, setTimeStart] = useState('')
  const [timeEnd, setTimeEnd] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const load = async () => {
    setIsLoading(true)
    try {
      const data = await getScheduleForDay(today)
      setEvents(data)
    } catch { /* ignore */ }
    setIsLoading(false)
  }
  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!title.trim() || !timeStart) {
      toast({ title: 'Заполните название и время', variant: 'destructive' })
      return
    }
    setIsSaving(true)
    const res = await createScheduleEvent({
      title, description: desc || null,
      class_group: classGroup || null,
      day_of_week: dayOfWeek,
      time_start: timeStart,
      time_end: timeEnd || null,
    })
    setIsSaving(false)
    if ('error' in res && res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Событие добавлено' })
    setAddOpen(false)
    setTitle(''); setDesc(''); setClassGroup(''); setTimeStart(''); setTimeEnd('')
    setDayOfWeek(today)
    load()
  }

  const handleDelete = async (ev: ScheduleEvent) => {
    if (role !== 'admin' && role !== 'teacher' && ev.author_id !== userId) {
      toast({ title: 'Нельзя удалить чужое событие', variant: 'destructive' })
      return
    }
    if (!confirm(`Удалить «${ev.title}»?`)) return
    const res = await deleteScheduleEvent(ev.id)
    if ('error' in res && res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      return
    }
    load()
  }

  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  const isActive = (ev: ScheduleEvent) => {
    const [sh, sm] = ev.time_start.split(':').map(Number)
    const start = sh * 60 + sm
    if (!ev.time_end) return nowMinutes >= start && nowMinutes < start + 60
    const [eh, em] = ev.time_end.split(':').map(Number)
    const end = eh * 60 + em
    return nowMinutes >= start && nowMinutes < end
  }

  const isPast = (ev: ScheduleEvent) => {
    const ref = ev.time_end ?? ev.time_start
    const [h, m] = ref.split(':').map(Number)
    return nowMinutes > h * 60 + m
  }

  return (
    <section className="space-y-3">
      {/* Clock header */}
      <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-card to-card p-4 md:p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-3xl md:text-4xl font-bold tabular-nums tracking-tight gradient-text">
              {time || '––:––:––'}
            </div>
            <div className="text-sm text-muted-foreground capitalize mt-0.5">{date}</div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-2 rounded-full"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="w-4 h-4" /> Добавить в расписание
          </Button>
        </div>
      </div>

      {/* Events list */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <CalendarDays className="w-4 h-4" /> Расписание на сегодня — {DAY_NAMES[today]}
        </h3>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <LogoSpinner size={32} />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-xl">
            Событий нет. Добавьте первое!
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((ev) => {
              const active = isActive(ev)
              const past = !active && isPast(ev)
              return (
                <div
                  key={ev.id}
                  className={`relative rounded-xl border p-3.5 flex items-start justify-between gap-3 transition-all ${
                    active
                      ? 'border-primary/40 bg-primary/5 shadow-sm shadow-primary/10'
                      : past
                        ? 'opacity-50 bg-card'
                        : 'bg-card hover:shadow-sm'
                  }`}
                >
                  {active && (
                    <span className="absolute -top-px left-4 right-4 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {active && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-primary text-primary-foreground text-[9px] font-bold uppercase rounded-md tracking-wider">
                          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" /> СЕЙЧАС
                        </span>
                      )}
                      <span className="font-semibold text-sm">{ev.title}</span>
                    </div>
                    {ev.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ev.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {ev.time_start.slice(0, 5)}{ev.time_end ? ` – ${ev.time_end.slice(0, 5)}` : ''}
                      </span>
                      {ev.class_group && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" /> {ev.class_group}
                        </span>
                      )}
                      {ev.author && (
                        <span className="text-muted-foreground/60">
                          {ev.author.full_name || ev.author.username}
                        </span>
                      )}
                    </div>
                  </div>
                  {(role === 'admin' || role === 'teacher' || ev.author_id === userId) && (
                    <button
                      type="button"
                      onClick={() => handleDelete(ev)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded-md hover:bg-destructive/10 flex-shrink-0"
                      title="Удалить"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-primary" /> Новое событие
            </DialogTitle>
            <DialogDescription>
              Событие отобразится в расписании у всех пользователей. Удалить его может только администратор или вы сами.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Input
              placeholder="Название *"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Input
              placeholder="Описание"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            <Input
              placeholder="Класс / группа (напр. 10А)"
              value={classGroup}
              onChange={(e) => setClassGroup(e.target.value)}
            />
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">День недели</label>
              <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v) as DayOfWeek)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(DAY_NAMES) as [string, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Начало *</label>
                <Input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Конец</label>
                <Input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={isSaving}>Отмена</Button>
            <Button onClick={handleAdd} disabled={isSaving}>
              {isSaving ? <LogoSpinner size={16} className="mr-2" /> : <Plus className="w-4 h-4 mr-1" />}
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
