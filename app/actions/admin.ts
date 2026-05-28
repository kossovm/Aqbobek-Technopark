'use server'

import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

/**
 * Возвращает строку профиля текущего юзера или бросает ошибку.
 * Используем сессию (RLS пропустит свой профиль).
 */
async function requireStaff() {
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
    throw new Error('Недостаточно прав (только staff)')
  }
  return { user, profile }
}

async function requireAdmin() {
  const { user, profile } = await requireStaff()
  if (profile.role !== 'admin') {
    throw new Error('Недостаточно прав (только admin)')
  }
  return { user, profile }
}

/** Ленивая инициализация service-role клиента: запросим, только когда нужно. */
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY не настроен в .env.local')
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function getPendingUsers() {
  await requireStaff()
  const supabase = createClient()

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, username, email, role, is_approved, class, requested_role, created_at')
    .eq('is_approved', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getAllUsers() {
  await requireStaff()
  const supabase = createClient()

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, username, email, role, is_approved, class, requested_role, created_at')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function approveUser(userId: string) {
  try {
    await requireStaff()
  } catch (e: any) {
    return { error: e.message }
  }

  const supabase = createClient()
  const { error } = await supabase
    .from('users')
    .update({ is_approved: true })
    .eq('id', userId)

  if (error) return { error: error.message }

  revalidatePath('/admin')
  return { success: true }
}

/** Одобрить всех ожидающих пользователей разом. */
export async function approveAllPending() {
  try {
    await requireStaff()
  } catch (e: any) {
    return { error: e.message }
  }

  const supabase = createClient()
  const { error, count } = await supabase
    .from('users')
    .update({ is_approved: true })
    .eq('is_approved', false)

  if (error) return { error: error.message }

  revalidatePath('/admin')
  return { success: true, count }
}

export async function changeUserRole(userId: string, role: string) {
  if (!['student', 'teacher', 'admin'].includes(role)) {
    return { error: 'Недопустимая роль' }
  }
  try {
    await requireAdmin()
  } catch (e: any) {
    return { error: e.message }
  }

  const supabase = createClient()
  const { error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', userId)

  if (error) return { error: error.message }

  revalidatePath('/admin')
  return { success: true }
}

/**
 * Полное удаление пользователя из auth.users (каскадно снесёт public.users).
 * Требует валидный SERVICE_ROLE_KEY. Только admin.
 */
export async function deleteUser(userId: string) {
  try {
    await requireAdmin()
  } catch (e: any) {
    return { error: e.message }
  }

  try {
    const admin = getServiceClient()
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) return { error: error.message }
  } catch (e: any) {
    return { error: e.message }
  }

  revalidatePath('/admin')
  return { success: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// Заявки на смену / сброс пароля
// ═══════════════════════════════════════════════════════════════════════════

export async function getPasswordChangeRequests(statusFilter: 'pending' | 'all' = 'pending') {
  await requireStaff()
  const supabase = createClient()

  let query = supabase
    .from('password_change_requests')
    .select('id, user_id, username, type, status, note, created_at, reviewed_at')
    .order('created_at', { ascending: false })

  if (statusFilter === 'pending') {
    query = query.eq('status', 'pending')
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)

  // Подтягиваем full_name через отдельный запрос (RLS даёт читать staff-у всех)
  const userIds = Array.from(new Set((data ?? []).map((r) => r.user_id).filter(Boolean)))
  let namesMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('users')
      .select('id, full_name')
      .in('id', userIds as string[])
    for (const p of profiles ?? []) {
      namesMap[p.id] = p.full_name ?? ''
    }
  }

  return (data ?? []).map((r) => ({
    ...r,
    full_name: r.user_id ? (namesMap[r.user_id] ?? '') : '',
  }))
}

/**
 * Одобрить заявку: применяем новый пароль через Admin API и помечаем approved.
 * Пароль из поля new_password удаляется (обнуляется) после применения.
 */
export async function approvePasswordChange(requestId: string) {
  let currentUser: Awaited<ReturnType<typeof requireStaff>>['user']
  try {
    const r = await requireStaff()
    currentUser = r.user
  } catch (e: any) {
    return { error: e.message }
  }

  const supabase = createClient()

  // Читаем заявку (service client чтобы получить new_password)
  const admin = getServiceClient()
  const { data: req, error: fetchErr } = await admin
    .from('password_change_requests')
    .select('id, user_id, new_password, status')
    .eq('id', requestId)
    .maybeSingle()

  if (fetchErr || !req) return { error: 'Заявка не найдена' }
  if (req.status !== 'pending') return { error: 'Заявка уже обработана' }
  if (!req.user_id) return { error: 'user_id заявки не задан' }

  // Применяем новый пароль
  const { error: pwdErr } = await admin.auth.admin.updateUserById(req.user_id, {
    password: req.new_password,
  })
  if (pwdErr) return { error: 'Не удалось применить пароль: ' + pwdErr.message }

  // Помечаем как approved, обнуляем пароль
  const { error: updErr } = await admin
    .from('password_change_requests')
    .update({
      status: 'approved',
      new_password: '',
      reviewed_at: new Date().toISOString(),
      reviewed_by: currentUser.id,
    })
    .eq('id', requestId)

  if (updErr) return { error: updErr.message }

  revalidatePath('/admin')
  return { success: true }
}

export async function rejectPasswordChange(requestId: string) {
  let currentUser: Awaited<ReturnType<typeof requireStaff>>['user']
  try {
    const r = await requireStaff()
    currentUser = r.user
  } catch (e: any) {
    return { error: e.message }
  }

  const admin = getServiceClient()
  const { error } = await admin
    .from('password_change_requests')
    .update({
      status: 'rejected',
      new_password: '',
      reviewed_at: new Date().toISOString(),
      reviewed_by: currentUser.id,
    })
    .eq('id', requestId)
    .eq('status', 'pending')

  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

/** Массовое одобрение — последовательно, чтобы один сбой не блокировал остальных. */
export async function bulkApprovePasswordChanges(ids: string[]) {
  const results = await Promise.all(ids.map((id) => approvePasswordChange(id)))
  const errors = results.filter((r) => r.error).map((r) => r.error)
  revalidatePath('/admin')
  if (errors.length > 0) return { error: errors.join('; ') }
  return { success: true }
}

export async function bulkRejectPasswordChanges(ids: string[]) {
  const results = await Promise.all(ids.map((id) => rejectPasswordChange(id)))
  const errors = results.filter((r) => r.error).map((r) => r.error)
  revalidatePath('/admin')
  if (errors.length > 0) return { error: errors.join('; ') }
  return { success: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// Заявки на смену профиля
// ═══════════════════════════════════════════════════════════════════════════

export async function getProfileChangeRequests(statusFilter: 'pending' | 'all' = 'pending') {
  await requireStaff()
  const admin = getServiceClient()

  let query = admin
    .from('profile_change_requests')
    .select(`
      id, user_id, requested_full_name, requested_class, requested_email,
      note, status, created_at, reviewed_at, reject_reason,
      user:user_id(id, full_name, username, email, class)
    `)
    .order('created_at', { ascending: false })

  if (statusFilter === 'pending') query = query.eq('status', 'pending')

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function approveProfileChange(requestId: string) {
  let currentUser: Awaited<ReturnType<typeof requireStaff>>['user']
  try {
    const r = await requireStaff()
    currentUser = r.user
  } catch (e: any) {
    return { error: e.message }
  }

  const admin = getServiceClient()
  const { data: req } = await admin
    .from('profile_change_requests')
    .select('id, user_id, requested_full_name, requested_class, requested_email, status')
    .eq('id', requestId)
    .maybeSingle()
  if (!req) return { error: 'Заявка не найдена' }
  if (req.status !== 'pending') return { error: 'Заявка уже обработана' }

  const patch: Record<string, any> = {}
  if (req.requested_full_name) patch.full_name = req.requested_full_name
  if (req.requested_class)     patch.class     = req.requested_class

  // Email — обновляем и в auth.users, и в public.users
  if (req.requested_email) {
    const { error: authErr } = await admin.auth.admin.updateUserById(req.user_id, {
      email: req.requested_email,
      email_confirm: true,
    })
    if (authErr) return { error: 'Не удалось сменить email в auth: ' + authErr.message }
    patch.email = req.requested_email
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from('users').update(patch).eq('id', req.user_id)
    if (error) return { error: error.message }
  }

  await admin
    .from('profile_change_requests')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: currentUser.id,
    })
    .eq('id', requestId)

  revalidatePath('/admin')
  revalidatePath('/profile')
  return { success: true }
}

export async function rejectProfileChange(requestId: string, reason?: string) {
  let currentUser: Awaited<ReturnType<typeof requireStaff>>['user']
  try {
    const r = await requireStaff()
    currentUser = r.user
  } catch (e: any) {
    return { error: e.message }
  }

  const admin = getServiceClient()
  const { error } = await admin
    .from('profile_change_requests')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: currentUser.id,
      reject_reason: reason?.trim() || null,
    })
    .eq('id', requestId)
    .eq('status', 'pending')
  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/profile')
  return { success: true }
}

export async function bulkApproveProfileChanges(ids: string[]) {
  const results = await Promise.all(ids.map((id) => approveProfileChange(id)))
  const errors = results.filter((r) => r.error).map((r) => r.error)
  if (errors.length > 0) return { error: errors.join('; ') }
  return { success: true }
}

export async function bulkRejectProfileChanges(ids: string[]) {
  const results = await Promise.all(ids.map((id) => rejectProfileChange(id)))
  const errors = results.filter((r) => r.error).map((r) => r.error)
  if (errors.length > 0) return { error: errors.join('; ') }
  return { success: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// Перевыпуск login_qr_token админом (тоже без подтверждения)
// ═══════════════════════════════════════════════════════════════════════════

export async function regenerateUserLoginQR(userId: string) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()
  const { data: token, error: rpcErr } = await admin.rpc('gen_login_qr_token')
  if (rpcErr || !token) return { error: rpcErr?.message || 'Не удалось сгенерировать токен' }
  const { error } = await admin
    .from('users')
    .update({ login_qr_token: token })
    .eq('id', userId)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true, token: token as string }
}
