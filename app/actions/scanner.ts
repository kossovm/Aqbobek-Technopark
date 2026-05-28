'use server'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/utils/supabase/server'
import { logEvent } from './logs'
import { CELL_QR_PREFIX } from '@/lib/cells'

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

async function getProfile(userId: string) {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, full_name, username, role, is_approved')
    .eq('id', userId)
    .maybeSingle()
  return data
}

function isStaffRole(role?: string | null) {
  return role === 'admin' || role === 'teacher'
}

async function recalcStatus(inventoryId: string) {
  const { data: inv } = await supabaseAdmin
    .from('inventory')
    .select('quantity, quantity_available, status')
    .eq('id', inventoryId)
    .maybeSingle()
  if (!inv) return

  if (inv.status === 'maintenance' || inv.status === 'lost') return

  const total = Number(inv.quantity ?? 1)
  const avail = Number(inv.quantity_available ?? 0)

  let next: 'available' | 'in_use' | 'partial'
  if (avail >= total) next = 'available'
  else if (avail <= 0) next = 'in_use'
  else next = 'partial'

  if (inv.status !== next) {
    await supabaseAdmin
      .from('inventory')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', inventoryId)
  }
}

// ─── Скан ────────────────────────────────────────────────────────────────────

/**
 * Распознаёт QR ячейки или инвентаря.
 *  - Ячейка    → returns { kind: 'cell', cell }
 *  - Инвентарь → returns { kind: 'item', inventory: ScanInv }
 *  - Иначе     → { kind: 'error', message }
 *
 * Заодно подтягивает цвет домашней ячейки и (если она синяя) проект,
 * к которому она привязана. Это нужно для решения о checkout.
 */
export async function processQRCode(qrCode: string) {
  const user = await getUser()
  if (!user) return { kind: 'error', message: 'Необходима авторизация' } as const

  const code = qrCode.trim()

  // ─── Ячейка ──────────────────────────────────────────────────────────────
  if (code.toUpperCase().startsWith(CELL_QR_PREFIX)) {
    const { data: cell } = await supabaseAdmin
      .from('cells')
      .select('id, code, color, qr_code, locations:location_id(id, name, image_url)')
      .eq('qr_code', code)
      .maybeSingle()

    if (!cell) {
      await logEvent({ user_id: user.id, action: 'scan_unknown', details: { qr: code } })
      return { kind: 'error', message: 'Ячейка не найдена' } as const
    }

    await logEvent({
      user_id: user.id,
      action: 'scan',
      entity_type: 'cell',
      entity_id: cell.id,
      details: { qr: code, code: cell.code, color: cell.color },
    })

    return { kind: 'cell', cell } as const
  }

  // ─── Инвентарь ───────────────────────────────────────────────────────────
  const { data: inv, error } = await supabaseAdmin
    .from('inventory')
    .select(`
      *,
      home_cell:home_cell_id(
        id, code, color, qr_code,
        locations:location_id(id, name, image_url)
      ),
      categories:category_id(name, is_consumable, default_unit)
    `)
    .eq('qr_code', code)
    .maybeSingle()

  if (error) return { kind: 'error', message: 'Ошибка БД: ' + error.message } as const
  if (!inv) {
    await logEvent({ user_id: user.id, action: 'scan_unknown', details: { qr: code } })
    return { kind: 'error', message: 'Оборудование не найдено' } as const
  }

  await logEvent({
    user_id: user.id,
    action: 'scan',
    entity_type: 'inventory',
    entity_id: inv.id,
    details: { qr: code, name: inv.name },
  })

  if (inv.status === 'maintenance' || inv.status === 'lost') {
    return { kind: 'error', message: 'Инвентарь недоступен (на обслуживании/утеряно)' } as const
  }

  // Расходники нельзя «брать» через сканер — только списание на /consumables
  if (inv.is_consumable) {
    return {
      kind: 'error',
      message: 'Это расходник — списание на странице «Списание материалов»',
    } as const
  }

  // Подтягиваем проект, к которому привязана home_cell (если есть)
  let parkedProject: { id: string; name: string } | null = null
  const homeCellId = (inv as any).home_cell?.id
  if (homeCellId) {
    const { data: pp } = await supabaseAdmin
      .from('projects')
      .select('id, name')
      .eq('cell_id', homeCellId)
      .maybeSingle()
    if (pp) parkedProject = pp
  }

  const total = Number(inv.quantity ?? 1)
  const avail = Number(inv.quantity_available ?? 0)

  // Сколько уже на руках у пользователя
  const { data: openTxs } = await supabaseAdmin
    .from('transactions')
    .select('id, quantity')
    .eq('inventory_id', inv.id)
    .eq('user_id', user.id)
    .is('returned_at', null)

  const myQty = (openTxs ?? []).reduce((s, t) => s + Number(t.quantity ?? 1), 0)
  const cellColor: 'green' | 'blue' | 'purple' | null = (inv as any).home_cell?.color ?? null

  return {
    kind: 'item',
    inventory: {
      id: inv.id,
      name: inv.name,
      description: inv.description,
      qr_code: inv.qr_code,
      unit: inv.unit,
      is_consumable: inv.is_consumable,
      quantity_total: total,
      quantity_available: avail,
      my_quantity: myQty,
      home_cell: (inv as any).home_cell ?? null,
      cell_color: cellColor,
      parked_project: parkedProject, // если синяя ячейка привязана к проекту
    },
  } as const
}

