import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    Pressable,
    SafeAreaView,
    ScrollView,
    Text,
    View,
} from 'react-native'
import { JobPhotoSection } from '../../../components/job-photos/JobPhotoSection'
import { useAppSession } from '../../../contexts/AppSessionContext'
import { supabase } from '../../../lib/supabase'

type JobDetail = {
  id: string
  company_id: string | null
  title: string | null
  description: string | null
  status: string
  address: string | null
  start_at: string | null
  end_at: string | null
}

type AssignmentRow = {
  id: string
  job_id: string
  profile_id: string | null
  work_started_at: string | null
  work_completed_at: string | null
  labor_hours: number | string | null
  hourly_rate: number | string | null
  profiles?: ProfileRow | null
}

type ProfileRow = {
  id: string
  full_name: string | null
  email?: string | null
  auth_user_id?: string | null
  default_hourly_rate?: number | string | null
}

type ChecklistItemView = {
  id: string
  label: string
  isCompleted: boolean
  raw: Record<string, any>
}

function formatDateTime(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 0
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 2,
  }).format(value)
}

function getEffectiveHourlyRate(item: AssignmentRow) {
  const assignmentRate = toNumber(item.hourly_rate)

  if (assignmentRate > 0) {
    return assignmentRate
  }

  return toNumber(item.profiles?.default_hourly_rate)
}

function diffHours(startValue: string | null, endValue: string | null) {
  if (!startValue) return 0

  const start = new Date(startValue)
  const end = endValue ? new Date(endValue) : new Date()

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0

  const diffMs = end.getTime() - start.getTime()

  if (diffMs <= 0) return 0

  return diffMs / 1000 / 60 / 60
}

function formatHours(hours: number) {
  return `${hours.toFixed(2)} h`
}

function getProfile(item: AssignmentRow) {
  return item.profiles ?? null
}

function getChecklistLabel(item: Record<string, any>, index: number) {
  return (
    item.title ??
    item.label ??
    item.text ??
    item.name ??
    item.item_title ??
    item.description ??
    `Položka ${index + 1}`
  )
}

function getChecklistCompleted(item: Record<string, any>) {
  if (typeof item.is_completed === 'boolean') return item.is_completed
  if (typeof item.is_done === 'boolean') return item.is_done
  if (typeof item.completed === 'boolean') return item.completed
  return false
}

function sortChecklist(a: Record<string, any>, b: Record<string, any>) {
  const aOrder = a.sort_order ?? a.order_index ?? a.item_order ?? 0
  const bOrder = b.sort_order ?? b.order_index ?? b.item_order ?? 0
  return aOrder - bOrder
}

function getStatusLabel(status: string) {
  if (status === 'in_progress') return 'Probíhá'
  if (status === 'waiting_check') return 'Čeká na kontrolu'
  if (status === 'done') return 'Hotovo'
  return status
}

function getStatusColor(status: string) {
  if (status === 'in_progress') return '#2563eb'
  if (status === 'waiting_check') return '#d97706'
  if (status === 'done') return '#16a34a'
  return '#6b7280'
}

