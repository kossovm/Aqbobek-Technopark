import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Синтетический домен, которым мы заполняем auth.users.email
 * для пользователей без настоящей почты. В UI такие email не показываем.
 * Должен совпадать с SYNTH_EMAIL_DOMAIN в app/actions/auth.ts.
 */
export const SYNTH_EMAIL_DOMAIN = "aqbobek.kz"

/** true, если email — синтетический («реальной почты у юзера нет»). */
export function isSyntheticEmail(email?: string | null): boolean {
  if (!email) return false
  return email.toLowerCase().endsWith(`@${SYNTH_EMAIL_DOMAIN}`)
}

/** Email для отображения в UI: синтетический не показываем. */
export function displayEmail(email?: string | null): string {
  if (!email || isSyntheticEmail(email)) return "—"
  return email
}
