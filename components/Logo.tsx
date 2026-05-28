import Image from 'next/image'
import { cn } from '@/lib/utils'

interface LogoProps {
  size?: number
  spinning?: boolean
  className?: string
  /** Show text alongside logo */
  withText?: boolean
  textClass?: string
}

export function Logo({ size = 36, spinning = false, className, withText = false, textClass }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <Image
        src="/logo.png"
        alt="Aqbobek Technopark"
        width={size}
        height={size}
        className={cn('object-contain', spinning && 'animate-logo-spin')}
        priority
      />
      {withText && (
        <span className={cn('font-bold tracking-tight leading-none', textClass)}>
          Aqbobek<span className="gradient-text"> Technopark</span>
        </span>
      )}
    </span>
  )
}

/** Drop-in spinner replacement for Loader2 */
export function LogoSpinner({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt="loading"
      width={size}
      height={size}
      className={cn('object-contain animate-logo-spin', className)}
    />
  )
}
