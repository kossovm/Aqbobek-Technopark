'use server'

import { createClient } from '@/utils/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { customAlphabet } from 'nanoid'
import type { CellColor } from '@/lib/cells'
import { CELL_QR_PREFIX, isValidCellCode } from '@/lib/cells'

const generateShortId = customAlphabet('123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6)

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

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function uniqueCellQR(): Promise<string> {
  const admin = getServiceClient()
  for (let i = 0; i < 6; i++) {
    const candidate = `${CELL_QR_PREFIX}${generateShortId()}`
    const { data } = await admin
      .from('cells')
      .select('id')
      .eq('qr_code', candidate)
      .maybeSingle()
    if (!data) return candidate
  }
  throw new Error('Не удалось сгенерировать уникальный QR-код ячейки')
}

// ─── Получение ──────────────────────────────────────────────────────────────

export async function getCellsByLocation(locationId: string) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cells')
    .select('id, location_id, code, color, qr_code, label_printed, created_at')
    .eq('location_id', locationId)
    .order('code')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getAllCells() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cells')
    .select('id, location_id, code, color, qr_code, label_printed, locations:location_id(name)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Получить детали ячейки по QR — нужно при возврате (показать пользователю «куда нести»). */
export async function getCellByQR(qr: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('cells')
    .select('id, location_id, code, color, qr_code, locations:location_id(id, name, image_url)')
    .eq('qr_code', qr)
    .maybeSingle()
  return data ?? null
}

/** Все доступные синие ячейки (не привязанные ни к одному проекту, кроме указанного). */
export async function getAvailableBlueCells(includeCellId?: string | null) {
  const admin = getServiceClient()
  const { data: blueCells } = await admin
    .from('cells')
    .select('id, code, location_id, qr_code, locations:location_id(name)')
    .eq('color', 'blue')
    .order('code')

  const { data: projects } = await admin
    .from('projects')
    .select('cell_id')
    .not('cell_id', 'is', null)

  const taken = new Set((projects ?? []).map((p) => p.cell_id).filter(Boolean) as string[])
  if (includeCellId) taken.delete(includeCellId)

  return (blueCells ?? []).filter((c) => !taken.has(c.id))
}

// ─── Управление ─────────────────────────────────────────────────────────────

export type NewCellInput = {
  location_id: string
  code: string
  color: CellColor
}

export async function bulkAddCells(items: NewCellInput[]) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()
  const created: any[] = []
  const errors: { code: string; error: string }[] = []

  for (const it of items) {
    const code = (it.code || '').trim().toUpperCase()
    if (!isValidCellCode(code)) {
      errors.push({ code, error: 'Формат: буква + 2 цифры (И02)' })
      continue
    }
    if (!['green', 'blue', 'purple'].includes(it.color)) {
      errors.push({ code, error: 'Некорректный цвет' })
      continue
    }
    try {
      const qr = await uniqueCellQR()
      const { data, error } = await admin
        .from('cells')
        .insert({ location_id: it.location_id, code, color: it.color, qr_code: qr })
        .select()
        .single()
      if (error) {
        errors.push({ code, error: error.message })
      } else {
        created.push(data)
      }
    } catch (e: any) {
      errors.push({ code, error: e.message })
    }
  }

  revalidatePath('/admin')
  return { created, errors }
}

export async function updateCell(id: string, patch: Partial<{
  code: string
  color: CellColor
  label_printed: boolean
  position_row: number | null
  position_col: number | null
}>) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()
  if (patch.code !== undefined) {
    patch.code = patch.code.trim().toUpperCase()
    if (!isValidCellCode(patch.code)) return { error: 'Формат кода: буква + 2 цифры' }
  }
  const { error } = await admin.from('cells').update(patch).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

/**
 * Атомарная пересадка ячейки на новую позицию в сетке.
 * Если в целевой позиции уже сидит другая ячейка — меняемся местами.
 * `row`/`col` могут быть null — тогда ячейка снимается из сетки.
 */
export async function placeCell(
  cellId: string,
  row: number | null,
  col: number | null,
) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()

  const { data: src } = await admin
    .from('cells')
    .select('id, location_id, position_row, position_col')
    .eq('id', cellId)
    .maybeSingle()
  if (!src) return { error: 'Ячейка не найдена' }

  if (row !== null && col !== null) {
    const { data: occupant } = await admin
      .from('cells')
      .select('id')
      .eq('location_id', src.location_id)
      .eq('position_row', row)
      .eq('position_col', col)
      .maybeSingle()

    if (occupant && occupant.id !== cellId) {
      // Сначала временно убираем оккупанта, чтобы не упереться в unique-индекс
      await admin
        .from('cells')
        .update({ position_row: null, position_col: null })
        .eq('id', occupant.id)
      await admin
        .from('cells')
        .update({ position_row: row, position_col: col })
        .eq('id', cellId)
      // Перемещаем оккупанта на старую позицию источника (даже если null)
      await admin
        .from('cells')
        .update({
          position_row: src.position_row ?? null,
          position_col: src.position_col ?? null,
        })
        .eq('id', occupant.id)
    } else {
      const { error } = await admin
        .from('cells')
        .update({ position_row: row, position_col: col })
        .eq('id', cellId)
      if (error) return { error: error.message }
    }
  } else {
    const { error } = await admin
      .from('cells')
      .update({ position_row: null, position_col: null })
      .eq('id', cellId)
    if (error) return { error: error.message }
  }

  revalidatePath('/admin')
  return { success: true }
}

