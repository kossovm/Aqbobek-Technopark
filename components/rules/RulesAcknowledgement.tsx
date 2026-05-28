'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { acknowledgeRules } from '@/app/actions/auth'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function RulesAcknowledgement({ alreadyDone }: { alreadyDone: boolean }) {
  const { toast } = useToast()
  const router = useRouter()
  const [checked, setChecked] = useState(alreadyDone)
  const [isLoading, setIsLoading] = useState(false)

  if (alreadyDone) {
    return (
      <div className="bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800 rounded-2xl p-5 flex items-center gap-3">
        <CheckCircle2 className="w-5 h-5 text-green-600" />
        <p className="text-sm text-green-800 dark:text-green-300">
          Вы уже ознакомились с правилами.
        </p>
      </div>
    )
  }

  const onSubmit = async () => {
    if (!checked) {
      toast({ title: 'Поставьте галочку', description: 'Подтвердите, что прочитали правила', variant: 'destructive' })
      return
    }
    setIsLoading(true)
    const res = await acknowledgeRules()
    if (res?.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      setIsLoading(false)
      return
    }
    toast({ title: 'Готово', description: 'Доступ к сканеру и списанию открыт' })
    router.replace('/')
    router.refresh()
  }

  return (
    <div className="bg-card border rounded-2xl p-6 space-y-4 shadow-sm">
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          className="mt-1 w-5 h-5 accent-primary"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          disabled={isLoading}
        />
        <span className="text-sm">
          Я ознакомился с правилами и несу материальную ответственность за оборудование и расходники, которые
          беру под свою учетную запись.
        </span>
      </label>
      <Button onClick={onSubmit} disabled={!checked || isLoading} className="w-full h-12 text-base">
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
        Подтвердить
      </Button>
    </div>
  )
}
