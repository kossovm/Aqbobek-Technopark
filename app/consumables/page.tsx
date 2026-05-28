import UsageForm from '@/components/consumables/UsageForm'
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export default async function ConsumablesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('is_approved, has_acknowledged_rules')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || !profile.is_approved) redirect('/')
  if (!profile.has_acknowledged_rules) redirect('/rules')

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-8 space-y-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Списание материалов</h1>
        <p className="text-muted-foreground mt-1">Укажите, какие расходники были потрачены</p>
      </div>

      <UsageForm />
    </main>
  )
}
