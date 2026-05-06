import { useFocusEffect, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { useAppSession } from '../../../contexts/AppSessionContext'
import { supabase } from '../../../lib/supabase'

type AssignmentWithJob = {
  id: string
  job_id: string | null
  profile_id: string | null
  work_started_at: string | null
  work_completed_at: string | null
  jobs:
    | {
        id: string
        company_id: string | null
        title: string | null
        status: string | null
        address: string | null
        start_at: string | null
        end_at: string | null
      }
    | {
        id: string
        company_id: string | null
        title: string | null
        status: string | null
        address: string | null
        start_at: string | null
        end_at: string | null
      }[]
    | null
}

type WaitingCheckJob = {
  id: string
  company_id: string | null
  title: string | null
  status: string | null
  address: string | null
  start_at: string | null
  end_at: string | null
}

type ProfileJoin =
  | {
      id: string
      full_name: string | null
      auth_user_id: string | null
    }
  | {
      id: string
      full_name: string | null
      auth_user_id: string | null
    }[]
  | null

type ActiveShiftRow = {
  id: string
  profile_id: string
  company_id: string | null
  started_at: string | null
  ended_at: string | null
  note: string | null
  profiles?: ProfileJoin
}

type JobRow = {
  id: string
  company_id: string | null
  title: string | null
  status: 'in_progress' | 'waiting_check' | string
  address: string | null
  start_at: string | null
  end_at: string | null
  activeWorkers: number
  totalWorkers: number
}

type ActiveWorkerRow = {
  shiftId: string
  profileId: string
  workerLabel: string
  shiftStartedAt: string | null
  shiftNote: string | null
  activeJobId: string | null
  activeJobTitle: string | null
  activeJobAddress: string | null
  activeJobStartedAt: string | null
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

function getSingleJob(raw: AssignmentWithJob['jobs']) {
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw ?? null
}

function getSingleProfile(raw: ProfileJoin) {
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw ?? null
}

function getWorkerLabel(profile: ProfileJoin, profileId: string) {
  const item = getSingleProfile(profile)

  if (item?.full_name) return item.full_name
  if (item?.auth_user_id) return item.auth_user_id

  return `Profil ${profileId.slice(0, 8)}`
}

function shouldIncludeJobRow(row: AssignmentWithJob, companyId: string) {
  const job = getSingleJob(row.jobs)

  if (!job || job.company_id !== companyId || !job.id) {
    return { job: null, isActiveWorker: false, shouldInclude: false }
  }

  const isActiveWorker = !!row.work_started_at && !row.work_completed_at
  const shouldInclude = isActiveWorker || job.status === 'waiting_check'

  return { job, isActiveWorker, shouldInclude }
}

export default function KontrolaPraciScreen() {
  const router = useRouter()
  const { loading: sessionLoading, companyId, isAdmin, role, membership } = useAppSession()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [activeWorkers, setActiveWorkers] = useState<ActiveWorkerRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadJobs = useCallback(async () => {
    if (!isAdmin) {
      setJobs([])
      setActiveWorkers([])
      setLoading(false)
      setRefreshing(false)
      return
    }

    setError(null)

    try {
      const [assignmentResponse, waitingCheckResponse, activeShiftResponse] =
        await Promise.all([
          supabase
            .from('job_assignments')
            .select(`
              id,
              job_id,
              profile_id,
              work_started_at,
              work_completed_at,
              jobs!inner (
                id,
                company_id,
                title,
                status,
                address,
                start_at,
                end_at
              )
            `)
            .eq('jobs.company_id', companyId),
          supabase
            .from('jobs')
            .select('id, company_id, title, status, address, start_at, end_at')
            .eq('company_id', companyId)
            .eq('status', 'waiting_check')
            .order('start_at', { ascending: false }),
          supabase
            .from('work_shifts')
            .select(`
              id,
              profile_id,
              company_id,
              started_at,
              ended_at,
              note,
              profiles (
                id,
                full_name,
                auth_user_id
              )
            `)
            .eq('company_id', companyId)
            .is('ended_at', null)
            .order('started_at', { ascending: false }),
        ])

      if (assignmentResponse.error) {
        throw assignmentResponse.error
      }

      if (waitingCheckResponse.error) {
        throw waitingCheckResponse.error
      }

      if (activeShiftResponse.error) {
        throw activeShiftResponse.error
      }

      const assignmentData = (assignmentResponse.data ?? []) as AssignmentWithJob[]
      const waitingCheckJobs = (waitingCheckResponse.data ?? []) as WaitingCheckJob[]
      const activeShiftRows = (activeShiftResponse.data ?? []) as ActiveShiftRow[]

      const jobMap = new Map<string, JobRow>()

      for (const row of assignmentData) {
        const { job, isActiveWorker, shouldInclude } = shouldIncludeJobRow(row, companyId)

        if (!job || !shouldInclude) continue

        const existing = jobMap.get(job.id)

        if (!existing) {
          jobMap.set(job.id, {
            id: job.id,
            company_id: job.company_id,
            title: job.title,
            status: isActiveWorker ? 'in_progress' : 'waiting_check',
            address: job.address,
            start_at: job.start_at,
            end_at: job.end_at,
            activeWorkers: isActiveWorker ? 1 : 0,
            totalWorkers: 1,
          })
        } else {
          existing.totalWorkers += 1

          if (isActiveWorker) {
            existing.activeWorkers += 1
            existing.status = 'in_progress'
          } else if (existing.activeWorkers === 0) {
            existing.status = 'waiting_check'
          }
        }
      }

      for (const job of waitingCheckJobs) {
        if (!job.id) continue

        const existing = jobMap.get(job.id)

        if (!existing) {
          jobMap.set(job.id, {
            id: job.id,
            company_id: job.company_id,
            title: job.title,
            status: 'waiting_check',
            address: job.address,
            start_at: job.start_at,
            end_at: job.end_at,
            activeWorkers: 0,
            totalWorkers: 0,
          })
        }
      }

      const mergedJobs = Array.from(jobMap.values()).sort((a, b) => {
        const aTime = a.start_at ? new Date(a.start_at).getTime() : 0
        const bTime = b.start_at ? new Date(b.start_at).getTime() : 0
        return bTime - aTime
      })

      const activeAssignmentByProfile = new Map<string, AssignmentWithJob>()

      for (const row of assignmentData) {
        if (!row.profile_id) continue
        if (!row.work_started_at || row.work_completed_at) continue

        const existing = activeAssignmentByProfile.get(row.profile_id)
        const currentTs = row.work_started_at ? new Date(row.work_started_at).getTime() : 0
        const existingTs =
          existing?.work_started_at ? new Date(existing.work_started_at).getTime() : 0

        if (!existing || currentTs >= existingTs) {
          activeAssignmentByProfile.set(row.profile_id, row)
        }
      }

      const nextActiveWorkers = activeShiftRows.map((shift) => {
        const activeAssignment = activeAssignmentByProfile.get(shift.profile_id)
        const activeJob = getSingleJob(activeAssignment?.jobs ?? null)

        return {
          shiftId: shift.id,
          profileId: shift.profile_id,
          workerLabel: getWorkerLabel(shift.profiles ?? null, shift.profile_id),
          shiftStartedAt: shift.started_at ?? null,
          shiftNote: shift.note ?? null,
          activeJobId: activeJob?.id ?? null,
          activeJobTitle: activeJob?.title ?? null,
          activeJobAddress: activeJob?.address ?? null,
          activeJobStartedAt: activeAssignment?.work_started_at ?? null,
        }
      })

      setJobs(mergedJobs)
      setActiveWorkers(nextActiveWorkers)
    } catch (err: any) {
      console.error('KONTROLA_PRACI_LOAD_JOBS_ERROR', err)
      setError(err?.message ?? 'Nepodařilo se načíst zakázky.')
      setJobs([])
      setActiveWorkers([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [companyId, isAdmin])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  useFocusEffect(
    useCallback(() => {
      loadJobs()
    }, [loadJobs])
  )

  const counts = useMemo(() => {
    const inProgress = jobs.filter((job) => job.status === 'in_progress').length
    const waitingCheck = jobs.filter((job) => job.status === 'waiting_check').length
    const activeShifts = activeWorkers.length

    return { inProgress, waitingCheck, activeShifts }
  }, [jobs, activeWorkers])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    loadJobs()
  }, [loadJobs])

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
            Načítám kontrolu prací...
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
            Tato sekce je dostupná pouze pro admin účty.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text
          style={{
            fontSize: 28,
            fontWeight: '800',
            color: '#0f172a',
            marginBottom: 8,
          }}
        >
          Kontrola prací
        </Text>

        <Text
          style={{
            fontSize: 15,
            color: '#475569',
            lineHeight: 22,
            marginBottom: 8,
          }}
        >
          Přehled pracovníků se zapnutou směnou a zakázek, které právě běží nebo čekají na kontrolu.
        </Text>

        <Text
          style={{
            fontSize: 13,
            color: '#64748b',
            marginBottom: 16,
          }}
        >
          Role: {role ?? '—'} | Company: {membership?.company_id ?? companyId}
        </Text>

        <View
          style={{
            flexDirection: 'row',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: '#ffffff',
              borderRadius: 14,
              padding: 14,
              borderWidth: 1,
              borderColor: '#e2e8f0',
            }}
          >
            <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>
              Aktivní směny
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#0f172a' }}>
              {counts.activeShifts}
            </Text>
          </View>

          <View
            style={{
              flex: 1,
              backgroundColor: '#ffffff',
              borderRadius: 14,
              padding: 14,
              borderWidth: 1,
              borderColor: '#e2e8f0',
            }}
          >
            <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>
              Probíhá
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#2563eb' }}>
              {counts.inProgress}
            </Text>
          </View>

          <View
            style={{
              flex: 1,
              backgroundColor: '#ffffff',
              borderRadius: 14,
              padding: 14,
              borderWidth: 1,
              borderColor: '#e2e8f0',
            }}
          >
            <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>
              Čeká na kontrolu
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: '#d97706' }}>
              {counts.waitingCheck}
            </Text>
          </View>
        </View>

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

        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: '#0f172a',
              marginBottom: 10,
            }}
          >
            Aktivní směny
          </Text>

          {activeWorkers.length === 0 ? (
            <Text
              style={{
                fontSize: 14,
                color: '#475569',
                lineHeight: 21,
              }}
            >
              Aktuálně nikdo nemá zapnutou směnu.
            </Text>
          ) : (
            <View style={{ gap: 12 }}>
              {activeWorkers.map((item) => (
                <View
                  key={item.shiftId}
                  style={{
                    backgroundColor: '#f8fafc',
                    borderRadius: 14,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: '#e2e8f0',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: '700',
                      color: '#0f172a',
                      marginBottom: 6,
                    }}
                  >
                    {item.workerLabel}
                  </Text>

                  <Text style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>
                    Směna od: {formatDateTime(item.shiftStartedAt)}
                  </Text>

                  <Text style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>
                    Zakázka:{' '}
                    <Text style={{ fontWeight: '700', color: '#0f172a' }}>
                      {item.activeJobTitle ?? 'Momentálně není rozpracovaná zakázka'}
                    </Text>
                  </Text>

                  {item.activeJobAddress ? (
                    <Text style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>
                      Adresa: {item.activeJobAddress}
                    </Text>
                  ) : null}

                  {item.activeJobStartedAt ? (
                    <Text style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>
                      Práce na zakázce od: {formatDateTime(item.activeJobStartedAt)}
                    </Text>
                  ) : null}

                  {item.shiftNote ? (
                    <Text style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
                      Poznámka ke směně: {item.shiftNote}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>

        {jobs.length === 0 ? (
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 18,
              borderWidth: 1,
              borderColor: '#e2e8f0',
              marginBottom: 12,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a' }}>
              Žádné aktivní kontroly
            </Text>
            <Text
              style={{
                marginTop: 8,
                fontSize: 14,
                color: '#475569',
                lineHeight: 21,
              }}
            >
              Aktuálně není žádná zakázka v běhu ani čekající na kontrolu.
            </Text>
          </View>
        ) : null}

        {jobs.map((job) => (
          <View
            key={job.id}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: '#e2e8f0',
              marginBottom: 12,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
                marginBottom: 10,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 17,
                    fontWeight: '700',
                    color: '#0f172a',
                    marginBottom: 6,
                  }}
                >
                  {job.title || 'Bez názvu zakázky'}
                </Text>

                <Text style={{ fontSize: 13, color: '#64748b', lineHeight: 19 }}>
                  {job.address || 'Bez adresy'}
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: `${getStatusColor(job.status)}15`,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
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
            </View>

            <Text style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>
              Začátek: {formatDateTime(job.start_at)}
            </Text>

            <Text style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>
              Konec: {formatDateTime(job.end_at)}
            </Text>

            <Text style={{ fontSize: 13, color: '#475569', marginBottom: 14 }}>
              Aktivní pracovníci: {job.activeWorkers} / Celkem přiřazení: {job.totalWorkers}
            </Text>

            <Pressable
              onPress={() => router.push(`/(tabs)/kontrola-praci/${job.id}` as any)}
              style={{
                backgroundColor: '#2563eb',
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 15 }}>
                Detail
              </Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}
