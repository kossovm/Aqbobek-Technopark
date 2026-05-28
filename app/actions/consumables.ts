'use server'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'
import { logEvent } from './logs'

const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function getUser() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

function isStaffRole(role?: string | null) {
  return role === 'admin' || role === 'teacher'
}

/**
 * Поиск расходника по QR/штрихкоду — для UsageForm-сканера.
 * Возвращает либо id найденной позиции, либо ошибку.
 * Не пишет ничего в логи — это просто lookup.
 */
export async function findConsumableByQR(qr: string) {
  const code = qr.trim()
  if (!code) return { error: 'Пустой код' as const }

  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select('id, name, is_consumable, status, quantity_available, unit')
    .eq('qr_code', code)
    .maybeSingle()

  if (error) return { error: 'Ошибка БД: ' + error.message }
  if (!data) return { error: 'Не найдено в инвентаре' }
  if (!data.is_consumable) {
    return { error: `«${data.name}» — это не расходник` }
  }
  if (data.status === 'maintenance' || data.status === 'lost') {
    return { error: `«${data.name}» недоступен` }
  }
  if (Number(data.quantity_available ?? 0) <= 0) {
    return { error: `«${data.name}»: остаток равен нулю` }
  }
  return {
    inventory: {
      id: data.id,
      name: data.name,
      unit: data.unit,
      quantity_available: Number(data.quantity_available ?? 0),
    },
  }
}

/**
 * Возвращает все «расходные» позиции инвентаря с положительным остатком.
 * Включает цвет домашней ячейки — он нужен фронту, чтобы решить,
 * нужен ли учитель-разрешивший.
 */
export async function getConsumables() {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select(`
      id, name, description, unit, quantity, quantity_available,
      is_consumable, status, home_cell_id,
      home_cell:home_cell_id(id, color, code, locations:location_id(name)),
      categories:category_id(name)
    `)
    .eq('is_consumable', true)
    .order('name')

  if (error) throw new Error('Ошибка при загрузке расходников: ' + error.message)
  return (data ?? []).filter((d: any) => d.status !== 'lost' && d.status !== 'maintenance')
}

export async function logUsage(data: {
  inventoryId: string
  amount: number
  proofUrl: string
  projectId?: string
  description?: string | null
  teacherApproverId?: string | null
}) {
  const user = await getUser()
  if (!user) throw new Error('Необходима авторизация')

  // Профиль и проверка цвета ячейки
  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('id, role, is_approved')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_approved) throw new Error('Аккаунт не подтверждён')
  const isStaff = isStaffRole(profile.role)

  const { data: inv } = await supabaseAdmin
    .from('inventory')
    .select(`
      id, name, quantity, quantity_available, is_consumable, status, home_cell_id,
      home_cell:home_cell_id(color)
    `)
    .eq('id', data.inventoryId)
    .maybeSingle()
  if (!inv) throw new Error('Расходник не найден')
  if (!inv.is_consumable) throw new Error('Этот предмет не помечен как расходник')
  if (inv.status === 'maintenance' || inv.status === 'lost') {
    throw new Error('Расходник недоступен')
  }

  const amount = Number(data.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Количество должно быть больше нуля')
  }
  const avail = Number(inv.quantity_available ?? 0)
  if (amount > avail) throw new Error(`Доступно только ${avail}`)

  // Проверка цвета ячейки — нужен ли учитель
  const color: 'green' | 'blue' | 'purple' | null = (inv as any).home_cell?.color ?? null

  let approverId: string | null = null
  if (isStaff) {
    // Учитель/админ — пишем себя в approver
    approverId = user.id
  } else if (color && color !== 'green') {
    // Ученик + blue/purple — обязателен approver
    if (!data.teacherApproverId) {
      throw new Error(
        color === 'purple'
          ? 'Фиолетовая ячейка — нужен учитель-разрешивший'
          : 'Синяя ячейка — нужен учитель-разрешивший'
      )
    }
    const { data: appr } = await supabaseAdmin
      .from('users')
      .select('id, role, is_approved')
      .eq('id', data.teacherApproverId)
      .maybeSingle()
    if (!appr || !appr.is_approved || !isStaffRole(appr.role)) {
      throw new Error('Указанный учитель не подходит')
    }
    approverId = data.teacherApproverId
  } else if (data.teacherApproverId) {
    // Зелёная ячейка — учитель необязателен, но если указан, проверяем
    const { data: appr } = await supabaseAdmin
      .from('users')
      .select('id, role, is_approved')
      .eq('id', data.teacherApproverId)
      .maybeSingle()
    if (appr && appr.is_approved && isStaffRole(appr.role)) {
      approverId = data.teacherApproverId
    }
  }

  // Записываем факт списания
  const { error: usageErr } = await supabaseAdmin
    .from('consumable_usage')
    .insert({
      user_id: user.id,
      inventory_id: data.inventoryId,
      project_id: data.projectId && data.projectId !== 'none' ? data.projectId : null,
      amount,
      proof_image_url: data.proofUrl,
      description: data.description?.trim() || null,
      teacher_approver_id: approverId,
    })
  if (usageErr) throw new Error('Ошибка записи лога: ' + usageErr.message)

  // Уменьшаем остаток через RPC
  const { error: rpcErr } = await supabaseAdmin.rpc('adjust_inventory_quantity', {
    p_inventory_id: data.inventoryId,
    p_delta: -amount,
  })
  if (rpcErr) throw new Error('Ошибка списания остатков: ' + rpcErr.message)

  await logEvent({
    user_id: user.id,
    action: 'consumable_use',
    entity_type: 'inventory',
    entity_id: data.inventoryId,
    details: {
      name: inv.name,
      amount,
      project_id: data.projectId ?? null,
      teacher_approver_id: approverId,
      description: data.description ?? null,
    },
  })

  return { success: true }
}
