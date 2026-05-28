'use server'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { customAlphabet } from 'nanoid'
import { logEvent } from './logs'

const generateShortId = customAlphabet('123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6)

const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

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
  return { user, role: profile.role as 'admin' | 'teacher' }
}

// ─── Базовое получение ───────────────────────────────────────────────────────

/** Полная карточка инвентаря + ячейка + категория + текущий держатель. */
export async function getInventory() {
  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select(`
      id, name, qr_code, status, description, quantity, quantity_available,
      unit, is_consumable, label_printed, created_at, updated_at, category,
      category_id, home_cell_id,
      home_cell:home_cell_id(id, code, color, qr_code, locations:location_id(id, name)),
      categories:category_id(id, name, is_consumable, default_unit)
    `)
    .order('created_at', { ascending: false })
  if (error) throw new Error('Ошибка при загрузке инвентаря: ' + error.message)
  if (!data) return []

  // Подтягиваем активные транзакции (кто и когда взял), отдельным запросом
  const ids = data.map((r) => r.id)
  let activeTxByItem: Record<string, any[]> = {}
  if (ids.length > 0) {
    const { data: txs } = await supabaseAdmin
      .from('transactions')
      .select('id, inventory_id, user_id, issued_at, quantity, project_id, users:user_id(full_name, username), projects:project_id(name)')
      .in('inventory_id', ids)
      .is('returned_at', null)
    for (const tx of txs ?? []) {
      if (!activeTxByItem[tx.inventory_id]) activeTxByItem[tx.inventory_id] = []
      activeTxByItem[tx.inventory_id].push(tx)
    }
  }

  return data.map((item: any) => ({
    ...item,
    active_transactions: activeTxByItem[item.id] ?? [],
  }))
}

export async function getLocations() {
  const { data, error } = await supabaseAdmin
    .from('locations')
    .select('*')
    .order('name')
  if (error) throw new Error('Ошибка при загрузке локаций')
  return data ?? []
}

export async function createLocation(input: { name: string; description?: string | null }) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const { error } = await supabaseAdmin.from('locations').insert({
    name: input.name.trim(),
    description: input.description?.trim() || null,
  })
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

// ─── Добавление одной единицы ────────────────────────────────────────────────

export type NewInventoryInput = {
  name: string
  description?: string | null
  category_id?: string | null
  home_cell_id?: string | null
  quantity?: number
  unit?: string
  is_consumable?: boolean
}

async function uniqueQR(): Promise<string> {
  // Генерим до тех пор, пока не получим уникальный
  for (let i = 0; i < 5; i++) {
    const candidate = `AQB-${generateShortId()}`
    const { data } = await supabaseAdmin
      .from('inventory')
      .select('id')
      .eq('qr_code', candidate)
      .maybeSingle()
    if (!data) return candidate
  }
  throw new Error('Не удалось сгенерировать уникальный QR-код')
}

export async function addInventoryItem(input: NewInventoryInput) {
  let user
  try {
    const r = await requireStaff()
    user = r.user
  } catch (e: any) {
    throw new Error(e.message)
  }

  const qrCode = await uniqueQR()
  const quantity = Number(input.quantity ?? 1) || 1

  const { data: newItem, error } = await supabaseAdmin
    .from('inventory')
    .insert({
      name: input.name.trim(),
      category: '', // legacy text, фронт не использует
      category_id: input.category_id || null,
      home_cell_id: input.home_cell_id || null,
      description: input.description?.trim() || null,
      qr_code: qrCode,
      status: 'available',
      quantity,
      quantity_available: quantity,
      unit: input.unit || 'piece',
      is_consumable: !!input.is_consumable,
      label_printed: false,
    })
    .select()
    .single()

  if (error) throw new Error('Ошибка при добавлении инвентаря: ' + error.message)

  await logEvent({
    user_id: user.id,
    action: 'inventory_create',
    entity_type: 'inventory',
    entity_id: newItem.id,
    details: { name: newItem.name, qr_code: newItem.qr_code },
  })

  return newItem
}

// ─── Массовое добавление ─────────────────────────────────────────────────────

export async function bulkAddInventory(items: NewInventoryInput[]) {
  let user
  try {
    const r = await requireStaff()
    user = r.user
  } catch (e: any) {
    return { error: e.message }
  }

  const created: any[] = []
  for (const it of items) {
    if (!it.name?.trim()) continue
    try {
      const newItem = await addInventoryItem(it)
      created.push(newItem)
    } catch (e: any) {
      created.push({ error: e.message, name: it.name })
    }
  }

  return { created }
}

// ─── Обновление ──────────────────────────────────────────────────────────────

export async function updateInventoryItem(id: string, patch: Partial<{
  name: string
  description: string | null
  category_id: string | null
  home_cell_id: string | null
  quantity: number
  unit: string
  is_consumable: boolean
  label_printed: boolean
}>) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }

  // Если меняется quantity — пересчитаем quantity_available
  let extra: any = {}
  if (patch.quantity !== undefined) {
    const { data: cur } = await supabaseAdmin
      .from('inventory')
      .select('quantity, quantity_available')
      .eq('id', id)
      .maybeSingle()
    if (cur) {
      const inUse = (cur.quantity ?? 1) - (cur.quantity_available ?? 0)
      extra.quantity_available = Math.max(0, patch.quantity - inUse)
    }
  }

  const { error } = await supabaseAdmin
    .from('inventory')
    .update({ ...patch, ...extra, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

export async function markLabelsPrinted(ids: string[]) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  if (ids.length === 0) return { success: true }
  const { error } = await supabaseAdmin
    .from('inventory')
    .update({ label_printed: true })
    .in('id', ids)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

// ─── Удаление ────────────────────────────────────────────────────────────────

export async function deleteInventoryItem(id: string) {
  let user
  try {
    const r = await requireStaff()
    user = r.user
  } catch (e: any) {
    return { error: e.message }
  }

  const { data: item } = await supabaseAdmin
    .from('inventory')
    .select('name, qr_code')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabaseAdmin.from('inventory').delete().eq('id', id)
  if (error) return { error: error.message }

  await logEvent({
    user_id: user.id,
    action: 'inventory_delete',
    entity_type: 'inventory',
    entity_id: id,
    details: { name: item?.name, qr_code: item?.qr_code },
  })

  revalidatePath('/admin')
  return { success: true }
}

export async function bulkDeleteInventory(ids: string[]) {
  if (ids.length === 0) return { success: true }
  const results = await Promise.all(ids.map((id) => deleteInventoryItem(id)))
  const errors = results.filter((r) => r.error).map((r) => r.error)
  if (errors.length > 0) return { error: errors.join('; ') }
  return { success: true }
}
