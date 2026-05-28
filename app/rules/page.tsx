import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import RulesAcknowledgement from '@/components/rules/RulesAcknowledgement'

export default async function RulesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('full_name, is_approved, has_acknowledged_rules')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || !profile.is_approved) redirect('/')

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Правила технопарка</h1>
        <p className="text-muted-foreground">
          Прежде чем брать оборудование и списывать расходники, прочтите правила и подтвердите
          материальную ответственность.
        </p>
      </div>

      <div className="bg-card border rounded-2xl p-6 space-y-4 shadow-sm">
        <Rule
          title="1. Персональная ответственность"
          body="Любое оборудование, взятое по QR-коду, числится лично за вами до момента возврата. За потерю или порчу — материальная ответственность."
        />
        <Rule
          title="2. Возврат на место"
          body="При возврате положите вещь именно в ту локацию, которую укажет система. Не оставляйте на столе."
        />
        <Rule
          title="3. Расходники со скриншотом"
          body="Списание пластика, фанеры и т.п. фиксируется только со скриншотом из слайсера (Orca / Bambu Studio)."
        />
        <Rule
          title="4. 3D-принтеры и резак"
          body="Работа на оборудовании только с разрешения учителя и с соблюдением техники безопасности."
        />
        <Rule
          title="5. Штрафы"
          body="Систематическое нарушение → ограничение доступа к технопарку и материальная компенсация."
        />
      </div>

      <RulesAcknowledgement alreadyDone={!!profile.has_acknowledged_rules} />
    </main>
  )
}

function Rule({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{body}</p>
    </div>
  )
}