// ─── Проверка прав на checkout ───────────────────────────────────────────────
/**
 * Возвращает null, если можно. Иначе строку с описанием барьера или
 * структуру с требованием teacher_approver_id.
 */
export async function checkAccessRules(inventoryId: string): Promise<
  | { ok: true }
  | { ok: false; needs_teacher_approver: true; reason: string }
  | { ok: false; needs_teacher_approver: false; reason: string }
> {
  const user = await getUser()
  if (!user) return { ok: false, needs_teacher_approver: false, reason: 'Не авторизован' }
  const profile = await getProfile(user.id)
  if (!profile) return { ok: false, needs_teacher_approver: false, reason: 'Профиль не найден' }

  const { data: inv } = await supabaseAdmin
    .from('inventory')
    .select('id, home_cell_id, home_cell:home_cell_id(color)')
    .eq('id', inventoryId)
    .maybeSingle()
  if (!inv) return { ok: false, needs_teacher_approver: false, reason: 'Инвентарь не найден' }

  const color: 'green' | 'blue' | 'purple' | null = (inv as any).home_cell?.color ?? null
  const role = profile.role
  const isStaff = isStaffRole(role)

  // Зелёная — всем
  if (!color || color === 'green') return { ok: true }

  // Учителям/админам всё доступно
  if (isStaff) return { ok: true }

  if (color === 'blue') {
    // Если ячейка привязана к проекту → нужно быть его участником
    if (inv.home_cell_id) {
      const { data: parked } = await supabaseAdmin
        .from('projects')
        .select('id')
        .eq('cell_id', inv.home_cell_id)
        .maybeSingle()
      if (parked) {
        const { data: member } = await supabaseAdmin
          .from('project_members')
          .select('user_id')
          .eq('project_id', parked.id)
          .eq('user_id', user.id)
          .maybeSingle()
        if (member) return { ok: true }
        return {
          ok: false,
          needs_teacher_approver: true,
          reason: 'Эта ячейка закреплена за чужим проектом — нужен учитель',
        }
      }
    }
    // Свободная синяя — для ученика требует учителя
    return { ok: false, needs_teacher_approver: true, reason: 'Синяя ячейка — нужно разрешение учителя' }
  }

  // Фиолетовая — ученику нужен учитель
  return { ok: false, needs_teacher_approver: true, reason: 'Фиолетовая ячейка — нужно разрешение учителя' }
}

/**
 * Список одобренных учителей и админов — для выбора разрешившего.
 * Идём через service client, потому что RLS на public.users пускает
 * чтение чужих профилей только staff-у; ученикам этот список тоже нужен.
 */
