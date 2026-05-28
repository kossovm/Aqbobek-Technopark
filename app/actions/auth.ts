'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { SYNTH_EMAIL_DOMAIN } from '@/lib/utils'
import { logEvent } from './logs'

function normalizeUsername(raw: string): string {
  return String(raw || '').trim().toLowerCase()
}

function isValidUsername(u: string): boolean {
  return /^[a-z0-9_.-]{3,32}$/i.test(u)
}

function isValidEmail(e: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)
}

function looksLikeEmail(s: string): boolean {
  return s.includes('@')
}

function syntheticEmail(username: string): string {
  return `${normalizeUsername(username)}@${SYNTH_EMAIL_DOMAIN}`
}

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ─── Логин ──────────────────────────────────────────────────────────────────

export async function login(formData: FormData) {
  const raw = String(formData.get('username') || '').trim()
  const password = String(formData.get('password') || '')

  if (!raw || !password) return { error: 'Введите логин и пароль' }

  const supabase = createClient()

  let email: string
  if (looksLikeEmail(raw)) {
    email = raw.toLowerCase()
  } else {
    const { data: rpcEmail, error: rpcErr } = await supabase.rpc('get_login_email', {
      p_username: raw,
    })
    if (rpcErr) return { error: 'Не удалось проверить логин: ' + rpcErr.message }
    if (!rpcEmail) return { error: 'Логин не найден' }
    email = rpcEmail as string
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: humanizeAuthError(error.message) }
  if (!data.user) return { error: 'Не удалось войти. Попробуйте ещё раз.' }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('is_approved')
    .eq('id', data.user.id)
    .maybeSingle()

  if (profileError) {
    await supabase.auth.signOut()
    return { error: 'Не удалось загрузить профиль: ' + profileError.message }
  }
  if (!profile) {
    await supabase.auth.signOut()
    return { error: 'Профиль не найден. Обратитесь к администратору.' }
  }
  if (!profile.is_approved) {
    await supabase.auth.signOut()
    return { error: 'Аккаунт ещё не подтверждён администратором.' }
  }

  await logEvent({
    user_id: data.user.id,
    action: 'login',
    entity_type: 'session',
  })

  revalidatePath('/', 'layout')
  redirect('/')
}

// ─── Регистрация ─────────────────────────────────────────────────────────────
// Используем Admin API (service_role) вместо anon signUp — это полностью
// обходит rate-limit Supabase (≤3 signUp в час на IP через anon key).
// email_confirm:true — не требует подтверждения почты.
// is_approved остаётся false — пользователь ждёт ручного одобрения админом.

export async function signUp(formData: FormData) {
  const username = normalizeUsername(String(formData.get('username') || ''))
  const fullName = String(formData.get('fullName') || '').trim()
  const password = String(formData.get('password') || '')
  const realEmailRaw = String(formData.get('email') || '').trim()
  const realEmail = realEmailRaw.toLowerCase() || null
  const classValue = String(formData.get('class') || '').trim() || null
  const requestedRole = String(formData.get('requested_role') || 'student')

  if (!username || !fullName || !password) return { error: 'Заполните логин, ФИО и пароль' }
  if (!isValidUsername(username)) return { error: 'Логин: 3–32 символа, латиница/цифры/_.-' }
  if (password.length < 6) return { error: 'Пароль должен быть не короче 6 символов' }
  if (realEmail && !isValidEmail(realEmail)) return { error: 'Email указан в некорректном формате' }

  const admin = getAdminClient()

  // Проверяем уникальность логина через сервисный клиент (не через RPC — надёжнее)
  const { data: existingUser } = await admin
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle()

  if (existingUser) return { error: 'Такой логин уже занят, выберите другой' }

  // Если ввели реальный email — проверяем, что он не занят
  const authEmail = realEmail ?? syntheticEmail(username)
  if (realEmail) {
    const { data: existingEmail } = await admin
      .from('users')
      .select('id')
      .eq('email', realEmail)
      .maybeSingle()
    if (existingEmail) return { error: 'Такой email уже зарегистрирован' }
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      username,
      class: classValue,
      requested_role: requestedRole,
    },
  })

  if (error) return { error: humanizeAuthError(error.message) }
  if (!data.user) return { error: 'Не удалось создать аккаунт' }

  // Триггер handle_new_user уже создал строку в public.users.
  // Дополняем её полями, которые триггер берёт из metadata (class, requested_role).
  // На всякий случай принудительно обновляем, если триггер не успел.
  await admin.from('users').upsert({
    id: data.user.id,
    full_name: fullName,
    username,
    email: authEmail,
    class: classValue,
    requested_role: requestedRole,
    role: 'student',
    is_approved: false,
    has_acknowledged_rules: false,
  }, { onConflict: 'id' })

  return { success: true }
}

