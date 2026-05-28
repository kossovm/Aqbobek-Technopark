import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import UserManagement from '@/components/admin/UserManagement'
import InventoryTable from '@/components/admin/InventoryTable'
import BulkAddStudents from '@/components/admin/BulkAddStudents'
import PasswordRequests from '@/components/admin/PasswordRequests'
import CategoryManagement from '@/components/admin/CategoryManagement'
import ProjectManagement from '@/components/admin/ProjectManagement'
import ActivityLogs from '@/components/admin/ActivityLogs'
import LocationsManagement from '@/components/admin/LocationsManagement'
import ProfileRequests from '@/components/admin/ProfileRequests'
import ScheduleManagement from '@/components/admin/ScheduleManagement'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Logo } from '@/components/Logo'
import {
  Users, PackageCheck, UserPlus, KeyRound, FolderKanban,
  Tags, Activity, Map, UserCog, CalendarDays,
} from 'lucide-react'

export default async function AdminPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, is_approved')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || !profile.is_approved) redirect('/')
  if (profile.role !== 'admin' && profile.role !== 'teacher') redirect('/')

  const isAdmin = profile.role === 'admin'

  return (
    <main className="max-w-7xl mx-auto p-4 md:p-8 mt-2 space-y-6">
      <div className="flex items-center gap-4">
        <Logo size={48} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Панель администратора</h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            Пользователи, инвентарь, проекты, расписание и логи
            <span className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded-full uppercase tracking-wider font-semibold">
              {profile.role}
            </span>
          </p>
        </div>
      </div>

      <Tabs defaultValue="users" className="w-full mt-4">
        <div className="overflow-x-auto pb-1">
          <TabsList className="inline-flex min-w-max mb-6 h-auto gap-1 bg-muted/60 p-1">
            <TabsTrigger value="users" className="flex items-center gap-1.5 text-xs h-auto py-2 px-3 rounded-lg">
              <Users className="w-3.5 h-3.5" /> Пользователи
            </TabsTrigger>
            <TabsTrigger value="bulk" className="flex items-center gap-1.5 text-xs h-auto py-2 px-3 rounded-lg">
              <UserPlus className="w-3.5 h-3.5" /> Доб. учеников
            </TabsTrigger>
            <TabsTrigger value="passwords" className="flex items-center gap-1.5 text-xs h-auto py-2 px-3 rounded-lg">
              <KeyRound className="w-3.5 h-3.5" /> Пароли
            </TabsTrigger>
            <TabsTrigger value="profiles" className="flex items-center gap-1.5 text-xs h-auto py-2 px-3 rounded-lg">
              <UserCog className="w-3.5 h-3.5" /> Профили
            </TabsTrigger>
            <TabsTrigger value="schedule" className="flex items-center gap-1.5 text-xs h-auto py-2 px-3 rounded-lg">
              <CalendarDays className="w-3.5 h-3.5" /> Расписание
            </TabsTrigger>
            <TabsTrigger value="locations" className="flex items-center gap-1.5 text-xs h-auto py-2 px-3 rounded-lg">
              <Map className="w-3.5 h-3.5" /> Карта
            </TabsTrigger>
            <TabsTrigger value="inventory" className="flex items-center gap-1.5 text-xs h-auto py-2 px-3 rounded-lg">
              <PackageCheck className="w-3.5 h-3.5" /> Инвентарь
            </TabsTrigger>
            <TabsTrigger value="categories" className="flex items-center gap-1.5 text-xs h-auto py-2 px-3 rounded-lg">
              <Tags className="w-3.5 h-3.5" /> Категории
            </TabsTrigger>
            <TabsTrigger value="projects" className="flex items-center gap-1.5 text-xs h-auto py-2 px-3 rounded-lg">
              <FolderKanban className="w-3.5 h-3.5" /> Проекты
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-1.5 text-xs h-auto py-2 px-3 rounded-lg">
              <Activity className="w-3.5 h-3.5" /> Логи
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="users"><UserManagement currentUserRole={profile.role} /></TabsContent>
        <TabsContent value="bulk"><BulkAddStudents isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="passwords"><PasswordRequests /></TabsContent>
        <TabsContent value="profiles"><ProfileRequests /></TabsContent>
        <TabsContent value="schedule"><ScheduleManagement /></TabsContent>
        <TabsContent value="locations"><LocationsManagement /></TabsContent>
        <TabsContent value="inventory"><InventoryTable /></TabsContent>
        <TabsContent value="categories"><CategoryManagement /></TabsContent>
        <TabsContent value="projects"><ProjectManagement /></TabsContent>
        <TabsContent value="logs"><ActivityLogs /></TabsContent>
      </Tabs>
    </main>
  )
}
