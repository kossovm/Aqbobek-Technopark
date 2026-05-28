import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import MyProjectsClient from '@/components/projects/MyProjectsClient'

export default async function MyProjectsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('is_approved, has_acknowledged_rules')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.is_approved) redirect('/')
  if (!profile.has_acknowledged_rules) redirect('/rules')

  return <MyProjectsClient />
}
