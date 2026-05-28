'use server'

import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

const SYNTH_EMAIL_DOMAIN = 'aqbobek.kz'

type Role = 'student' | 'teacher' | 'admin'

export type NewStudentInput = {
  username: string
  fullName: string
  password: string
  email?: string | null
  role?: Role
}

export type CreateResult = {
  username: string
  status: 'ok' | 'error'
  error?: string
  userId?: string
}

async function requireStaff(): Promise<'admin' | 'teacher'> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Необходима авторизация')

  const { data: profile, error } = await supabase
    .from('users')
    .select('role, is_approved')
    .eq('id', user.id)
    .maybeSingle()

  if (error) throw new Error('Не удалось проверить права: ' + error.message)
  if (!profile || !profile.is_approved) throw new Error('Аккаунт не подтверждён')
  if (profile.role !== 'admin' && profile.role !== 'teacher') {
    throw new Error('Недостаточно прав')
  }
  return profile.role as 'admin' | 'teacher'
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY не настроен в .env.local')
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function normalizeUsername(u: string) {
  return String(u || '').trim().toLowerCase()
}
function isValidUsername(u: string) {
  return /^[a-z0-9_.-]{3,32}$/i.test(u)
}

/**
 * Создаёт учеников пачкой. Каждый ученик сразу is_approved=true.
 * Использует Admin API (service_role) — поэтому email_confirm=true,
 * подтверждение почты не требуется.
 */
export async function bulkCreateStudents(
  students: NewStudentInput[]
): Promise<{ results?: CreateResult[]; error?: string }> {
  let callerRole: 'admin' | 'teacher'
  try {
    callerRole = await requireStaff()
  } catch (e: any) {
    return { error: e.message }
  }

  if (!Array.isArray(students) || students.length === 0) {
    return { error: 'Список учеников пуст' }
  }

  let admin
  try {
    admin = getServiceClient()
  } catch (e: any) {
    return { error: e.message }
  }

  const results: CreateResult[] = []
  const seenUsernames = new Set<string>()

  for (const raw of students) {
    const username = normalizeUsername(raw.username)
    const fullName = String(raw.fullName || '').trim()
    const password = String(raw.password || '')
    const email = raw.email ? String(raw.email).trim().toLowerCase() : null
    const role: Role = raw.role && ['student', 'teacher', 'admin'].includes(raw.role)
      ? raw.role
      : 'student'

    // Только admin может выдавать роли teacher/admin
    const effectiveRole: Role = callerRole === 'admin' ? role : 'student'

    if (!username || !fullName || !password) {
      results.push({ username, status: 'error', error: 'Не заполнены логин, ФИО или пароль' })
      continue
    }
    if (!isValidUsername(username)) {
      results.push({ username, status: 'error', error: 'Логин: 3–32 символа, латиница/цифры/_.-' })
      continue
    }
    if (password.length < 6) {
      results.push({ username, status: 'error', error: 'Пароль ≥ 6 символов' })
      continue
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      results.push({ username, status: 'error', error: 'Email некорректен' })
      continue
    }
    if (seenUsernames.has(username)) {
      results.push({ username, status: 'error', error: 'Дубликат логина в списке' })
      continue
    }
    seenUsernames.add(username)

    // Если задан реальный email — он становится auth-email (удобно для
    // восстановления пароля). Иначе используем синтетический <username>@aqbobek.kz.
    const authEmail = email ?? `${username}@${SYNTH_EMAIL_DOMAIN}`

    const { data, error } = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        username,
      },
    })

    if (error || !data.user) {
      const msg = error?.message || 'Не удалось создать в Auth'
      results.push({
        username,
        status: 'error',
        error: /already.*registered|exists/i.test(msg) ? 'Логин уже занят' : msg,
      })
      continue
    }

    // Триггер handle_new_user уже вставил строку в public.users (с email = authEmail).
    // Доводим её до боевого состояния: is_approved=true, нужная роль,
    // public.users.email — то же что в auth.users (синтетический скрывается на UI).
    const { error: updErr } = await admin
      .from('users')
      .update({
        is_approved: true,
        role: effectiveRole,
        full_name: fullName,
        email: authEmail,
        username,
      })
      .eq('id', data.user.id)

    if (updErr) {
      results.push({
        username,
        status: 'error',
        error: 'Auth создан, профиль не обновлён: ' + updErr.message,
        userId: data.user.id,
      })
      continue
    }

    results.push({ username, status: 'ok', userId: data.user.id })
  }

  revalidatePath('/admin')
  return { results }
}