export async function getApprovers() {
  const user = await getUser()
  if (!user) return []
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, full_name, username, role')
    .in('role', ['admin', 'teacher'])
    .eq('is_approved', true)
    .order('role', { ascending: false }) // teacher → admin для предсказуемой сортировки
    .order('full_name', { ascending: true })
  return data ?? []
}

// ─── Checkout ────────────────────────────────────────────────────────────────

export async function checkoutItem(
  inventoryId: string,
  projectId: string | undefined,
  quantity: number,
  teacherApproverId?: string | null
) {
  const user = await getUser()
  if (!user) throw new Error('Необходима авторизация')

  const qty = Math.max(1, Math.floor(Number(quantity) || 0))
  if (qty <= 0) throw new Error('Количество должно быть >= 1')

  const access = await checkAccessRules(inventoryId)
  let approverId: string | null = null
  if (!access.ok) {
    if (access.needs_teacher_approver) {
      if (!teacherApproverId) throw new Error(access.reason)
      // Проверяем, что approver — staff
      const { data: appr } = await supabaseAdmin
        .from('users')
        .select('id, role, is_approved')
        .eq('id', teacherApproverId)
        .maybeSingle()
      if (!appr || !appr.is_approved || !isStaffRole(appr.role)) {
        throw new Error('Указанный учитель не подходит')
      }
      approverId = teacherApproverId
    } else {
      throw new Error(access.reason)
    }
  } else {
    // Если сам учитель/админ — пишем себя как approver (опционально, для аудита)
    const profile = await getProfile(user.id)
    if (isStaffRole(profile?.role)) approverId = user.id
  }

  const { data: inv } = await supabaseAdmin
    .from('inventory')
    .select('id, name, quantity, quantity_available, status, unit, is_consumable')
    .eq('id', inventoryId)
    .maybeSingle()
  if (!inv) throw new Error('Инвентарь не найден')
  if (inv.status === 'maintenance' || inv.status === 'lost') throw new Error('Инвентарь недоступен')
  if (inv.is_consumable) {
    throw new Error('Расходники списываются только через страницу «Списание материалов»')
  }

  const avail = Number(inv.quantity_available ?? 0)
  if (qty > avail) throw new Error(`Доступно только ${avail}`)

  const { error: rpcErr } = await supabaseAdmin.rpc('adjust_inventory_quantity', {
    p_inventory_id: inventoryId,
    p_delta: -qty,
  })
  if (rpcErr) throw new Error('Ошибка списания: ' + rpcErr.message)

  await recalcStatus(inventoryId)

  const { data: tx, error: txError } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id: user.id,
      inventory_id: inventoryId,
      quantity: qty,
      project_id: projectId && projectId !== 'none' ? projectId : null,
      teacher_approver_id: approverId,
    })
    .select('id')
    .single()
  if (txError) throw new Error('Ошибка создания транзакции: ' + txError.message)

  if (projectId && projectId !== 'none') {
    await supabaseAdmin
      .from('project_inventory')
      .upsert({ project_id: projectId, inventory_id: inventoryId })
  }

  await logEvent({
    user_id: user.id,
    action: 'checkout',
    entity_type: 'inventory',
    entity_id: inventoryId,
    details: {
      name: inv.name,
      quantity: qty,
      project_id: projectId ?? null,
      teacher_approver_id: approverId,
    },
  })

  // Если выбран проект — подсказать «храни на полке проекта»
  let storageHint: { code: string; location_name: string } | null = null
  if (projectId && projectId !== 'none') {
    const { data: proj } = await supabaseAdmin
      .from('projects')
      .select('cell:cell_id(code, locations:location_id(name))')
      .eq('id', projectId)
      .maybeSingle()
    const c = (proj as any)?.cell
    if (c?.code) {
      storageHint = { code: c.code, location_name: c.locations?.name ?? '' }
    }
  }

  return { success: true, transactionId: tx.id, storageHint }
}

