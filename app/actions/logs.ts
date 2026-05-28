'use server'

import { createClient } from '@/utils/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

async function requireStaff() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Необходима авторизация')

  const { data: profile } = await supabase
    .from('users')
    .select('role, is_approved')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.is_approved) throw new Error('Аккаунт не подтверждён')
  if (profile.role !== 'admin' && profile.role !== 'teacher') {
    throw new Error('Недостаточно прав')
  }
}

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/** Записать событие в журнал (вызывается из других серверных экшенов). */
export async function logEvent(input: {
  user_id?: string | null
  action: string
  entity_type?: string | null
  entity_id?: string | null
  details?: Record<string, unknown> | null
}) {
  try {
    const admin = getServiceClient()
    await admin.from('activity_logs').insert({
      user_id: input.user_id ?? null,
      action: input.action,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      details: input.details ?? null,
    })
  } catch (e) {
    // Логирование не должно ломать основной поток
    console.error('logEvent failed', e)
  }
}

/** Получить логи (только staff). */
export async function getLogs(opts: {
  limit?: number
  action?: string | null
  entityType?: string | null
  userId?: string | null
} = {}) {
  await requireStaff()
  const supabase = createClient()

  let q = supabase
    .from('activity_logs')
    .select('id, user_id, action, entity_type, entity_id, details, created_at')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 200)

  if (opts.action) q = q.eq('action', opts.action)
  if (opts.entityType) q = q.eq('entity_type', opts.entityType)
  if (opts.userId) q = q.eq('user_id', opts.userId)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  // Подтягиваем full_name для отображения
  const userIds = Array.from(new Set((data ?? []).map((r) => r.user_id).filter(Boolean))) as string[]
  let namesMap: Record<string, { full_name: string; username: string }> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('users')
      .select('id, full_name, username')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      namesMap[p.id] = { full_name: p.full_name ?? '', username: p.username ?? '' }
    }
  }

  return (data ?? []).map((r) => ({
    ...r,
    user_name: r.user_id ? (namesMap[r.user_id]?.full_name || namesMap[r.user_id]?.username || '—') : 'Система',
  }))
}
