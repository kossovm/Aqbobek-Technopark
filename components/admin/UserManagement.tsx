'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  getPendingUsers,
  getAllUsers,
  approveUser,
  approveAllPending,
  changeUserRole,
  deleteUser,
  regenerateUserLoginQR,
} from '@/app/actions/admin'
import { Loader2, Check, X, Trash2, CheckCheck, RefreshCw } from 'lucide-react'
import { displayEmail } from '@/lib/utils'

type User = {
  id: string
  full_name: string | null
  username?: string | null
  email?: string | null
  role: string
  is_approved: boolean
  created_at: string
}

export default function UserManagement({
  currentUserRole,
}: {
  currentUserRole: 'admin' | 'teacher' | string
}) {
  const { toast } = useToast()
  const [pendingUsers, setPendingUsers] = useState<User[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isApproveAllBusy, setIsApproveAllBusy] = useState(false)

  const isAdmin = currentUserRole === 'admin'

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [pending, all] = await Promise.all([getPendingUsers(), getAllUsers()])
      setPendingUsers(pending as User[])
      setAllUsers(all as User[])
    } catch (error: any) {
      toast({ title: 'Ошибка загрузки', description: error.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleApprove = async (id: string) => {
    const res = await approveUser(id)
    if (res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    } else {
      toast({ title: 'Успех', description: 'Пользователь подтвержден' })
      loadData()
    }
  }

  const handleDelete = async (id: string) => {
    if (!isAdmin) {
      toast({ title: 'Недостаточно прав', description: 'Удаление доступно только администратору', variant: 'destructive' })
      return
    }
    if (!confirm('Точно удалить пользователя? Это безвозвратное действие.')) return
    const res = await deleteUser(id)
    if (res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    } else {
      toast({ title: 'Пользователь удален' })
      loadData()
    }
  }

  const handleApproveAll = async () => {
    if (!confirm(`Принять всех ${pendingUsers.length} ожидающих пользователей?`)) return
    setIsApproveAllBusy(true)
    const res = await approveAllPending()
    setIsApproveAllBusy(false)
    if (res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    } else {
      toast({ title: 'Готово', description: `Принято: ${pendingUsers.length} пользователей` })
      loadData()
    }
  }

  const handleRotateQR = async (user: User) => {
    if (!confirm(`Перевыпустить QR-код входа для «${user.full_name || user.username}»? Старый сразу перестанет работать.`)) return
    const res = await regenerateUserLoginQR(user.id)
    if (res.error) toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    else toast({ title: 'QR обновлён', description: `Старый код больше не действует.` })
  }

  const handleRoleChange = async (id: string, role: string) => {
    if (!isAdmin) {
      toast({ title: 'Недостаточно прав', description: 'Смена роли доступна только администратору', variant: 'destructive' })
      return
    }
    const res = await changeUserRole(id, role)
    if (res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
    } else {
      toast({ title: 'Роль изменена' })
      loadData()
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Управление пользователями</h2>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="pending">Ожидают ({pendingUsers.length})</TabsTrigger>
          <TabsTrigger value="all">Все пользователи</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="pt-4">
          {pendingUsers.length > 1 && (
            <div className="flex justify-end mb-3">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 gap-1.5"
                onClick={handleApproveAll}
                disabled={isApproveAllBusy}
              >
                {isApproveAllBusy
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <CheckCheck className="w-4 h-4" />
                }
                Принять всех ({pendingUsers.length})
              </Button>
            </div>
          )}
          <div className="rounded-md border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ФИО</TableHead>
                  <TableHead>Логин</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Дата регистрации</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      <Loader2 className="animate-spin mx-auto h-6 w-6 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : pendingUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Нет ожидающих заявок
                    </TableCell>
                  </TableRow>
                ) : (
                  pendingUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.full_name || '—'}</TableCell>
                      <TableCell className="font-mono text-sm">{user.username || '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{displayEmail(user.email)}</TableCell>
                      <TableCell>{new Date(user.created_at).toLocaleDateString('ru-RU')}</TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="default"
                          className="bg-green-600 hover:bg-green-700"
                          onClick={() => handleApprove(user.id)}
                        >
                          <Check className="h-4 w-4 mr-1" /> Принять
                        </Button>
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDelete(user.id)}
                          >
                            <X className="h-4 w-4 mr-1" /> Отклонить
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="all" className="pt-4">
          <div className="rounded-md border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ФИО</TableHead>
                  <TableHead>Логин</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <Loader2 className="animate-spin mx-auto h-6 w-6 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : (
                  allUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.full_name || '—'}</TableCell>
                      <TableCell className="font-mono text-sm">{user.username || '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{displayEmail(user.email)}</TableCell>
                      <TableCell>
                        {isAdmin ? (
                          <Select
                            defaultValue={user.role}
                            onValueChange={(val) => handleRoleChange(user.id, val)}
                          >
                            <SelectTrigger className="w-[130px] h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="student">Ученик</SelectItem>
                              <SelectItem value="teacher">Учитель</SelectItem>
                              <SelectItem value="admin">Админ</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm uppercase tracking-wider">{user.role}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.is_approved ? (
                          <span className="text-xs font-semibold px-2 py-1 bg-green-100 text-green-800 rounded-full dark:bg-green-900/30 dark:text-green-400">
                            Активен
                          </span>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full dark:bg-yellow-900/30 dark:text-yellow-400">
                            Ожидает
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {!user.is_approved && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="mr-2"
                            onClick={() => handleApprove(user.id)}
                          >
                            <Check className="h-4 w-4 mr-1" /> Принять
                          </Button>
                        )}
                        {user.is_approved && (
                          <Button
                            size="icon" variant="ghost"
                            className="mr-1 text-amber-700 hover:bg-amber-100"
                            onClick={() => handleRotateQR(user)}
                            title="Перевыпустить QR входа"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => handleDelete(user.id)}
                            title="Удалить"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
