import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import ProfileClient from '@/components/profile/ProfileClient'

export default async function ProfilePage() {
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

  return <ProfileClient />
}
