import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  QrCode, Package, Box, ChevronRight,
  ShieldCheck, Layers, MapPin, FolderKanban,
} from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { Logo } from '@/components/Logo'
import ScheduleWidget from '@/components/schedule/ScheduleWidget'

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return <Landing />

  const { data: profile } = await supabase
    .from('users')
    .select('id, full_name, role, is_approved, has_acknowledged_rules')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    await supabase.auth.signOut()
    redirect('/login')
  }

  if (!profile.is_approved) return <PendingApproval fullName={profile.full_name} />

  if (!profile.has_acknowledged_rules) redirect('/rules')

  return <Dashboard userId={user.id} fullName={profile.full_name} role={profile.role} />
}

// ============================================================================
// LANDING
// ============================================================================
function Landing() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 hero-glow">
      <div className="max-w-4xl w-full text-center space-y-10 py-16">
        {/* Logo + title */}
        <div className="flex flex-col items-center gap-5">
          <div className="relative">
            <div className="absolute inset-0 blur-3xl opacity-30 bg-primary rounded-full" />
            <Logo size={88} className="relative z-10 drop-shadow-xl" />
          </div>
          <div className="space-y-3">
            <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight">
              Aqbobek{' '}
              <span className="gradient-text">Technopark</span>
            </h1>
            <p className="text-muted-foreground text-lg max-w-md mx-auto leading-relaxed">
              Цифровой контроль инвентаря, расходных материалов и проектов школьного технопарка
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/login"
            className="relative overflow-hidden bg-primary text-white px-8 py-3.5 rounded-2xl font-semibold shadow-lg shadow-primary/30 active:scale-95 transition-all hover:shadow-primary/50 hover:shadow-xl group"
          >
            <span className="relative z-10">Войти в систему</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>
          <Link
            href="/register"
            className="glass px-8 py-3.5 rounded-2xl font-semibold hover:bg-card transition-all active:scale-95"
          >
            Зарегистрироваться
          </Link>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <FeatureCard
            icon={QrCode}
            color="#2766e7"
            title="QR-учёт"
            text="Сканируйте оборудование и берите под персональную ответственность"
          />
          <FeatureCard
            icon={Package}
            color="#6600a1"
            title="Расходники"
            text="Списание материалов с обязательным доказательством и учётом"
          />
          <FeatureCard
            icon={FolderKanban}
            color="#2ebc62"
            title="Проекты"
            text="Командная работа, закреплённые ячейки хранения и возвраты"
          />
        </div>

        <div className="text-left mt-8">
          <ScheduleWidget canManage={false} widgetTitle="Общее расписание" />
        </div>
      </div>
    </main>
  )
}

