'use server'

import { createClient } from '@/utils/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import type { Unit } from '@/lib/units'

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

export async function getCategories() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('name')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createCategory(input: {
  name: string
  is_consumable: boolean
  default_unit: Unit
  description?: string | null
}) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()
  const { error } = await admin.from('categories').insert({
    name: input.name.trim(),
    is_consumable: input.is_consumable,
    default_unit: input.default_unit,
    description: input.description?.trim() || null,
  })
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

export async function updateCategory(id: string, patch: Partial<{
  name: string
  is_consumable: boolean
  default_unit: Unit
  description: string | null
}>) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()
  const { error } = await admin.from('categories').update(patch).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}

export async function deleteCategory(id: string) {
  try { await requireStaff() } catch (e: any) { return { error: e.message } }
  const admin = getServiceClient()

  // Проверяем, что нет инвентаря с такой категорией
  const { count } = await admin
    .from('inventory')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id)

  if ((count ?? 0) > 0) {
    return { error: `К категории привязано ${count} единиц инвентаря — нельзя удалить.` }
  }

  const { error } = await admin.from('categories').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { success: true }
}