export default function KontrolaPraciDetailScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ jobId?: string }>()
  const jobId = Array.isArray(params.jobId) ? params.jobId[0] : params.jobId

  console.log('KONTROLA_PRACI_DETAIL_JOB_ID', jobId)

  const { loading: sessionLoading, companyId, profileId, isAdmin, syncTick } = useAppSession()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [job, setJob] = useState<JobDetail | null>(null)
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [checklistItems, setChecklistItems] = useState<ChecklistItemView[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadDetail = useCallback(async () => {
    if (!jobId) {
      setError('Chybí ID zakázky.')
      setLoading(false)
      return
    }

    if (!isAdmin) {
      setError('Nemáte přístup.')
      setLoading(false)
      return
    }

    setError(null)

    try {
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select('id, company_id, title, description, status, address, start_at, end_at')
        .eq('id', jobId)
        .eq('company_id', companyId)
        .single()

      if (jobError) {
        throw jobError
      }

      const { data: assignmentData, error: assignmentError } = await supabase
        .from('job_assignments')
        .select(`
          id,
          job_id,
          profile_id,
          work_started_at,
          work_completed_at,
          labor_hours,
          hourly_rate
        `)
        .eq('job_id', jobId)
        .order('work_started_at', { ascending: true })

      if (assignmentError) {
        throw assignmentError
      }

      const nextAssignments = (assignmentData ?? []) as AssignmentRow[]
      const profileIds = Array.from(
        new Set(nextAssignments.map((item) => item.profile_id).filter(Boolean))
      ) as string[]

      const profileMap = new Map<string, ProfileRow>()

      if (profileIds.length > 0) {
        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, auth_user_id, default_hourly_rate')
          .in('id', profileIds)

        if (profileError) {
          console.error('KONTROLA_PRACI_PROFILE_LOAD_ERROR', profileError)
        } else {
          for (const profile of profileRows ?? []) {
            profileMap.set(profile.id, {
              id: profile.id,
              full_name: profile.full_name,
              email: profile.auth_user_id ?? null,
              auth_user_id: profile.auth_user_id ?? null,
              default_hourly_rate: profile.default_hourly_rate ?? null,
            })
          }
        }
      }

      const { data: checklistRows, error: checklistError } = await supabase
        .from('job_checklists')
        .select('id')
        .eq('job_id', jobId)

      if (checklistError) {
        console.error('KONTROLA_PRACI_CHECKLIST_LOAD_ERROR', checklistError)
      }

      const checklistIds = checklistError ? [] : checklistRows?.map((row: any) => row.id) ?? []
      let nextChecklistItems: ChecklistItemView[] = []

      if (checklistIds.length > 0) {
        const { data: itemRows, error: itemError } = await supabase
          .from('job_checklist_items')
          .select('*')
          .in('checklist_id', checklistIds)

        if (itemError) {
          console.error('KONTROLA_PRACI_CHECKLIST_ITEMS_LOAD_ERROR', itemError)
        } else {
          nextChecklistItems = ((itemRows ?? []) as Record<string, any>[])
            .sort(sortChecklist)
            .map((item, index) => ({
              id: item.id,
              label: getChecklistLabel(item, index),
              isCompleted: getChecklistCompleted(item),
              raw: item,
            }))
        }
      }

      setJob(jobData as JobDetail)
      setAssignments(
        nextAssignments.map((item) => ({
          ...item,
          profiles: item.profile_id ? profileMap.get(item.profile_id) ?? null : null,
        }))
      )
      setChecklistItems(nextChecklistItems)
    } catch (err: any) {
      console.error('KONTROLA_PRACI_LOAD_DETAIL_ERROR', err)
      setError(err?.message ?? 'Nepodařilo se načíst detail zakázky.')
    } finally {
      setLoading(false)
      setSaving(false)
    }
  }, [companyId, isAdmin, jobId])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const assignmentRows = useMemo(() => {
    return assignments.map((item) => {
      const profile = getProfile(item)

      const trackedHours =
        toNumber(item.labor_hours) > 0
          ? toNumber(item.labor_hours)
          : diffHours(item.work_started_at, item.work_completed_at)

      const isRunning = !!item.work_started_at && !item.work_completed_at
      const hourlyRate = getEffectiveHourlyRate(item)

      return {
        ...item,
        profileName:
          profile?.full_name ||
          profile?.email ||
          profile?.auth_user_id ||
          (item.profile_id ? `Profil ${item.profile_id.slice(0, 8)}` : 'Neznámý pracovník'),
        trackedHours,
        hourlyRate,
        payAmount: trackedHours * hourlyRate,
        isRunning,
      }
    })
  }, [assignments])

  const totalHours = useMemo(() => {
    return assignmentRows.reduce((sum, row) => sum + row.trackedHours, 0)
  }, [assignmentRows])

  const totalPay = useMemo(() => {
    return assignmentRows.reduce((sum, row) => sum + row.payAmount, 0)
  }, [assignmentRows])

  const updateJobStatus = useCallback(
    async (nextStatus: 'in_progress' | 'done') => {
      if (!jobId) return

      setSaving(true)

      try {
        const payload: Record<string, any> = {
          status: nextStatus,
        }

        if (nextStatus === 'done') {
          payload.end_at = new Date().toISOString()
        }

        const { error: updateError } = await supabase
          .from('jobs')
          .update(payload)
          .eq('id', jobId)
          .eq('company_id', companyId)

        if (updateError) {
          throw updateError
        }

        Alert.alert(
          'Hotovo',
          nextStatus === 'done'
            ? 'Zakázka byla označena jako hotová.'
            : 'Zakázka byla vrácena do práce.'
        )

        await loadDetail()
      } catch (err: any) {
        setSaving(false)
        Alert.alert('Chyba', err?.message ?? 'Nepodařilo se upravit stav zakázky.')
      }
    },
    [jobId, companyId, loadDetail]
  )

  const emergencyCompleteAssignment = useCallback(
    async (assignmentId: string) => {
      setSaving(true)

      try {
        const nowIso = new Date().toISOString()

        const { error: updateError } = await supabase
          .from('job_assignments')
          .update({
            work_completed_at: nowIso,
          })
          .eq('id', assignmentId)

        if (updateError) {
          throw updateError
        }

        Alert.alert('Hotovo', 'Práce pracovníka byla nouzově ukončena.')
        await loadDetail()
      } catch (err: any) {
        setSaving(false)
        Alert.alert('Chyba', err?.message ?? 'Nepodařilo se ukončit práci.')
      }
    },
    [loadDetail]
  )

  if (sessionLoading || loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 12, fontSize: 15, color: '#475569' }}>
            Načítám detail...
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        <View
          style={{
            flex: 1,
            padding: 20,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontSize: 22,
              fontWeight: '700',
              color: '#0f172a',
              marginBottom: 12,
              textAlign: 'center',
            }}
          >
            Nemáte přístup
          </Text>

          <Text
            style={{
              fontSize: 15,
              color: '#475569',
              textAlign: 'center',
              lineHeight: 22,
            }}
          >
            Detail kontroly prací je dostupný pouze pro admin účty.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!job) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        <View style={{ flex: 1, padding: 20 }}>
          <Pressable
            onPress={() => router.back()}
            style={{
              alignSelf: 'flex-start',
              marginBottom: 16,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: '#e2e8f0',
            }}
          >
            <Text style={{ color: '#0f172a', fontWeight: '700' }}>Zpět</Text>
          </Pressable>

          <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f172a' }}>
            Zakázka nebyla nalezena
          </Text>

          {error ? (
            <Text style={{ marginTop: 10, color: '#991b1b', fontSize: 14 }}>
              {error}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Pressable
          onPress={() => router.back()}
          style={{
            alignSelf: 'flex-start',
            marginBottom: 16,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 12,
            backgroundColor: '#e2e8f0',
          }}
        >
          <Text style={{ color: '#0f172a', fontWeight: '700' }}>Zpět</Text>
        </Pressable>

        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            marginBottom: 14,
          }}
        >
          <Text
            style={{
              fontSize: 24,
              fontWeight: '800',
              color: '#0f172a',
              marginBottom: 8,
            }}
          >
            {job.title || 'Bez názvu zakázky'}
          </Text>

          <View
            style={{
              alignSelf: 'flex-start',
              backgroundColor: `${getStatusColor(job.status)}15`,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 6,
              marginBottom: 12,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '700',
                color: getStatusColor(job.status),
              }}
            >
              {getStatusLabel(job.status)}
            </Text>
          </View>

          <Text style={{ fontSize: 14, color: '#475569', marginBottom: 6 }}>
            Adresa: {job.address || '—'}
          </Text>

          <Text style={{ fontSize: 14, color: '#475569', marginBottom: 6 }}>
            Začátek zakázky: {formatDateTime(job.start_at)}
          </Text>

          <Text style={{ fontSize: 14, color: '#475569', marginBottom: 12 }}>
            Konec zakázky: {formatDateTime(job.end_at)}
          </Text>

          <View
            style={{
              backgroundColor: '#f8fafc',
              borderRadius: 12,
              padding: 12,
              borderWidth: 1,
              borderColor: '#e2e8f0',
              marginBottom: 12,
            }}
          >
            <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>
              Instrukce od admina
            </Text>
            <Text style={{ fontSize: 15, color: '#0f172a', lineHeight: 22 }}>
              {job.description?.trim()
                ? job.description
                : 'K této zakázce zatím nejsou zadané žádné instrukce.'}
            </Text>
          </View>

          <View
            style={{
              backgroundColor: '#f8fafc',
              borderRadius: 12,
              padding: 12,
              borderWidth: 1,
              borderColor: '#e2e8f0',
            }}
          >
            <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>
              Celkové hodiny
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#0f172a' }}>
              {formatHours(totalHours)}
            </Text>
            <Text style={{ marginTop: 8, fontSize: 14, color: '#475569' }}>
              Odměna celkem: {formatMoney(totalPay)}
            </Text>
          </View>
        </View>

        <JobPhotoSection
          companyId={companyId}
          jobId={job.id}
          uploadedByProfileId={profileId}
          syncTick={syncTick}
        />

        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            marginBottom: 14,
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: '#0f172a',
              marginBottom: 14,
            }}
          >
            Checklist
          </Text>

          {checklistItems.length === 0 ? (
            <Text style={{ fontSize: 14, color: '#475569' }}>
              K této zakázce zatím není checklist.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {checklistItems.map((item, index) => (
                <View
                  key={item.id}
                  style={{
                    borderWidth: 1,
                    borderColor: item.isCompleted ? '#86efac' : '#e2e8f0',
                    borderRadius: 12,
                    padding: 12,
                    backgroundColor: item.isCompleted ? '#ecfdf5' : '#f8fafc',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '700',
                      color: '#0f172a',
                      textDecorationLine: item.isCompleted ? 'line-through' : 'none',
                    }}
                  >
                    {index + 1}. {item.label}
                  </Text>
                  <Text
                    style={{
                      marginTop: 4,
                      fontSize: 13,
                      color: item.isCompleted ? '#166534' : '#64748b',
                    }}
                  >
                    {item.isCompleted ? 'Splněno' : 'Čeká'}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            marginBottom: 14,
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: '#0f172a',
              marginBottom: 14,
            }}
          >
            Akce
          </Text>

          <Pressable
            disabled={saving}
            onPress={() => updateJobStatus('in_progress')}
            style={{
              backgroundColor: saving ? '#93c5fd' : '#2563eb',
              borderRadius: 12,
              paddingVertical: 13,
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 15 }}>
              Vrátit do práce
            </Text>
          </Pressable>

          <Pressable
            disabled={saving}
            onPress={() => updateJobStatus('done')}
            style={{
              backgroundColor: saving ? '#86efac' : '#16a34a',
              borderRadius: 12,
              paddingVertical: 13,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 15 }}>
              Označit jako hotovo
            </Text>
          </Pressable>
        </View>

        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: '#e2e8f0',
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: '#0f172a',
              marginBottom: 14,
            }}
          >
            Pracovníci a časy
          </Text>

          {error ? (
            <View
              style={{
                backgroundColor: '#fef2f2',
                borderWidth: 1,
                borderColor: '#fecaca',
                borderRadius: 14,
                padding: 14,
                marginBottom: 16,
              }}
            >
              <Text style={{ color: '#991b1b', fontSize: 14 }}>{error}</Text>
            </View>
          ) : null}

          {assignmentRows.length === 0 ? (
            <Text style={{ fontSize: 14, color: '#475569' }}>
              U této zakázky zatím nejsou žádné záznamy pracovníků.
            </Text>
          ) : null}

          {assignmentRows.map((item) => (
            <View
              key={item.id}
              style={{
                borderWidth: 1,
                borderColor: '#e2e8f0',
                borderRadius: 14,
                padding: 14,
                marginBottom: 12,
                backgroundColor: '#f8fafc',
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '700',
                  color: '#0f172a',
                  marginBottom: 8,
                }}
              >
                {item.profileName}
              </Text>

              <Text style={{ fontSize: 14, color: '#475569', marginBottom: 4 }}>
                Začal: {formatDateTime(item.work_started_at)}
              </Text>

              <Text style={{ fontSize: 14, color: '#475569', marginBottom: 4 }}>
                Dokončil: {formatDateTime(item.work_completed_at)}
              </Text>

              <Text style={{ fontSize: 14, color: '#475569', marginBottom: 4 }}>
                Hodiny: {formatHours(item.trackedHours)}
              </Text>

              <Text style={{ fontSize: 14, color: '#475569', marginBottom: 4 }}>
                Sazba: {formatMoney(item.hourlyRate)} / h
              </Text>

              <Text style={{ fontSize: 14, color: '#475569', marginBottom: 4 }}>
                Odměna: {formatMoney(item.payAmount)}
              </Text>

              <Text
                style={{
                  fontSize: 14,
                  color: item.isRunning ? '#b91c1c' : '#166534',
                  marginBottom: 10,
                }}
              >
                Stav pracovníka: {item.isRunning ? 'Práce stále běží' : 'Práce ukončena'}
              </Text>

              {item.isRunning ? (
                <Pressable
                  disabled={saving}
                  onPress={() => emergencyCompleteAssignment(item.id)}
                  style={{
                    backgroundColor: saving ? '#fca5a5' : '#dc2626',
                    borderRadius: 12,
                    paddingVertical: 12,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 15 }}>
                    Ukončit práci
                  </Text>
                </Pressable>
              ) : (
                <View
                  style={{
                    backgroundColor: '#e2e8f0',
                    borderRadius: 12,
                    paddingVertical: 12,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#475569', fontWeight: '700', fontSize: 14 }}>
                    Práce už je ukončená
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