export async function bulkCheckout(
  items: Array<{ inventoryId: string; quantity: number; teacherApproverId?: string | null }>,
  projectId?: string
): Promise<{
  results: Array<{ inventoryId: string; ok: boolean; error?: string }>
  okCount: number
  errorCount: number
}> {
  const results: Array<{ inventoryId: string; ok: boolean; error?: string }> = []
  let okCount = 0
  let errorCount = 0
  for (const it of items) {
    try {
      await checkoutItem(it.inventoryId, projectId, it.quantity, it.teacherApproverId)
      results.push({ inventoryId: it.inventoryId, ok: true })
      okCount++
    } catch (e: any) {
      results.push({ inventoryId: it.inventoryId, ok: false, error: e?.message || 'Ошибка' })
      errorCount++
    }
  }
  return { results, okCount, errorCount }
}

// ─── Возврат: 2-этапный, проверка ячейки ─────────────────────────────────────

/**
 * Список id проектов, в которых пользователь является участником.
 */
async function getUserProjectIds(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('project_members')
    .select('project_id')
    .eq('user_id', userId)
  return (data ?? []).map((r: any) => r.project_id)
}

/**
 * Все открытые транзакции, к которым у пользователя есть доступ:
 *   1) выданные ему лично,
 *   2) выданные другим людям в рамках его проектов.
 */
async function getReturnableTransactions(inventoryId: string, userId: string) {
  const projectIds = await getUserProjectIds(userId)

  const { data: ownTxs } = await supabaseAdmin
    .from('transactions')
    .select('id, quantity, user_id, project_id, issued_at, users:user_id(full_name, username), projects:project_id(name)')
    .eq('inventory_id', inventoryId)
    .eq('user_id', userId)
    .is('returned_at', null)

  let teamTxs: any[] = []
  if (projectIds.length > 0) {
    const { data: t } = await supabaseAdmin
      .from('transactions')
      .select('id, quantity, user_id, project_id, issued_at, users:user_id(full_name, username), projects:project_id(name)')
      .eq('inventory_id', inventoryId)
      .neq('user_id', userId)
      .in('project_id', projectIds)
      .is('returned_at', null)
    teamTxs = t ?? []
  }

  const all = [...(ownTxs ?? []), ...teamTxs]
  // FIFO порядок
  all.sort((a, b) => new Date(a.issued_at).getTime() - new Date(b.issued_at).getTime())
  return all
}

/** Шаг 1: пользователь сканирует предмет, мы возвращаем «куда нести». */
export async function startReturn(inventoryQR: string) {
  const user = await getUser()
  if (!user) return { error: 'Необходима авторизация' }

  const { data: inv } = await supabaseAdmin
    .from('inventory')
    .select(`
      id, name, qr_code, unit, is_consumable,
      home_cell:home_cell_id(id, code, color, qr_code, locations:location_id(id, name, image_url))
    `)
    .eq('qr_code', inventoryQR)
    .maybeSingle()
  if (!inv) return { error: 'Инвентарь не найден' }
  if (inv.is_consumable) return { error: 'Расходники не возвращаются — это списание' }
  if (!(inv as any).home_cell) return { error: 'У этого предмета не задана домашняя ячейка' }

  const txs = await getReturnableTransactions(inv.id, user.id)
  if (txs.length === 0) {
    return { error: 'На этот предмет нет открытой выдачи (ни у вас, ни в ваших проектах)' }
  }

  const totalQty = txs.reduce((s, t) => s + Number(t.quantity ?? 1), 0)

  // Если все открытые транзакции — не наши, отметим, что мы возвращаем «за команду»
  const ownQty = txs.filter((t) => t.user_id === user.id)
                    .reduce((s, t) => s + Number(t.quantity ?? 1), 0)
  const teamHolders = Array.from(new Set(
    txs.filter((t) => t.user_id !== user.id)
       .map((t) => t.users?.full_name || t.users?.username || '—')
  ))

  return {
    inventory: {
      id: inv.id,
      name: inv.name,
      qr_code: inv.qr_code,
      unit: inv.unit,
      my_quantity: totalQty,
      own_quantity: ownQty,
      team_holders: teamHolders, // подписи «у Иванова И.И.»
      home_cell: (inv as any).home_cell,
    },
  }
}

