'use server'

import { createClient } from '@/utils/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function requireUser() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Необходима авторизация')
  return user
}

// ─── Получение профиля ──────────────────────────────────────────────────────

export async function getMyProfile() {
  const user = await requireUser()
  const admin = getServiceClient()
  const { data, error } = await admin
    .from('users')
    .select('id, full_name, username, email, class, role, is_approved, login_qr_token')
    .eq('id', user.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function getMyPendingProfileRequest() {
  const user = await requireUser()
  const admin = getServiceClient()
  const { data } = await admin
    .from('profile_change_requests')
    .select('id, requested_full_name, requested_class, requested_email, note, status, created_at')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

// ─── Подача заявки ───────────────────────────────────────────────────────────

export async function submitProfileChangeRequest(input: {
  full_name?: string | null
  class?: string | null
  email?: string | null
  note?: string | null
}) {
  let user
  try { user = await requireUser() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()

  // Только одна pending-заявка на пользователя
  const { count } = await admin
    .from('profile_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'pending')
  if ((count ?? 0) > 0) {
    return { error: 'У вас уже есть заявка на проверке. Дождитесь её обработки.' }
  }

  // Что хотим менять (нормализуем)
  const { data: cur } = await admin
    .from('users')
    .select('full_name, class, email')
    .eq('id', user.id)
    .maybeSingle()
  if (!cur) return { error: 'Профиль не найден' }

  const wantName  = (input.full_name ?? '').trim()
  const wantClass = (input.class ?? '').trim()
  const wantEmail = (input.email ?? '').trim().toLowerCase()

  const reqName  = wantName  && wantName  !== (cur.full_name ?? '')        ? wantName  : null
  const reqClass = wantClass && wantClass !== (cur.class     ?? '')        ? wantClass : null
  const reqEmail = wantEmail && wantEmail !== (cur.email     ?? '').toLowerCase() ? wantEmail : null

  if (!reqName && !reqClass && !reqEmail) {
    return { error: 'Нет изменений для отправки' }
  }

  if (reqEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reqEmail)) {
    return { error: 'Email указан некорректно' }
  }

  const { error } = await admin
    .from('profile_change_requests')
    .insert({
      user_id: user.id,
      requested_full_name: reqName,
      requested_class: reqClass,
      requested_email: reqEmail,
      note: input.note?.trim() || null,
    })
  if (error) return { error: error.message }

  revalidatePath('/profile')
  revalidatePath('/admin')
  return { success: true }
}

export async function cancelMyPendingProfileRequest() {
  let user
  try { user = await requireUser() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()
  const { error } = await admin
    .from('profile_change_requests')
    .delete()
    .eq('user_id', user.id)
    .eq('status', 'pending')
  if (error) return { error: error.message }
  revalidatePath('/profile')
  return { success: true }
}

// ─── QR-вход: перевыпуск токена ──────────────────────────────────────────────

/**
 * Перевыпуск собственного QR-токена. Без подтверждения — нужно для случаев
 * "QR скомпрометирован, перевыпускаю".
 */
export async function regenerateMyLoginQR() {
  let user
  try { user = await requireUser() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()

  // Сгенерируем токен через RPC (на стороне БД)
  const { data: token, error: rpcErr } = await admin.rpc('gen_login_qr_token')
  if (rpcErr || !token) return { error: rpcErr?.message || 'Не удалось сгенерировать токен' }

  const { error } = await admin
    .from('users')
    .update({ login_qr_token: token })
    .eq('id', user.id)
  if (error) return { error: error.message }

  revalidatePath('/profile')
  return { success: true, token: token as string }
}
