'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import {
  getMyProfile, getMyPendingProfileRequest,
  submitProfileChangeRequest, cancelMyPendingProfileRequest,
  regenerateMyLoginQR,
} from '@/app/actions/profile'
import {
  Loader2, Save, RefreshCw, Download, ShieldCheck,
  AlertTriangle, Hourglass, X, User, FileEdit, Eye, EyeOff, Tag, FileText,
} from 'lucide-react'
import PrintableLabel, { type LabelItem } from '@/components/admin/PrintableLabel'

type Profile = {
  id: string
  full_name: string | null
  username: string | null
  email: string | null
  class: string | null
  role: string
  is_approved: boolean
  login_qr_token: string | null
}

type PendingReq = {
  id: string
  requested_full_name: string | null
  requested_class: string | null
  requested_email: string | null
  note: string | null
  created_at: string
}

export default function ProfileClient() {
  const { toast } = useToast()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [pending, setPending] = useState<PendingReq | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // form
  const [fullName, setFullName] = useState('')
  const [klass, setKlass] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // QR
  const [qrSvg, setQrSvg] = useState<string>('')
  const [isRotating, setIsRotating] = useState(false)
  const [qrVisible, setQrVisible] = useState(false)
  const [labelItems, setLabelItems] = useState<LabelItem[] | null>(null)
  const printFrameRef = useRef<HTMLIFrameElement | null>(null)

  const load = async () => {
    setIsLoading(true)
    try {
      const [p, pr] = await Promise.all([getMyProfile(), getMyPendingProfileRequest()])
      const prof = p as Profile
      setProfile(prof)
      setPending(pr as PendingReq | null)
      if (!pr) {
        setFullName(prof?.full_name ?? '')
        setKlass(prof?.class ?? '')
        setEmail(prof?.email ?? '')
        setNote('')
      }
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  // ─── QR-код ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.login_qr_token) { setQrSvg(''); return }
    QRCode.toString(profile.login_qr_token, {
      type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 320,
    }).then(setQrSvg).catch(() => setQrSvg(''))
  }, [profile?.login_qr_token])

  const handleRotateQR = async () => {
    if (!confirm('Перевыпустить QR-код входа? Старый сразу перестанет работать.')) return
    setIsRotating(true)
    const res = await regenerateMyLoginQR()
    setIsRotating(false)
    if (res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      return
    }
    toast({ title: 'QR обновлён', description: 'Старый код больше не действует.' })
    setQrVisible(false)
    load()
  }

  const printAsLabel = () => {
    if (!profile?.login_qr_token) return
    const subtitle = [profile.full_name, profile.class].filter(Boolean).join(' · ') || profile.username || 'login'
    setLabelItems([{ qrCode: profile.login_qr_token, name: subtitle }])
  }

  const downloadQR = async () => {
    if (!profile?.login_qr_token) return
    const dataUrl = await QRCode.toDataURL(profile.login_qr_token, {
      errorCorrectionLevel: 'M', margin: 2, width: 600,
    })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `aqbobek-login-${profile.username ?? 'me'}.png`
    a.click()
  }

  const printQR = async () => {
    if (!profile?.login_qr_token) return
    const dataUrl = await QRCode.toDataURL(profile.login_qr_token, {
      errorCorrectionLevel: 'M', margin: 2, width: 720,
    })

    // Используем скрытый iframe (надёжнее, чем window.open под мобильным фокусом)
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '-99999px'
    iframe.style.bottom = '-99999px'
    iframe.style.width = '0'
    iframe.style.height = '0'
    document.body.appendChild(iframe)
    printFrameRef.current = iframe

    const idoc = iframe.contentDocument!
    idoc.open()
    idoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8" />
      <title>QR входа · ${profile.full_name ?? profile.username ?? ''}</title>
      <style>
        @page { size: A6 portrait; margin: 8mm; }
        html, body { margin: 0; padding: 0; font-family: system-ui, sans-serif; color: #000; }
        .wrap {
          width: 100%; min-height: 100vh; box-sizing: border-box;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 8mm; gap: 4mm;
        }
        h1 { margin: 0; font-size: 14pt; font-weight: 700; }
        .sub { font-size: 10pt; color: #444; text-align: center; }
        img { width: 60mm; height: 60mm; object-fit: contain; }
        .num { font-family: monospace; font-size: 9pt; color: #666; word-break: break-all; text-align: center; }
        .hint { font-size: 8pt; color: #888; text-align: center; margin-top: 2mm; }
      </style>
      </head><body>
        <div class="wrap">
          <h1>${(profile.full_name ?? profile.username ?? '').replace(/</g, '')}</h1>
          <div class="sub">Aqbobek Technopark · вход по QR</div>
          <img src="${dataUrl}" alt="login QR" />
          <div class="num">${profile.username ?? ''}</div>
          <div class="hint">Покажите этот QR на странице входа,<br/>чтобы попасть в систему без пароля.</div>
        </div>
      </body></html>`)
    idoc.close()

    const after = () => {
      try { iframe.parentNode?.removeChild(iframe) } catch {}
      printFrameRef.current = null
    }
    iframe.contentWindow?.addEventListener?.('afterprint', after)
    setTimeout(() => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    }, 200)
  }

  // ─── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setIsSubmitting(true)
    const res = await submitProfileChangeRequest({
      full_name: fullName, class: klass, email, note,
    })
    setIsSubmitting(false)
    if (res.error) {
      toast({ title: 'Не отправлено', description: res.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Заявка отправлена', description: 'Ожидайте подтверждения администратора.' })
    load()
  }

  const handleCancelPending = async () => {
    if (!confirm('Отменить заявку на смену профиля?')) return
    const res = await cancelMyPendingProfileRequest()
    if (res.error) {
      toast({ title: 'Ошибка', description: res.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Заявка отозвана' })
    load()
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <main className="max-w-3xl mx-auto p-8 text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
      </main>
    )
  }
  if (!profile) {
    return <main className="p-8 text-center text-destructive">Профиль не найден</main>
  }

  const hasPending = !!pending

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-8 space-y-6 mt-2">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <User className="w-7 h-7" /> Профиль
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Изменения профиля проходят через заявку — администратор должен её одобрить.
          </p>
        </div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← На главную</Link>
      </header>

      {/* ─── Pending banner ─── */}
      {hasPending && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold flex items-center gap-2 text-amber-900">
              <Hourglass className="w-5 h-5" /> Заявка на проверке
            </h3>
            <Button variant="ghost" size="sm" onClick={handleCancelPending} className="text-amber-900 hover:bg-amber-100">
              <X className="w-4 h-4 mr-1" /> Отменить
            </Button>
          </div>
          <ul className="text-sm space-y-1 text-amber-900/90">
            {pending?.requested_full_name && <li>ФИО → <b>{pending.requested_full_name}</b></li>}
            {pending?.requested_class     && <li>Класс → <b>{pending.requested_class}</b></li>}
            {pending?.requested_email     && <li>Email → <b>{pending.requested_email}</b></li>}
            {pending?.note                && <li className="text-xs italic">«{pending.note}»</li>}
          </ul>
          <p className="text-xs text-amber-900/70 pt-1">
            Пока заявка не обработана, поля профиля заблокированы.
          </p>
        </div>
      )}

      {/* ─── Edit form ─── */}
      <section className="bg-card border rounded-2xl p-5 space-y-4">
        <h2 className="font-bold text-lg flex items-center gap-2">
          <FileEdit className="w-5 h-5" /> Личные данные
        </h2>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Логин" hint="Меняет только админ">
            <Input value={profile.username ?? ''} disabled />
          </Field>
          <Field label="Роль" hint="Меняет только админ">
            <Input value={profile.role} disabled />
          </Field>
          <Field label="ФИО">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={hasPending} />
          </Field>
          <Field label="Класс">
            <Input value={klass} onChange={(e) => setKlass(e.target.value)} placeholder="10А" disabled={hasPending} />
          </Field>
          <Field label="Email" className="sm:col-span-2">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={hasPending} />
          </Field>
          <Field label="Комментарий админу (необязательно)" className="sm:col-span-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} disabled={hasPending} placeholder="Например: Сменил фамилию" />
          </Field>
        </div>

        <div className="flex justify-end pt-1">
          <Button onClick={handleSubmit} disabled={hasPending || isSubmitting}>
            {isSubmitting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Отправить на проверку
          </Button>
        </div>
      </section>

      {/* ─── Login QR ─── */}
      <section className="bg-card border rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" /> Вход по QR-коду
          </h2>
          <Button variant="outline" size="sm" onClick={handleRotateQR} disabled={isRotating}>
            {isRotating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Перевыпустить
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          Покажите этот QR-код на странице входа, и система пустит вас без пароля.
          При компрометации сразу нажмите «Перевыпустить» — старый QR перестанет работать.
        </p>

        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          {/* QR с глазком: по умолчанию замазан, открывается по клику */}
          <button
            type="button"
            onClick={() => setQrVisible((v) => !v)}
            className="relative w-[240px] h-[240px] bg-white border rounded-xl p-2 flex items-center justify-center group focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label={qrVisible ? 'Скрыть QR-код' : 'Показать QR-код'}
            title={qrVisible ? 'Скрыть QR-код' : 'Показать QR-код'}
          >
            <div
              className={`absolute inset-2 transition [&_svg]:w-full [&_svg]:h-full ${qrVisible ? 'blur-0 opacity-100' : 'blur-md opacity-30 select-none pointer-events-none'}`}
              dangerouslySetInnerHTML={{ __html: qrSvg || '' }}
            />
            {!qrVisible && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/40 backdrop-blur-[2px] rounded-xl">
                <Eye className="w-8 h-8 text-foreground/80" />
                <span className="text-xs font-medium text-foreground/80">Нажмите, чтобы показать</span>
              </div>
            )}
            {qrVisible && (
              <div className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition">
                <EyeOff className="w-3.5 h-3.5" />
              </div>
            )}
          </button>
          <div className="flex flex-col gap-2 w-full sm:w-auto">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mt-1">Печать</div>
            <Button onClick={printQR}>
              <FileText className="w-4 h-4 mr-1" /> На A4
            </Button>
            <Button variant="secondary" onClick={printAsLabel}>
              <Tag className="w-4 h-4 mr-1" /> Этикетка 40×30
            </Button>
            <Button variant="outline" onClick={downloadQR}>
              <Download className="w-4 h-4 mr-1" /> Скачать PNG
            </Button>
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2 mt-2 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                Никому не передавайте QR — он работает как пароль.
                Если был скомпрометирован — «Перевыпустить» и переклеить новую этикетку поверх старой.
              </span>
            </div>
          </div>
        </div>
      </section>

      <PrintableLabel
        items={labelItems}
        format="qr"
        onAfterPrint={() => setLabelItems(null)}
      />
    </main>
  )
}

function Field({ label, hint, children, className }: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <label className="text-sm font-medium flex items-center justify-between gap-2">
        <span>{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
