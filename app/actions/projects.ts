'use server'

import { createClient } from '@/utils/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

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

// ─── Получение ──────────────────────────────────────────────────────────────

/** Все проекты с количеством участников. */
export async function getProjects() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('projects')
    .select(`
      id, name, description, status, cell_id, created_at,
      cells:cell_id(id, code, color, locations:location_id(name))
    `)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Проекты текущего пользователя (список его проектов). */
export async function getMyProjects() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const admin = getServiceClient()
  const { data: rows } = await admin
    .from('project_members')
    .select(`
      project_id,
      projects:project_id(
        id, name, description, status, cell_id,
        cells:cell_id(id, code, color, locations:location_id(name))
      )
    `)
    .eq('user_id', user.id)

  return (rows ?? [])
    .map((r: any) => r.projects)
    .filter(Boolean)
}

/** Подробности проекта, доступные участнику (без admin-проверок). */
export async function getMyProjectDetails(projectId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Необходима авторизация' }

  const admin = getServiceClient()

  // Проверяем членство либо staff
  const { data: profile } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  const isStaff = profile?.role === 'admin' || profile?.role === 'teacher'

  if (!isStaff) {
    const { data: mem } = await admin
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!mem) return { error: 'Нет доступа к этому проекту' }
  }

  const { data: project } = await admin
    .from('projects')
    .select(`
      id, name, description, status, cell_id,
      cells:cell_id(id, code, color, locations:location_id(name))
    `)
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return { error: 'Проект не найден' }

  const { data: members } = await admin
    .from('project_members')
    .select('user_id, users:user_id(id, full_name, username, role)')
    .eq('project_id', projectId)

  // Активный инвентарь команды (открытые транзакции по этому проекту)
  const { data: txs } = await admin
    .from('transactions')
    .select(`
      id, quantity, issued_at, user_id,
      users:user_id(full_name, username),
      inventory:inventory_id(
        id, name, qr_code, unit,
        home_cell:home_cell_id(code, color, locations:location_id(name))
      )
    `)
    .eq('project_id', projectId)
    .is('returned_at', null)
    .order('issued_at', { ascending: false })

  return {
    project,
    isStaff,
    members: members ?? [],
    activeTransactions: txs ?? [],
  }
}

/**
 * Участник проекта может менять name, description, status.
 * Учителя и админы — могут всё через `updateProject`.
 */
export async function updateMyProject(id: string, patch: {
  name?: string
  description?: string | null
  status?: 'planning' | 'active' | 'completed' | 'archived'
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Необходима авторизация' }

  const admin = getServiceClient()

  const { data: profile } = await admin
    .from('users')
    .select('role, is_approved')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_approved) return { error: 'Аккаунт не подтверждён' }

  const isStaff = profile.role === 'admin' || profile.role === 'teacher'
  if (!isStaff) {
    const { data: mem } = await admin
      .from('project_members')
      .select('user_id')
      .eq('project_id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!mem) return { error: 'Нет доступа к этому проекту' }
  }

  const safe: Record<string, any> = {}
  if (patch.name !== undefined) {
    const n = patch.name.trim()
    if (!n) return { error: 'Название не может быть пустым' }
    safe.name = n
  }
  if (patch.description !== undefined) safe.description = patch.description?.trim() || null
  if (patch.status !== undefined) {
    if (!['planning', 'active', 'completed', 'archived'].includes(patch.status)) {
      return { error: 'Недопустимый статус' }
    }
    safe.status = patch.status
  }
  if (Object.keys(safe).length === 0) return { success: true }

  const { error } = await admin.from('projects').update(safe).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/my-projects')
  revalidatePath('/admin')
  return { success: true }
}

/** Подробности проекта со списком участников и инвентаря. */
export async function getProjectDetails(projectId: string) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const supabase = createClient()

  const { data: project } = await supabase
    .from('projects')
    .select(`
      id, name, description, status, cell_id,
      cells:cell_id(id, code, color, locations:location_id(name))
    `)
    .eq('id', projectId)
    .maybeSingle()

  if (!project) return { error: 'Проект не найден' }

  const { data: members } = await supabase
    .from('project_members')
    .select('user_id, users:user_id(id, full_name, username, role)')
    .eq('project_id', projectId)

  const { data: items } = await supabase
    .from('project_inventory')
    .select('inventory_id, inventory:inventory_id(id, name, qr_code, status)')
    .eq('project_id', projectId)

  return { project, members: members ?? [], items: items ?? [] }
}

// ─── Управление ─────────────────────────────────────────────────────────────

/** Проверяем, что cell_id (если указан) — синяя и не занята другим проектом. */
async function validateBlueCell(admin: ReturnType<typeof getServiceClient>, cellId: string, excludeProjectId?: string | null) {
  const { data: cell } = await admin
    .from('cells')
    .select('id, color')
    .eq('id', cellId)
    .maybeSingle()
  if (!cell) return 'Ячейка не найдена'
  if (cell.color !== 'blue') return 'Можно выбрать только синюю ячейку'
  let q = admin.from('projects').select('id').eq('cell_id', cellId)
  if (excludeProjectId) q = q.neq('id', excludeProjectId)
  const { data: occupied } = await q.maybeSingle()
  if (occupied) return 'Эта ячейка уже привязана к другому проекту'
  return null
}

export async function createProject(input: {
  name: string
  description?: string | null
  status?: 'planning' | 'active' | 'completed' | 'archived'
  cell_id?: string | null
}) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()

  if (input.cell_id) {
    const err = await validateBlueCell(admin, input.cell_id)
    if (err) return { error: err }
  }

  const { data, error } = await admin
    .from('projects')
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: input.status || 'planning',
      cell_id: input.cell_id || null,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true, id: data.id }
}

export async function updateProject(id: string, patch: Partial<{
  name: string
  description: string | null
  status: 'planning' | 'active' | 'completed' | 'archived'
  cell_id: string | null
}>) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()

  if (patch.cell_id) {
    const err = await validateBlueCell(admin, patch.cell_id, id)
    if (err) return { error: err }
  }

  const { error } = await admin.from('projects').update(patch).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

export async function deleteProject(id: string) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()
  const { error } = await admin.from('projects').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

// ─── Участники ──────────────────────────────────────────────────────────────

export async function addProjectMember(projectId: string, userId: string) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()
  const { error } = await admin.from('project_members').insert({
    project_id: projectId,
    user_id: userId,
  })
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

export async function removeProjectMember(projectId: string, userId: string) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()
  const { error } = await admin
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

/** Список одобренных пользователей — для добавления в проект. */
export async function getApprovedUsers() {
  try { await requireStaff() } catch (e: any) { return [] }
  const supabase = createClient()
  const { data } = await supabase
    .from('users')
    .select('id, full_name, username, role')
    .eq('is_approved', true)
    .order('full_name')
  return data ?? []
}