// ─── Вход по QR-коду ─────────────────────────────────────────────────────────
//
// Идея: у каждого пользователя есть случайный login_qr_token (см. SQL 12).
// QR-код содержит этот токен. На сервере мы находим email пользователя,
// генерируем magic-link через Admin API и возвращаем клиенту
// { email, token_hash }. Клиент вызывает verifyOtp() — это создаёт сессию
// через @supabase/ssr.
//
// При компрометации кнопка «Перевыпустить» в профиле просто меняет токен
// (см. profile.ts → regenerateMyLoginQR). Старый QR сразу перестаёт работать.

export async function loginByQR(token: string) {
  const tokenTrim = String(token || '').trim()
  if (!tokenTrim) return { error: 'Пустой QR-код' }

  const supabase = createClient()

  // Берём email через RPC SECURITY DEFINER — RLS обходим.
  const { data: email, error: rpcErr } = await supabase.rpc('get_email_by_login_qr', {
    p_token: tokenTrim,
  })
  if (rpcErr) return { error: 'Не удалось проверить QR-код: ' + rpcErr.message }
  if (!email) return { error: 'QR-код не распознан или был перевыпущен' }

  // Дополнительная проверка: пользователь одобрен?
  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('id, is_approved')
    .eq('email', email)
    .maybeSingle()
  if (!profile) return { error: 'Профиль не найден' }
  if (!profile.is_approved) return { error: 'Аккаунт ещё не подтверждён администратором' }

  // Получаем magiclink — нам нужен только hashed_token для verifyOtp.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: email as string,
  })
  if (linkErr) return { error: 'Не удалось сгенерировать вход: ' + linkErr.message }

  const tokenHash = (linkData as any)?.properties?.hashed_token as string | undefined
  if (!tokenHash) return { error: 'Сервер не вернул токен входа' }

  await logEvent({
    user_id: profile.id,
    action: 'login_qr_request',
    entity_type: 'session',
  })

  return { success: true, email: email as string, tokenHash }
}

// ─── Выход ───────────────────────────────────────────────────────────────────

export async function logout() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await logEvent({
      user_id: user.id,
      action: 'logout',
      entity_type: 'session',
    })
  }
  await supabase.auth.signOut()
  redirect('/login')
}

// ─── Принятие правил ─────────────────────────────────────────────────────────

export async function acknowledgeRules() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Необходима авторизация' }

  const { error } = await supabase
    .from('users')
    .update({ has_acknowledged_rules: true })
    .eq('id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
  return { success: true }
}

// ─── Смена пароля (авторизованный пользователь) ──────────────────────────────

export async function requestPasswordChange(formData: FormData) {
  const newPassword = String(formData.get('newPassword') || '')
  const note = String(formData.get('note') || '').trim() || null

  if (!newPassword || newPassword.length < 6) {
    return { error: 'Новый пароль должен быть не короче 6 символов' }
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Необходима авторизация' }

  const { data: profile } = await supabase
    .from('users')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.username) return { error: 'Профиль не найден' }

  // Проверяем: нет ли уже pending-заявки
  const { count } = await supabase
    .from('password_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'pending')

  if ((count ?? 0) >= 2) {
    return { error: 'У вас уже есть необработанные заявки. Дождитесь ответа администратора.' }
  }

  const { error } = await supabase
    .from('password_change_requests')
    .insert({
      user_id: user.id,
      username: profile.username,
      new_password: newPassword,
      type: 'change',
      note,
    })

  if (error) return { error: error.message }
  return { success: true }
}

// ─── Сброс пароля (неавторизованный — забыл пароль) ──────────────────────────

export async function requestPasswordReset(formData: FormData) {
  const username = normalizeUsername(String(formData.get('username') || ''))
  const newPassword = String(formData.get('newPassword') || '')
  const note = String(formData.get('note') || '').trim() || null

  if (!username) return { error: 'Введите логин' }
  if (!newPassword || newPassword.length < 6) {
    return { error: 'Новый пароль должен быть не короче 6 символов' }
  }

  const supabase = createClient()
  const { data, error } = await supabase.rpc('submit_password_reset_request', {
    p_username: username,
    p_new_password: newPassword,
    p_note: note,
  })

  if (error) return { error: error.message }
  if (data?.error) return { error: data.error as string }
  return { success: true }
}

// ─── Утилита ─────────────────────────────────────────────────────────────────

function humanizeAuthError(msg: string): string {
  if (!msg) return 'Неизвестная ошибка'
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Неверный логин или пароль'
  if (m.includes('email not confirmed')) return 'Email ещё не подтверждён'
  if (m.includes('user already registered')) return 'Такой email/логин уже зарегистрирован'
  if (m.includes('rate limit')) return 'Слишком много попыток. Подождите минуту.'
  if (m.includes('signups not allowed') || m.includes('signup disabled')) {
    return 'Самостоятельная регистрация отключена. Обратитесь к администратору.'
  }
  if (m.includes('already been registered')) return 'Такой email уже используется'
  return msg
}