function FeatureCard({
  icon: Icon, color, title, text,
}: {
  icon: any; color: string; title: string; text: string
}) {
  return (
    <div className="glass rounded-2xl p-5 space-y-3 hover:shadow-lg transition-shadow">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}20` }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <h3 className="font-bold">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
    </div>
  )
}

// ============================================================================
// PENDING APPROVAL
// ============================================================================
function PendingApproval({ fullName }: { fullName: string | null }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 hero-glow">
      <div className="max-w-md w-full glass rounded-3xl p-8 text-center space-y-5 shadow-xl">
        <ShieldCheck className="w-14 h-14 mx-auto text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold">Ожидает подтверждения</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            {fullName ? `${fullName}, ` : ''}Ваш аккаунт создан, но ещё не подтверждён администратором.
            Обратитесь к преподавателю или дождитесь активации.
          </p>
        </div>
        <form action={logout}>
          <button type="submit" className="text-primary hover:underline text-sm font-medium">
            Выйти и войти под другим аккаунтом →
          </button>
        </form>
      </div>
    </main>
  )
}

// ============================================================================
// DASHBOARD
// ============================================================================
async function Dashboard({
  userId, fullName, role,
}: {
  userId: string; fullName: string | null; role: string
}) {
  const supabase = createClient()

  const [{ data: myTransactions }, { data: myProjects }] = await Promise.all([
    supabase
      .from('transactions')
      .select(`
        id, issued_at, quantity,
        inventory:inventory_id(
          id, name, qr_code, unit,
          home_cell:home_cell_id(code, color, locations:location_id(name))
        )
      `)
      .eq('user_id', userId)
      .is('returned_at', null),
    supabase
      .from('project_members')
      .select('project_id, projects:project_id(id, name, description, status)')
      .eq('user_id', userId),
  ])

  const myProjectIds = (myProjects ?? []).map((pm: any) => pm.project_id).filter(Boolean)

  let teamTxs: any[] = []
  if (myProjectIds.length > 0) {
    const { data } = await supabase
      .from('transactions')
      .select(`
        id, issued_at, quantity, user_id, project_id,
        users:user_id(full_name, username),
        projects:project_id(name),
        inventory:inventory_id(
          id, name, qr_code, unit,
          home_cell:home_cell_id(code, color, locations:location_id(name))
        )
      `)
      .in('project_id', myProjectIds)
      .neq('user_id', userId)
      .is('returned_at', null)
      .order('issued_at', { ascending: false })
    teamTxs = data ?? []
  }

  const cellHex = (color?: string) =>
    color === 'green' ? '#2ebc62' : color === 'blue' ? '#2766e7' : color === 'purple' ? '#6600a1' : '#888'

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8 space-y-8 mt-2 md:mt-4">
      {/* Greeting */}
      <section className="animate-in fade-in slide-in-from-bottom-3 duration-500">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Привет, <span className="gradient-text">{fullName?.split(' ')[0] || 'Студент'}</span>!
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Панель управления ресурсами Технопарка
            </p>
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="grid grid-cols-2 gap-3 md:gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
        <Link
          href="/scanner"
          className="relative overflow-hidden group bg-gradient-to-br from-primary/10 to-primary/5 hover:from-primary/15 border border-primary/20 transition-all active:scale-95 p-6 rounded-2xl flex flex-col items-center justify-center text-center gap-3 shadow-sm hover:shadow-md hover:shadow-primary/10"
        >
          <div className="bg-primary text-white p-3.5 rounded-full shadow-lg shadow-primary/30 group-hover:scale-110 transition-transform">
            <QrCode className="w-7 h-7" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-primary leading-none">Сканер</h3>
            <p className="text-[11px] text-primary/60 mt-1.5 font-semibold uppercase tracking-wider">
              Взять / Вернуть
            </p>
          </div>
        </Link>

        <Link
          href="/consumables"
          className="group bg-card hover:bg-muted transition-all active:scale-95 border p-6 rounded-2xl flex flex-col items-center justify-center text-center gap-3 shadow-sm hover:shadow-md"
        >
          <div className="bg-secondary p-3.5 rounded-full group-hover:scale-110 transition-transform">
            <Package className="w-7 h-7 text-secondary-foreground" />
          </div>
          <div>
            <h3 className="font-bold text-lg leading-none">Списание</h3>
            <p className="text-[11px] text-muted-foreground mt-1.5 font-semibold uppercase tracking-wider">
              Материалы
            </p>
          </div>
        </Link>
      </section>

      {/* Schedule widget */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
        <ScheduleWidget canManage={false} widgetTitle="Общее расписание" />
      </section>

      {/* My inventory */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
        <SectionHeader icon={<Box className="w-5 h-5 text-primary" />} title="Инвентарь на руках" />
        {myTransactions && myTransactions.length > 0 ? (
          <div className="grid gap-2.5 md:grid-cols-2 mt-3">
            {myTransactions.map((tx: any) => {
              const home = tx.inventory?.home_cell
              return (
                <TransactionCard key={tx.id} tx={tx} home={home} cellHex={cellHex} linkUrl="/scanner?mode=return" linkLabel="Вернуть" />
              )
            })}
          </div>
        ) : (
          <EmptyState icon={<Box className="w-8 h-8" />} text="Всё оборудование возвращено." />
        )}
      </section>

      {/* Team inventory */}
      {teamTxs.length > 0 && (
        <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-250">
          <SectionHeader
            icon={<Layers className="w-5 h-5 text-amber-500" />}
            title="У команды на руках"
          />
          <div className="grid gap-2.5 md:grid-cols-2 mt-3">
            {teamTxs.map((tx: any) => {
              const home = tx.inventory?.home_cell
              return (
                <TransactionCard
                  key={tx.id} tx={tx} home={home} cellHex={cellHex}
                  linkUrl="/scanner?mode=return"
                  linkLabel="Вернуть"
                  sub={`у ${tx.users?.full_name || tx.users?.username || '—'}${tx.projects?.name ? ` · ${tx.projects.name}` : ''}`}
                  linkVariant="amber"
                />
              )
            })}
          </div>
        </section>
      )}

      {/* Projects */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
        <div className="flex items-center justify-between mb-3">
          <SectionHeader icon={<FolderKanban className="w-5 h-5 text-primary" />} title="Мои проекты" noMargin />
          {myProjects && myProjects.length > 0 && (
            <Link href="/my-projects" className="text-xs text-primary hover:underline font-semibold">
              Все →
            </Link>
          )}
        </div>
        {myProjects && myProjects.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-2.5">
            {myProjects.map((pm: any) => (
              <Link
                key={pm.project_id}
                href="/my-projects"
                className="glass rounded-2xl p-4 shadow-sm hover:shadow-md transition-all flex items-center justify-between group"
              >
                <div className="min-w-0">
                  <h4 className="font-semibold text-base truncate">{pm.projects?.name}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                    {pm.projects?.description || 'Нет описания'}
                  </p>
                  <span
                    className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      pm.projects?.status === 'active'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {pm.projects?.status === 'active' ? 'В работе' : pm.projects?.status}
                  </span>
                </div>
                <ChevronRight className="text-muted-foreground group-hover:text-primary transition-colors w-5 h-5 flex-shrink-0 ml-2" />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={<FolderKanban className="w-8 h-8" />} text="Ты пока не состоишь в проектах." />
        )}
      </section>
    </main>
  )
}

function SectionHeader({
  icon, title, noMargin,
}: {
  icon: React.ReactNode; title: string; noMargin?: boolean
}) {
  return (
    <h2 className={`text-base font-bold flex items-center gap-2 ${noMargin ? '' : 'mb-3'}`}>
      {icon} {title}
    </h2>
  )
}

function TransactionCard({
  tx, home, cellHex, linkUrl, linkLabel, sub, linkVariant = 'primary',
}: {
  tx: any; home: any; cellHex: (c?: string) => string
  linkUrl: string; linkLabel: string; sub?: string; linkVariant?: 'primary' | 'amber'
}) {
  return (
    <div className="glass rounded-2xl p-4 flex items-center justify-between gap-3 hover:shadow-sm transition-shadow">
      <div className="pr-2 min-w-0 flex-1">
        <h4 className="font-semibold text-sm truncate">
          {tx.inventory?.name}
          {tx.quantity > 1 && <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400">×{tx.quantity}</span>}
        </h4>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        <p className="text-xs text-muted-foreground mt-0.5">
          {new Date(tx.issued_at).toLocaleDateString('ru-RU')}
        </p>
        {home && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
            <MapPin className="w-3 h-3" style={{ color: cellHex(home.color) }} />
            <code className="font-bold">{home.code}</code>
            {home.locations?.name && <span className="text-muted-foreground">· {home.locations.name}</span>}
          </div>
        )}
      </div>
      <Link
        href={linkUrl}
        className={`flex-shrink-0 text-xs font-bold px-3.5 py-2 rounded-xl transition-colors shadow-sm ${
          linkVariant === 'amber'
            ? 'text-amber-700 bg-amber-100 hover:bg-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:hover:bg-amber-900/50'
            : 'text-primary bg-primary/10 hover:bg-primary/20'
        }`}
      >
        {linkLabel}
      </Link>
    </div>
  )
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="border border-dashed rounded-2xl p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
      <div className="opacity-20">{icon}</div>
      <p className="text-sm font-medium">{text}</p>
    </div>
  )
}
