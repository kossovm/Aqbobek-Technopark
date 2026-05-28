'use server'

import { createClient } from '@/utils/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

const supabaseAdmin = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function getApprovedUser() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Необходима авторизация')
  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('id, role, is_approved')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_approved) throw new Error('Аккаунт не подтверждён')
  return { user, profile }
}

export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7
export const DAY_NAMES: Record<DayOfWeek, string> = {
  1: 'Понедельник', 2: 'Вторник', 3: 'Среда', 4: 'Четверг',
  5: 'Пятница', 6: 'Суббота', 7: 'Воскресенье',
}

export type ScheduleEvent = {
  id: string
  title: string
  description: string | null
  class_group: string | null
  day_of_week: DayOfWeek
  time_start: string
  time_end: string | null
  author_id: string | null
  created_at: string
  author?: { full_name: string | null; username: string | null; role: string } | null
}

/** Получить события за конкретный день недели (1-7). */
export async function getScheduleForDay(day: DayOfWeek): Promise<ScheduleEvent[]> {
  const { data, error } = await supabaseAdmin
    .from('schedule_events')
    .select(`
      id, title, description, class_group,
      day_of_week, time_start, time_end, author_id, created_at,
      author:author_id(full_name, username, role)
    `)
    .eq('day_of_week', day)
    .order('time_start', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ScheduleEvent[]
}

/** Получить все события (для управления в админке). */
export async function getAllScheduleEvents(): Promise<ScheduleEvent[]> {
  const { data, error } = await supabaseAdmin
    .from('schedule_events')
    .select(`
      id, title, description, class_group,
      day_of_week, time_start, time_end, author_id, created_at,
      author:author_id(full_name, username, role)
    `)
    .order('day_of_week', { ascending: true })
    .order('time_start', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ScheduleEvent[]
}

export async function createScheduleEvent(input: {
  title: string
  description?: string | null
  class_group?: string | null
  day_of_week: DayOfWeek
  time_start: string
  time_end?: string | null
}) {
  const { user } = await getApprovedUser()

  if (!input.title?.trim()) return { error: 'Заголовок обязателен' }
  if (!input.time_start?.trim()) return { error: 'Время начала обязательно' }

  const { data, error } = await supabaseAdmin
    .from('schedule_events')
    .insert({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      class_group: input.class_group?.trim() || null,
      day_of_week: input.day_of_week,
      time_start: input.time_start,
      time_end: input.time_end || null,
      author_id: user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/')
  revalidatePath('/admin')
  return { id: data.id }
}

export async function updateScheduleEvent(id: string, input: {
  title?: string
  description?: string | null
  class_group?: string | null
  day_of_week?: DayOfWeek
  time_start?: string
  time_end?: string | null
}) {
  const { user, profile } = await getApprovedUser()

  const { data: ev } = await supabaseAdmin
    .from('schedule_events')
    .select('author_id')
    .eq('id', id)
    .maybeSingle()

  if (!ev) return { error: 'Событие не найдено' }
  if (ev.author_id !== user.id && profile.role !== 'admin' && profile.role !== 'teacher') {
    return { error: 'Нет прав на редактирование' }
  }

  const patch: any = {}
  if (input.title !== undefined) patch.title = input.title.trim()
  if (input.description !== undefined) patch.description = input.description?.trim() || null
  if (input.class_group !== undefined) patch.class_group = input.class_group?.trim() || null
  if (input.day_of_week !== undefined) patch.day_of_week = input.day_of_week
  if (input.time_start !== undefined) patch.time_start = input.time_start
  if (input.time_end !== undefined) patch.time_end = input.time_end || null
  patch.updated_at = new Date().toISOString()

  const { error } = await supabaseAdmin.from('schedule_events').update(patch).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/')
  revalidatePath('/admin')
  return { success: true }
}

export async function deleteScheduleEvent(id: string) {
  const { user, profile } = await getApprovedUser()

  const { data: ev } = await supabaseAdmin
    .from('schedule_events')
    .select('author_id')
    .eq('id', id)
    .maybeSingle()

  if (!ev) return { error: 'Событие не найдено' }

  // Только admin может удалять чужие события; автор может свои; teacher тоже может
  const isAdmin = profile.role === 'admin'
  const isOwner = ev.author_id === user.id
  const isTeacher = profile.role === 'teacher'

  if (!isAdmin && !isOwner && !isTeacher) {
    return { error: 'Только администратор может удалять чужие события' }
  }

  const { error } = await supabaseAdmin.from('schedule_events').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/')
  revalidatePath('/admin')
  return { success: true }
}
