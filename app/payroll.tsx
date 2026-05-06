import { useRouter } from 'expo-router'
import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  Text,
  Pressable,
  TextInput,
  View,
} from 'react-native'
import { useAppSession } from '../contexts/AppSessionContext'
import { supabase } from '../lib/supabase'

type WorkShiftRow = {
  id: string
  company_id: string | null
  profile_id: string
  job_id: string | null
  shift_date: string | null
  started_at: string | null
  ended_at: string | null
  hours_override: number | string | null
}

type WorkerAdvanceRow = {
  id: string
  profile_id: string
  amount: number | string
  issued_at: string
  note: string | null
}

type ProfileRow = {
  id: string
  default_hourly_rate: number | string | null
}

type ShiftDisplayRow = {
  id: string
  shiftDate: string
  startedAt: string | null
  endedAt: string | null
  hours: number
  amount: number
}

type DayGroup = {
  date: string
  totalHours: number
  totalAmount: number
  shifts: ShiftDisplayRow[]
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatHours(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`)

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatDateTime(value: string) {
  const date = new Date(value)

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatTimeOnly(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatTimeRange(startedAt: string | null, endedAt: string | null) {
  const start = formatTimeOnly(startedAt)
  const end = endedAt ? formatTimeOnly(endedAt) : 'běží'
  return `${start} – ${end}`
}

function formatMonthTitle(date: Date) {
  return new Intl.DateTimeFormat('cs-CZ', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function formatLocalDateOnly(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getMonthRange(baseDate: Date) {
  const year = baseDate.getFullYear()
  const month = baseDate.getMonth()

  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 1)

  return {
    startDate: formatLocalDateOnly(start),
    endDate: formatLocalDateOnly(end),
    monthTitle: formatMonthTitle(start),
  }
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function getAdvanceWindowForPayrollMonth(startDate: string) {
  const payrollMonthStart = new Date(`${startDate}T00:00:00`)

  const advanceStart = new Date(
    payrollMonthStart.getFullYear(),
    payrollMonthStart.getMonth(),
    19
  )

  const advanceEndExclusive = new Date(
    payrollMonthStart.getFullYear(),
    payrollMonthStart.getMonth() + 1,
    18
  )

  return {
    advanceStartDate: formatLocalDateOnly(advanceStart),
    advanceEndExclusiveDate: formatLocalDateOnly(advanceEndExclusive),
  }
}

function getAdvanceWindowLabelEnd(advanceEndExclusiveDate: string) {
  const endExclusive = new Date(`${advanceEndExclusiveDate}T00:00:00`)
  const inclusiveEnd = new Date(endExclusive)
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1)
  return formatLocalDateOnly(inclusiveEnd)
}

function getDiffHours(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return 0

  const start = new Date(startedAt)
  const end = new Date(endedAt)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0

  const diffMs = end.getTime() - start.getTime()
  if (diffMs <= 0) return 0

  return diffMs / (1000 * 60 * 60)
}

function getEffectiveShiftHours(row: WorkShiftRow) {
  const override = toNumber(row.hours_override)
  if (override > 0) return override

  return getDiffHours(row.started_at, row.ended_at)
}

function getShiftDate(row: WorkShiftRow) {
  if (row.shift_date) return row.shift_date

  if (row.started_at) {
    const date = new Date(row.started_at)
    if (!Number.isNaN(date.getTime())) return formatLocalDateOnly(date)
  }

  return null
}

export default function PayrollScreen() {
  const router = useRouter()
  const { profileId, companyId } = useAppSession()

  const [selectedMonthDate, setSelectedMonthDate] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [shiftRows, setShiftRows] = useState<WorkShiftRow[]>([])
  const [workerAdvances, setWorkerAdvances] = useState<WorkerAdvanceRow[]>([])
  const [defaultHourlyRate, setDefaultHourlyRate] = useState(0)
  const [advanceAmount, setAdvanceAmount] = useState('')
  const [advanceReason, setAdvanceReason] = useState('')
  const [sendingAdvanceRequest, setSendingAdvanceRequest] = useState(false)

  const { startDate, endDate, monthTitle } = useMemo(
    () => getMonthRange(selectedMonthDate),
    [selectedMonthDate]
  )

  const { advanceStartDate, advanceEndExclusiveDate } = useMemo(
    () => getAdvanceWindowForPayrollMonth(startDate),
    [startDate]
  )

  async function loadPayrollData() {
    if (!profileId || !companyId) {
      setShiftRows([])
      setWorkerAdvances([])
      setDefaultHourlyRate(0)
      setLoading(false)
      return
    }

    setLoading(true)

    const [shiftResponse, workerAdvancesResponse, profileResponse] = await Promise.all([
      supabase
        .from('work_shifts')
        .select(
          `
          id,
          company_id,
          profile_id,
          job_id,
          shift_date,
          started_at,
          ended_at,
          hours_override
        `
        )
        .eq('profile_id', profileId)
        .eq('company_id', companyId)
        .gte('shift_date', startDate)
        .lt('shift_date', endDate)
        .order('shift_date', { ascending: false })
        .order('started_at', { ascending: false }),

      supabase
        .from('worker_advances')
        .select(
          `
          id,
          profile_id,
          amount,
          issued_at,
          note
        `
        )
        .eq('profile_id', profileId)
        .gte('issued_at', `${advanceStartDate}T00:00:00`)
        .lt('issued_at', `${advanceEndExclusiveDate}T00:00:00`)
        .order('issued_at', { ascending: false }),

      supabase
        .from('profiles')
        .select(
          `
          id,
          default_hourly_rate
        `
        )
        .eq('id', profileId)
        .maybeSingle(),
    ])

    if (shiftResponse.error) {
      console.error('Chyba při načítání work_shifts:', shiftResponse.error)
    }

    if (workerAdvancesResponse.error) {
      console.error('Chyba při načítání worker_advances:', workerAdvancesResponse.error)
    }

    if (profileResponse.error) {
      console.error('Chyba při načítání profilu:', profileResponse.error)
    }

    const profileRow = (profileResponse.data as ProfileRow | null) ?? null

    setShiftRows((shiftResponse.data as WorkShiftRow[] | null) ?? [])
    setWorkerAdvances((workerAdvancesResponse.data as WorkerAdvanceRow[] | null) ?? [])
    setDefaultHourlyRate(toNumber(profileRow?.default_hourly_rate))
    setLoading(false)
  }

  useEffect(() => {
    loadPayrollData()
  }, [profileId, companyId, startDate, endDate, advanceStartDate, advanceEndExclusiveDate])

  async function submitAdvanceRequest() {
    if (!profileId || !companyId || sendingAdvanceRequest) {
      return
    }

    const parsedAmount = Number(advanceAmount.replace(',', '.'))

    if (!parsedAmount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Chyba', 'Zadej platnou částku zálohy.')
      return
    }

    setSendingAdvanceRequest(true)

    try {
      const { error } = await supabase.from('advance_requests').insert({
        company_id: companyId,
        profile_id: profileId,
        amount: parsedAmount,
        reason: advanceReason.trim() || null,
        payroll_month: startDate,
        status: 'pending',
        requested_at: new Date().toISOString(),
      })

      if (error) {
        throw error
      }

      setAdvanceAmount('')
      setAdvanceReason('')
      Alert.alert('Hotovo', 'Žádost o zálohu byla odeslána.')
    } catch (error: any) {
      console.error('ADVANCE_REQUEST_CREATE_ERROR', error)
      Alert.alert('Chyba', error?.message ?? 'Nepodařilo se odeslat žádost o zálohu.')
    } finally {
      setSendingAdvanceRequest(false)
    }
  }

  const shiftEntries = useMemo<ShiftDisplayRow[]>(() => {
    return shiftRows
      .map((row) => {
        const shiftDate = getShiftDate(row)
        if (!shiftDate) return null

        const hours = getEffectiveShiftHours(row)

        return {
          id: row.id,
          shiftDate,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          hours,
          amount: hours * defaultHourlyRate,
        }
      })
      .filter((row): row is ShiftDisplayRow => row !== null)
  }, [shiftRows, defaultHourlyRate])

  const summary = useMemo(() => {
    const totalHours = shiftEntries.reduce((sum, row) => sum + row.hours, 0)
    const shiftReward = shiftEntries.reduce((sum, row) => sum + row.amount, 0)
    const advances = workerAdvances.reduce((sum, advance) => sum + toNumber(advance.amount), 0)

    return {
      totalHours,
      shiftReward,
      advances,
      remainingToPay: shiftReward - advances,
    }
  }, [shiftEntries, workerAdvances])

  const dayGroups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, DayGroup>()

    for (const row of shiftEntries) {
      const existing = map.get(row.shiftDate) ?? {
        date: row.shiftDate,
        totalHours: 0,
        totalAmount: 0,
        shifts: [],
      }

      existing.totalHours += row.hours
      existing.totalAmount += row.amount
      existing.shifts.push(row)
      map.set(row.shiftDate, existing)
    }

    return Array.from(map.values())
      .map((group) => ({
        ...group,
        shifts: [...group.shifts].sort((a, b) => {
          const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0
          const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0
          return bTime - aTime
        }),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [shiftEntries])

  const advanceWindowLabelEnd = getAdvanceWindowLabelEnd(advanceEndExclusiveDate)

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 16,
          flexGrow: 1,
        }}
      >
        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 16 }}>
            Odměny a zálohy
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Pressable
              onPress={() => setSelectedMonthDate((prev) => addMonths(prev, -1))}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: '#f3f4f6',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827' }}>←</Text>
            </Pressable>

            <View
              style={{
                flex: 1,
                backgroundColor: '#f9fafb',
                borderRadius: 12,
                paddingVertical: 12,
                paddingHorizontal: 14,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 14, color: '#555' }}>Období</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', marginTop: 2 }}>
                {monthTitle}
              </Text>
            </View>

            <Pressable
              onPress={() => setSelectedMonthDate((prev) => addMonths(prev, 1))}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: '#f3f4f6',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827' }}>→</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => setSelectedMonthDate(new Date())}
            style={{
              marginTop: 12,
              alignSelf: 'center',
              backgroundColor: '#2563eb',
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Aktuální měsíc</Text>
          </Pressable>
        </View>

        {loading ? (
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 24,
              alignItems: 'center',
            }}
          >
            <ActivityIndicator size="large" />
            <Text style={{ marginTop: 12, fontSize: 14, color: '#555' }}>
              Načítám přehled směn...
            </Text>
          </View>
        ) : (
          <>
            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
                gap: 12,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Žádost o zálohu</Text>

              <Text style={{ fontSize: 14, color: '#555' }}>
                Potřebuješ-li zálohu, pošli žádost adminovi. Výplatní měsíc se vezme z právě
                zvoleného období.
              </Text>

              <View>
                <Text style={{ fontSize: 14, color: '#374151', marginBottom: 6 }}>Částka</Text>
                <TextInput
                  value={advanceAmount}
                  onChangeText={setAdvanceAmount}
                  keyboardType="numeric"
                  editable={!sendingAdvanceRequest}
                  placeholder="Např. 2000"
                  style={{
                    backgroundColor: '#f9fafb',
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#d1d5db',
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    color: '#111827',
                  }}
                />
              </View>

              <View>
                <Text style={{ fontSize: 14, color: '#374151', marginBottom: 6 }}>
                  Důvod
                </Text>
                <TextInput
                  value={advanceReason}
                  onChangeText={setAdvanceReason}
                  editable={!sendingAdvanceRequest}
                  placeholder="Krátká poznámka pro admina"
                  multiline
                  textAlignVertical="top"
                  style={{
                    minHeight: 88,
                    backgroundColor: '#f9fafb',
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#d1d5db',
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    color: '#111827',
                  }}
                />
              </View>

              <Pressable
                onPress={submitAdvanceRequest}
                disabled={sendingAdvanceRequest}
                style={{
                  backgroundColor: '#111827',
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: 'center',
                  opacity: sendingAdvanceRequest ? 0.6 : 1,
                }}
              >
                <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '700' }}>
                  {sendingAdvanceRequest ? 'Odesílám…' : 'Odeslat žádost o zálohu'}
                </Text>
              </Pressable>
            </View>

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
                gap: 12,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Souhrn za měsíc</Text>

              <View
                style={{
                  backgroundColor: '#f9fafb',
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <Text style={{ fontSize: 14, color: '#555' }}>Hodiny celkem ze směn</Text>
                <Text style={{ fontSize: 22, fontWeight: '700' }}>
                  {formatHours(summary.totalHours)} h
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: '#f9fafb',
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <Text style={{ fontSize: 14, color: '#555' }}>Odměna ze směn</Text>
                <Text style={{ fontSize: 22, fontWeight: '700' }}>
                  {formatMoney(summary.shiftReward)}
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: '#f9fafb',
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <Text style={{ fontSize: 14, color: '#555' }}>Vyplacené zálohy</Text>
                <Text style={{ fontSize: 22, fontWeight: '700' }}>
                  {formatMoney(summary.advances)}
                </Text>
                <Text style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                  Okno záloh: {formatDate(advanceStartDate)} – {formatDate(advanceWindowLabelEnd)}
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: '#ecfeff',
                  borderRadius: 12,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: '#a5f3fc',
                }}
              >
                <Text style={{ fontSize: 14, color: '#0f172a' }}>
                  Orientačně zbývá k vyplacení
                </Text>
                <Text style={{ fontSize: 24, fontWeight: '800', marginTop: 4 }}>
                  {formatMoney(summary.remainingToPay)}
                </Text>
              </View>
            </View>

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
                gap: 12,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Zálohy</Text>

              {workerAdvances.length === 0 ? (
                <Text style={{ fontSize: 14, color: '#666' }}>
                  V tomto období zatím nejsou žádné vyplacené zálohy.
                </Text>
              ) : (
                workerAdvances.map((advance) => (
                  <View
                    key={advance.id}
                    style={{
                      borderWidth: 1,
                      borderColor: '#e5e7eb',
                      borderRadius: 14,
                      padding: 14,
                      gap: 6,
                    }}
                  >
                    <Text style={{ fontSize: 18, fontWeight: '700' }}>
                      {formatMoney(toNumber(advance.amount))}
                    </Text>

                    <Text style={{ fontSize: 14, color: '#555' }}>
                      Vyplaceno: {formatDateTime(advance.issued_at)}
                    </Text>

                    {advance.note ? (
                      <Text style={{ fontSize: 14, color: '#555' }}>
                        Poznámka: {advance.note}
                      </Text>
                    ) : null}
                  </View>
                ))
              )}
            </View>

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
                gap: 12,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: '700' }}>Směny</Text>

              {dayGroups.length === 0 ? (
                <Text style={{ fontSize: 14, color: '#666' }}>
                  Za toto období zatím nejsou žádné směny.
                </Text>
              ) : (
                dayGroups.map((day) => (
                  <View
                    key={day.date}
                    style={{
                      borderWidth: 1,
                      borderColor: '#e5e7eb',
                      borderRadius: 14,
                      padding: 14,
                      gap: 10,
                    }}
                  >
                    <Text style={{ fontSize: 16, fontWeight: '700' }}>
                      {formatDate(day.date)}
                    </Text>

                    <Text style={{ fontSize: 14, color: '#555' }}>
                      Hodiny celkem: <Text style={{ fontWeight: '700' }}>{formatHours(day.totalHours)} h</Text>
                    </Text>

                    <Text style={{ fontSize: 14, color: '#555' }}>
                      Odměna celkem: <Text style={{ fontWeight: '700' }}>{formatMoney(day.totalAmount)}</Text>
                    </Text>

                    <View style={{ gap: 8 }}>
                      {day.shifts.map((shift) => (
                        <View
                          key={shift.id}
                          style={{
                            backgroundColor: '#f9fafb',
                            borderRadius: 12,
                            padding: 12,
                            gap: 4,
                          }}
                        >
                          <Text style={{ fontSize: 14, fontWeight: '700' }}>
                            Směna: {formatTimeRange(shift.startedAt, shift.endedAt)}
                          </Text>

                          <Text style={{ fontSize: 14, color: '#555' }}>
                            Hodiny: <Text style={{ fontWeight: '700' }}>{formatHours(shift.hours)} h</Text>
                          </Text>

                          <Text style={{ fontSize: 14, color: '#555' }}>
                            Odměna: <Text style={{ fontWeight: '700' }}>{formatMoney(shift.amount)}</Text>
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}

        <Pressable
          onPress={() => router.back()}
          style={{
            backgroundColor: '#111827',
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>Zpět</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}
