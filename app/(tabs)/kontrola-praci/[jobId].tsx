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
import { useAppSession } from '../../../contexts/AppSessionContext'
import { supabase } from '../../../lib/supabase'

type JobDetail = {
  id: string
  company_id: string | null
  title: string | null
  status: string
  address: string | null
  start_at: string | null
  end_at: string | null
}

type AssignmentRow = {
  id: string
  job_id: string
  profile_id: string
  work_started_at: string | null
  work_completed_at: string | null
  labor_hours: number | string | null
  hourly_rate: number | string | null
  profiles:
    | {
        id: string
        full_name: string | null
        email: string | null
      }
    | {
        id: string
        full_name: string | null
        email: string | null
      }[]
    | null
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
  if (Array.isArray(item.profiles)) {
    return item.profiles[0] ?? null
  }

  return item.profiles ?? null
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

  const { loading: sessionLoading, companyId, isAdmin } = useAppSession()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [job, setJob] = useState<JobDetail | null>(null)
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
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
        .select('id, company_id, title, status, address, start_at, end_at')
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
          hourly_rate,
          profiles (
            id,
            full_name,
            email
          )
        `)
        .eq('job_id', jobId)
        .order('work_started_at', { ascending: true })

      if (assignmentError) {
        throw assignmentError
      }

      setJob(jobData as JobDetail)
      setAssignments((assignmentData ?? []) as AssignmentRow[])
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

      return {
        ...item,
        profileName: profile?.full_name || profile?.email || 'Neznámý pracovník',
        trackedHours,
        isRunning,
      }
    })
  }, [assignments])

  const totalHours = useMemo(() => {
    return assignmentRows.reduce((sum, row) => sum + row.trackedHours, 0)
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
            }}
          >
            <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>
              Celkové hodiny
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#0f172a' }}>
              {formatHours(totalHours)}
            </Text>
          </View>
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