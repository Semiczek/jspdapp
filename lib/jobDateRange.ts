function toDateKey(value: string | null) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function jobOverlapsRange(
  startAt: string | null,
  endAt: string | null,
  rangeStart: string,
  rangeEnd: string
) {
  const normalizedStart = toDateKey(startAt)
  const normalizedEnd = toDateKey(endAt)

  if (!normalizedStart && !normalizedEnd) return false

  const intervalStart = normalizedStart ?? normalizedEnd
  const intervalEnd = normalizedEnd ?? normalizedStart

  if (!intervalStart || !intervalEnd) return false

  const safeStart = intervalStart <= intervalEnd ? intervalStart : intervalEnd
  const safeEnd = intervalStart <= intervalEnd ? intervalEnd : intervalStart

  return safeStart <= rangeEnd && safeEnd >= rangeStart
}

export function jobOverlapsDay(
  startAt: string | null,
  endAt: string | null,
  day: string
) {
  return jobOverlapsRange(startAt, endAt, day, day)
}