export async function deleteCell(id: string) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()

  // Если ячейка home_cell у инвентаря — отказ
  const { count: invCount } = await admin
    .from('inventory')
    .select('id', { count: 'exact', head: true })
    .eq('home_cell_id', id)
  if ((invCount ?? 0) > 0) {
    return { error: `Ячейка — дом для ${invCount} единиц инвентаря.` }
  }
  const { count: projCount } = await admin
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('cell_id', id)
  if ((projCount ?? 0) > 0) {
    return { error: `Ячейка занята проектом.` }
  }

  const { error } = await admin.from('cells').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

export async function markCellLabelsPrinted(ids: string[]) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  if (ids.length === 0) return { success: true }
  const admin = getServiceClient()
  const { error } = await admin.from('cells').update({ label_printed: true }).in('id', ids)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

// ─── Локации с картинкой ─────────────────────────────────────────────────────

export async function updateLocation(id: string, patch: Partial<{
  name: string
  description: string | null
  image_url: string | null
  grid_rows: number | null
  grid_cols: number | null
}>) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()

  if (patch.grid_rows !== undefined && patch.grid_rows !== null) {
    if (patch.grid_rows < 1 || patch.grid_rows > 30) {
      return { error: 'Строк должно быть от 1 до 30' }
    }
  }
  if (patch.grid_cols !== undefined && patch.grid_cols !== null) {
    if (patch.grid_cols < 1 || patch.grid_cols > 30) {
      return { error: 'Столбцов должно быть от 1 до 30' }
    }
  }

  // Если уменьшается размер сетки — снимаем позиции у тех ячеек, что вылезают за неё
  if (
    (patch.grid_rows !== undefined || patch.grid_cols !== undefined)
  ) {
    const { data: existing } = await admin
      .from('locations')
      .select('grid_rows, grid_cols')
      .eq('id', id)
      .maybeSingle()
    const newRows = patch.grid_rows ?? existing?.grid_rows
    const newCols = patch.grid_cols ?? existing?.grid_cols
    if (newRows !== null && newCols !== null && newRows !== undefined && newCols !== undefined) {
      await admin
        .from('cells')
        .update({ position_row: null, position_col: null })
        .eq('location_id', id)
        .or(`position_row.gte.${newRows},position_col.gte.${newCols}`)
    } else if (patch.grid_rows === null || patch.grid_cols === null) {
      // Сетка отключена — убираем все позиции
      await admin
        .from('cells')
        .update({ position_row: null, position_col: null })
        .eq('location_id', id)
    }
  }

  const { error } = await admin.from('locations').update(patch).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

export async function deleteLocation(id: string) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()

  const { count: cellsCount } = await admin
    .from('cells')
    .select('id', { count: 'exact', head: true })
    .eq('location_id', id)
  if ((cellsCount ?? 0) > 0) {
    return { error: `В локации ${cellsCount} ячеек — сначала удалите их.` }
  }

  const { error } = await admin.from('locations').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

export async function getLocationsWithCells() {
  const supabase = createClient()
  const { data: locs, error } = await supabase
    .from('locations')
    .select('id, name, description, image_url, grid_rows, grid_cols, created_at')
    .order('name')
  if (error) throw new Error(error.message)

  const { data: allCells } = await supabase
    .from('cells')
    .select('id, location_id, code, color, qr_code, label_printed, position_row, position_col')
    .order('code')

  const cellsByLoc: Record<string, any[]> = {}
  for (const c of allCells ?? []) {
    if (!cellsByLoc[c.location_id]) cellsByLoc[c.location_id] = []
    cellsByLoc[c.location_id].push(c)
  }

  return (locs ?? []).map((l) => ({ ...l, cells: cellsByLoc[l.id] ?? [] }))
}