/**
 * Шаг 2: подтверждение возврата с проверкой QR ячейки.
 * Если QR ячейки не совпадает с home_cell.qr_code — отказ.
 */
export async function confirmReturn(
  inventoryId: string,
  cellQR: string,
  quantity: number
) {
  const user = await getUser()
  if (!user) throw new Error('Необходима авторизация')

  const qty = Math.max(1, Math.floor(Number(quantity) || 0))

  const { data: inv } = await supabaseAdmin
    .from('inventory')
    .select('id, name, home_cell_id, home_cell:home_cell_id(qr_code, code)')
    .eq('id', inventoryId)
    .maybeSingle()
  if (!inv) throw new Error('Инвентарь не найден')

  const expected = (inv as any).home_cell?.qr_code as string | undefined
  if (!expected) throw new Error('У предмета не задана домашняя ячейка')
  if (cellQR.trim() !== expected) {
    await logEvent({
      user_id: user.id,
      action: 'return_wrong_cell',
      entity_type: 'inventory',
      entity_id: inventoryId,
      details: { scanned: cellQR, expected_code: (inv as any).home_cell?.code },
    })
    return { ok: false, expected_code: (inv as any).home_cell?.code }
  }

  // Транзакции, доступные для возврата: свои + командные (FIFO)
  const openTxs = await getReturnableTransactions(inventoryId, user.id)
  if (openTxs.length === 0) throw new Error('Активная выдача не найдена')

  const myTotal = openTxs.reduce((s, t) => s + Number(t.quantity ?? 1), 0)
  if (qty > myTotal) throw new Error(`Доступно к возврату: ${myTotal}`)

  let remaining = qty
  for (const tx of openTxs) {
    if (remaining <= 0) break
    const take = Math.min(Number(tx.quantity ?? 1), remaining)
    if (take === Number(tx.quantity ?? 1)) {
      // Закрываем целиком: фиксируем кто фактически вернул
      await supabaseAdmin
        .from('transactions')
        .update({
          returned_at: new Date().toISOString(),
          returned_by_user_id: user.id,
        })
        .eq('id', tx.id)
    } else {
      // Уменьшаем оставшееся на руках, отдельной строкой пишем «возврат части»
      await supabaseAdmin
        .from('transactions')
        .update({ quantity: Number(tx.quantity ?? 1) - take })
        .eq('id', tx.id)
      await supabaseAdmin
        .from('transactions')
        .insert({
          user_id: tx.user_id, // оригинальный держатель
          returned_by_user_id: user.id,
          inventory_id: inventoryId,
          quantity: take,
          project_id: tx.project_id ?? null,
          returned_at: new Date().toISOString(),
        })
    }
    remaining -= take
  }

  await supabaseAdmin.rpc('adjust_inventory_quantity', {
    p_inventory_id: inventoryId,
    p_delta: qty,
  })
  await recalcStatus(inventoryId)

  // Если по этому предмету не осталось ни одной открытой транзакции —
  // удаляем привязку к проекту в project_inventory.
  const { count: stillOpen } = await supabaseAdmin
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('inventory_id', inventoryId)
    .is('returned_at', null)
  if ((stillOpen ?? 0) === 0) {
    await supabaseAdmin
      .from('project_inventory')
      .delete()
      .eq('inventory_id', inventoryId)
  }

  await logEvent({
    user_id: user.id,
    action: 'return',
    entity_type: 'inventory',
    entity_id: inventoryId,
    details: { name: inv.name, quantity: qty, cell: (inv as any).home_cell?.code },
  })

  return { ok: true }
}

// ─── Старый returnItem (back-compat — не используется, но оставлен на всякий) ─
export async function returnItem(inventoryId: string, quantity: number) {
  // Пытаемся найти home_cell и сразу confirmReturn — но без скана это
  // нарушает спецификацию. Поэтому просто бросаем ошибку, чтобы не
  // позволить «слепой» возврат вне сценария сканирования ячейки.
  void inventoryId; void quantity
  throw new Error('Возврат теперь требует сканирования ячейки')
}
