export type Unit = 'piece' | 'kg' | 'm2' | 'liter' | 'meter' | 'gram' | 'cm2'

export const UNITS: { value: Unit; label: string }[] = [
  { value: 'piece', label: 'штука' },
  { value: 'kg',    label: 'кг' },
  { value: 'gram',  label: 'грамм' },
  { value: 'liter', label: 'литр' },
  { value: 'meter', label: 'метр' },
  { value: 'm2',    label: 'м²' },
  { value: 'cm2',   label: 'см²' },
]

export const unitLabel = (u: string): string =>
  UNITS.find((x) => x.value === u)?.label ?? u
