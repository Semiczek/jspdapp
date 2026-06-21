import NetInfo from '@react-native-community/netinfo'
import { router, useLocalSearchParams } from 'expo-router'
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
import { JobPhotoSection } from '../components/job-photos/JobPhotoSection'
import { useAppSession } from '../contexts/AppSessionContext'
import {
  OFFLINE_KEYS,
  addPendingAction,
  getQueueSummary,
  getCacheItem,
  resetFailedActionsToPending,
  setCacheItem,
  type QueueSummary,
} from '../lib/offline'
import { getAssignmentWorkState } from '../lib/assignmentWork'
import { supabase } from '../lib/supabase'
import { syncPendingActions } from '../lib/syncManager'

type JobRow = {
  id: string
  title: string | null
  description: string | null
  address: string | null
  status: string | null
  start_at: string | null
  end_at: string | null
  company_id: string | null
  customer_id?: string | null
}

type AssignmentRow = {
  id: string
  job_id: string
  profile_id: string
  work_started_at: string | null
  work_completed_at: string | null
}

type ChecklistItemView = {
  id: string
  label: string
  isCompleted: boolean
  raw: Record<string, any>
}

type CachedJobDetail = {
  job: JobRow | null
  assignment: AssignmentRow | null
}

type AssignmentWorkUpdates = Partial<Pick<AssignmentRow, 'work_started_at' | 'work_completed_at'>>

async function isOnline() {
  const state = await NetInfo.fetch()
  return !!state.isConnected
}

function formatDateTime(value: string | null) {
  if (!value) return 'Neuvedeno'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getMultiDayInfo(startAt: string | null, endAt: string | null) {
  if (!startAt || !endAt) return null

  const start = new Date(startAt)
  const end = new Date(endAt)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null

  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())

  const diffMs = endDay.getTime() - startDay.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1

  if (diffDays <= 1) return null

  return `Vícedenní zakázka (${diffDays} dnů)`
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

export default function JobDetailScreen() {
  const params = useLocalSearchParams<{ jobId?: string }>()
  const { loading: sessionLoading, user, profileId, companyId, syncTick } = useAppSession()

  const jobId = useMemo(() => {
    const raw = params.jobId
    if (!raw) return ''
    return Array.isArray(raw) ? raw[0] : raw
  }, [params.jobId])

  const [loadingData, setLoadingData] = useState(true)
  const [savingStart, setSavingStart] = useState(false)
  const [savingFinish, setSavingFinish] = useState(false)
  const [togglingChecklistId, setTogglingChecklistId] = useState<string | null>(null)

  const [job, setJob] = useState<JobRow | null>(null)
  const [assignment, setAssignment] = useState<AssignmentRow | null>(null)
  const [checklistItems, setChecklistItems] = useState<ChecklistItemView[]>([])
  const [offlineQueueSummary, setOfflineQueueSummary] = useState<QueueSummary>({
    total: 0,
    pending: 0,
    syncing: 0,
    failed: 0,
    latestFailedError: null,
    latestFailedRetryCount: 0,
  })
  const [manualSyncing, setManualSyncing] = useState(false)

  const cacheJobDetailKey = OFFLINE_KEYS.jobDetail(jobId)
  const cacheChecklistKey = OFFLINE_KEYS.jobChecklist(jobId)

  async function refreshOfflineQueueSummary() {
    const summary = await getQueueSummary()
    setOfflineQueueSummary(summary)
  }

  async function applyLocalAssignmentState(updates: AssignmentWorkUpdates) {
    if (!assignment) return

    const updatedAssignment: AssignmentRow = {
      ...assignment,
      ...updates,
    }

    setAssignment(updatedAssignment)
    await setCacheItem(cacheJobDetailKey, {
      job,
      assignment: updatedAssignment,
    })
  }

  const loadData = useCallback(async () => {
    if (!jobId || !profileId) {
      setLoadingData(false)
      return
    }

    setLoadingData(true)

    const online = await isOnline()

    if (!online) {
      const cachedDetail = await getCacheItem<CachedJobDetail>(cacheJobDetailKey)
      const cachedChecklist = await getCacheItem<ChecklistItemView[]>(cacheChecklistKey)

      setJob(cachedDetail?.job ?? null)
      setAssignment(cachedDetail?.assignment ?? null)
      setChecklistItems(cachedChecklist ?? [])
      setLoadingData(false)
      return
    }

    try {
      const jobResult = await supabase
        .from('jobs')
        .select(`
          id,
          title,
          description,
          address,
          status,
          start_at,
          end_at,
          company_id,
          customer_id
        `)
        .eq('id', jobId)
        .single()

      if (jobResult.error || !jobResult.data) {
        console.error('Chyba při načítání zakázky:', jobResult.error)

        const cachedDetail = await getCacheItem<CachedJobDetail>(cacheJobDetailKey)
        const cachedChecklist = await getCacheItem<ChecklistItemView[]>(cacheChecklistKey)

        setJob(cachedDetail?.job ?? null)
        setAssignment(cachedDetail?.assignment ?? null)
        setChecklistItems(cachedChecklist ?? [])
        setLoadingData(false)
        return
      }

      const loadedJob = jobResult.data as JobRow

      if (loadedJob.company_id && loadedJob.company_id !== companyId) {
        Alert.alert('Chyba', 'Tato zakázka nepatří do tvé firmy.')
        router.replace('/(tabs)')
        return
      }

      setJob(loadedJob)

      const assignmentResult = await supabase
        .from('job_assignments')
        .select('id, job_id, profile_id, work_started_at, work_completed_at')
        .eq('job_id', jobId)
        .eq('profile_id', profileId)
        .maybeSingle()

      let loadedAssignment: AssignmentRow | null = null

      if (assignmentResult.error) {
        console.error('Chyba při načítání přiřazení:', assignmentResult.error)
        loadedAssignment = null
        setAssignment(null)
      } else {
        loadedAssignment = (assignmentResult.data as AssignmentRow | null) ?? null
        setAssignment(loadedAssignment)
      }

      await setCacheItem(cacheJobDetailKey, {
        job: loadedJob,
        assignment: loadedAssignment,
      })

      const checklistResult = await supabase
        .from('job_checklist_items')
        .select('*, job_checklists!inner(job_id)')
        .eq('job_checklists.job_id', jobId)

      if (checklistResult.error) {
        console.error('Chyba při načítání checklistu:', checklistResult.error)

        const cachedChecklist = await getCacheItem<ChecklistItemView[]>(cacheChecklistKey)
        setChecklistItems(cachedChecklist ?? [])
      } else if (Array.isArray(checklistResult.data)) {
        const mapped = [...checklistResult.data]
          .sort(sortChecklist)
          .map((item: Record<string, any>, index: number) => ({
            id: String(item.id),
            label: getChecklistLabel(item, index),
            isCompleted: getChecklistCompleted(item),
            raw: item,
          }))

        setChecklistItems(mapped)
        await setCacheItem(cacheChecklistKey, mapped)
      } else {
        setChecklistItems([])
        await setCacheItem(cacheChecklistKey, [])
      }
    } finally {
      setLoadingData(false)
    }
  }, [jobId, profileId, companyId, cacheJobDetailKey, cacheChecklistKey])

  useEffect(() => {
    if (sessionLoading) return
    if (!user || !profileId) return

    refreshOfflineQueueSummary()
    loadData()
  }, [sessionLoading, user, profileId, loadData])

  useEffect(() => {
    if (!user || !profileId) return

    refreshOfflineQueueSummary()
    loadData()
  }, [syncTick])

  async function handleManualSync() {
    if (manualSyncing) return

    setManualSyncing(true)

    try {
      if (offlineQueueSummary.failed > 0) {
        await resetFailedActionsToPending()
      }

      await syncPendingActions()
      await refreshOfflineQueueSummary()
      await loadData()
    } finally {
      setManualSyncing(false)
    }
  }

  async function handleResetFailedActions() {
    await resetFailedActionsToPending()
    await refreshOfflineQueueSummary()
  }

  async function handleStartWork() {
    if (!assignment?.id) {
      Alert.alert('Chyba', 'K této zakázce nebylo nalezeno tvoje přiřazení.')
      return
    }

    if (!profileId) {
      Alert.alert('Chyba', 'Chybí profileId.')
      return
    }

    if (assignment.work_started_at) {
      Alert.alert('Info', 'Práce už byla zahájena.')
      return
    }

    setSavingStart(true)

    try {
      const now = new Date().toISOString()
      const online = await isOnline()

      if (!online) {
        await addPendingAction('start_job_work', {
          assignment_id: assignment.id,
          profile_id: profileId,
          started_at: now,
        })

        await applyLocalAssignmentState({
          work_started_at: now,
          work_completed_at: null,
        })

        await refreshOfflineQueueSummary()
        Alert.alert('Uloženo offline', 'Zahájení práce čeká na synchronizaci.')
        return
      }

      const result = await supabase
        .from('job_assignments')
        .update({
          work_started_at: now,
          work_completed_at: null,
        })
        .eq('id', assignment.id)
        .eq('profile_id', profileId)

      if (result.error) {
        Alert.alert('Chyba', result.error.message)
        return
      }

      await applyLocalAssignmentState({
        work_started_at: now,
        work_completed_at: null,
      })

      Alert.alert('Hotovo', 'Práce byla zahájena.')
    } finally {
      setSavingStart(false)
    }
  }

  async function handleFinishWork() {
    if (!assignment?.id) {
      Alert.alert('Chyba', 'K této zakázce nebylo nalezeno tvoje přiřazení.')
      return
    }

    if (!profileId) {
      Alert.alert('Chyba', 'Chybí profileId.')
      return
    }

    if (!assignment.work_started_at) {
      Alert.alert('Info', 'Nejdřív je potřeba práci zahájit.')
      return
    }

    if (assignment.work_completed_at) {
      Alert.alert('Info', 'Práce už byla dokončena.')
      return
    }

    setSavingFinish(true)

    try {
      const now = new Date().toISOString()
      const online = await isOnline()

      if (!online) {
        await addPendingAction('complete_job_work', {
          assignment_id: assignment.id,
          profile_id: profileId,
          completed_at: now,
        })

        await applyLocalAssignmentState({
          work_completed_at: now,
        })

        await refreshOfflineQueueSummary()
        Alert.alert('Uloženo offline', 'Dokončení práce čeká na synchronizaci.')
        return
      }

      const result = await supabase
        .from('job_assignments')
        .update({
          work_completed_at: now,
        })
        .eq('id', assignment.id)
        .eq('profile_id', profileId)

      if (result.error) {
        Alert.alert('Chyba', result.error.message)
        return
      }

      await applyLocalAssignmentState({
        work_completed_at: now,
      })

      Alert.alert('Hotovo', 'Práce byla dokončena.')
    } finally {
      setSavingFinish(false)
    }
  }

  async function toggleChecklistItem(item: ChecklistItemView) {
    const nextValue = !item.isCompleted
    setTogglingChecklistId(item.id)

    try {
      const online = await isOnline()

      if (!online) {
        const updatedItems = checklistItems.map((row) =>
          row.id === item.id
            ? {
                ...row,
                isCompleted: nextValue,
                raw: {
                  ...row.raw,
                  is_done: nextValue,
                  is_completed: nextValue,
                },
              }
            : row
        )

        setChecklistItems(updatedItems)
        await setCacheItem(cacheChecklistKey, updatedItems)

        await addPendingAction('toggle_checklist_item', {
          item_id: item.id,
          next_value: nextValue,
        })

        await refreshOfflineQueueSummary()
        Alert.alert('Uloženo offline', 'Checklist čeká na synchronizaci.')
        return
      }

      const result = await supabase
        .from('job_checklist_items')
        .update({
          is_done: nextValue,
        })
        .eq('id', item.id)

      if (result.error) {
        Alert.alert('Chyba', result.error.message)
        return
      }

      const updatedItems = checklistItems.map((row) =>
        row.id === item.id
          ? {
              ...row,
              isCompleted: nextValue,
              raw: {
                ...row.raw,
                is_done: nextValue,
                is_completed: nextValue,
              },
            }
          : row
      )

      setChecklistItems(updatedItems)
      await setCacheItem(cacheChecklistKey, updatedItems)
    } finally {
      setTogglingChecklistId(null)
    }
  }

  const multiDayInfo = useMemo(() => {
    return getMultiDayInfo(job?.start_at ?? null, job?.end_at ?? null)
  }, [job?.start_at, job?.end_at])

  const assignmentWorkState = useMemo(() => getAssignmentWorkState(assignment), [assignment])

  if (sessionLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={{ color: '#cbd5e1', marginTop: 12 }}>Načítám relaci…</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!user || !profileId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
        <View style={{ flex: 1, padding: 20, justifyContent: 'center' }}>
          <View
            style={{
              backgroundColor: '#111827',
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: '#1f2937',
              marginBottom: 16,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 8 }}>
              Relace není připravená
            </Text>
            <Text style={{ color: '#cbd5e1', lineHeight: 22 }}>
              Aplikace zatím nemá načtený přihlášený profil. Vrať se na úvod a otevři detail znovu.
            </Text>
          </View>

          <Pressable
            onPress={() => router.replace('/(tabs)')}
            style={{
              backgroundColor: '#334155',
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
              Zpět na úvod
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  if (loadingData) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={{ color: '#cbd5e1', marginTop: 12 }}>Načítám detail zakázky…</Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!job) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
        <View style={{ flex: 1, padding: 20 }}>
          <Pressable
            onPress={() => router.replace('/(tabs)')}
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: '#1e293b',
              marginBottom: 16,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>← Zpět</Text>
          </Pressable>

          <View
            style={{
              backgroundColor: '#111827',
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: '#1f2937',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 8 }}>
              Zakázku se nepodařilo načíst
            </Text>
            <Text style={{ color: '#cbd5e1' }}>
              Zkontroluj, že je správně předané jobId a že pracovník má k zakázce přiřazení.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 40,
        }}
      >
        {offlineQueueSummary.total > 0 && (
          <View
            style={{
              backgroundColor: offlineQueueSummary.failed > 0 ? '#3f1518' : '#3a2a12',
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: offlineQueueSummary.failed > 0 ? '#7f1d1d' : '#92400e',
              marginBottom: 16,
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700', marginBottom: 8 }}>
              Offline synchronizace
            </Text>

            <Text style={{ color: '#e5e7eb', fontSize: 14, lineHeight: 22 }}>
              Čeká akcí: {offlineQueueSummary.pending}
              {offlineQueueSummary.syncing > 0
                ? ` | Právě se synchronizuje: ${offlineQueueSummary.syncing}`
                : ''}
              {offlineQueueSummary.failed > 0
                ? ` | Vyžaduje kontrolu: ${offlineQueueSummary.failed}`
                : ''}
            </Text>

            {!!offlineQueueSummary.latestFailedError && (
              <Text style={{ color: '#fecaca', fontSize: 13, marginTop: 8, lineHeight: 20 }}>
                Poslední chyba po {offlineQueueSummary.latestFailedRetryCount} pokusech:{' '}
                {offlineQueueSummary.latestFailedError}
              </Text>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable
                onPress={handleManualSync}
                disabled={manualSyncing}
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: offlineQueueSummary.failed > 0 ? '#dc2626' : '#a16207',
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  opacity: manualSyncing ? 0.6 : 1,
                }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 14 }}>
                  {manualSyncing ? 'Synchronizuji...' : 'Synchronizovat teď'}
                </Text>
              </Pressable>

              {offlineQueueSummary.failed > 0 && (
                <Pressable
                  onPress={handleResetFailedActions}
                  style={{
                    alignSelf: 'flex-start',
                    backgroundColor: '#ffffff',
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: '#fecaca',
                  }}
                >
                  <Text style={{ color: '#991b1b', fontWeight: '700', fontSize: 14 }}>
                    Obnovit failed akce
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        <Pressable
          onPress={() => router.replace('/(tabs)')}
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 12,
            backgroundColor: '#1e293b',
            marginBottom: 16,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>← Zpět</Text>
        </Pressable>

        <View
          style={{
            backgroundColor: '#111827',
            borderRadius: 18,
            padding: 16,
            borderWidth: 1,
            borderColor: '#1f2937',
            marginBottom: 14,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', marginBottom: 8 }}>
            {job.title ?? 'Bez názvu'}
          </Text>

          <Text style={{ color: '#cbd5e1', marginBottom: 6 }}>
            Adresa: {job.address ?? 'Neuvedeno'}
          </Text>

          <Text style={{ color: '#cbd5e1', marginBottom: 6 }}>
            Začátek: {formatDateTime(job.start_at)}
          </Text>

          <Text style={{ color: '#cbd5e1', marginBottom: 6 }}>
            Konec: {formatDateTime(job.end_at)}
          </Text>

          <Text style={{ color: '#cbd5e1', marginBottom: multiDayInfo ? 6 : 0 }}>
            Stav: {job.status ?? 'Neuvedeno'}
          </Text>

          {multiDayInfo ? (
            <View
              style={{
                alignSelf: 'flex-start',
                marginTop: 4,
                backgroundColor: '#1d4ed8',
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>{multiDayInfo}</Text>
            </View>
          ) : null}
        </View>

        <View
          style={{
            backgroundColor: '#111827',
            borderRadius: 18,
            padding: 16,
            borderWidth: 1,
            borderColor: '#1f2937',
            marginBottom: 14,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 10 }}>
            Instrukce od admina
          </Text>

          <Text style={{ color: '#cbd5e1', lineHeight: 22 }}>
            {job.description?.trim()
              ? job.description
              : 'K této zakázce zatím nejsou zadané žádné instrukce.'}
          </Text>
        </View>

        <JobPhotoSection
          companyId={companyId}
          jobId={job.id}
          uploadedByProfileId={profileId}
          syncTick={syncTick}
          onPhotosChanged={refreshOfflineQueueSummary}
        />

        <View
          style={{
            backgroundColor: '#111827',
            borderRadius: 18,
            padding: 16,
            borderWidth: 1,
            borderColor: '#1f2937',
            marginBottom: 14,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 10 }}>
            Checklist
          </Text>

          {checklistItems.length === 0 ? (
            <Text style={{ color: '#cbd5e1' }}>
              K této zakázce zatím není připraven checklist.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {checklistItems.map((item) => {
                const disabled = togglingChecklistId === item.id

                return (
                  <Pressable
                    key={item.id}
                    onPress={() => toggleChecklistItem(item)}
                    disabled={disabled}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: 12,
                      borderRadius: 14,
                      backgroundColor: '#0b1220',
                      borderWidth: 1,
                      borderColor: '#1f2937',
                      opacity: disabled ? 0.6 : 1,
                    }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        marginTop: 1,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: item.isCompleted ? '#16a34a' : '#111827',
                        borderWidth: 1,
                        borderColor: item.isCompleted ? '#16a34a' : '#475569',
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '900' }}>
                        {item.isCompleted ? '✓' : ''}
                      </Text>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: '#fff',
                          fontSize: 15,
                          lineHeight: 21,
                          textDecorationLine: item.isCompleted ? 'line-through' : 'none',
                          opacity: item.isCompleted ? 0.7 : 1,
                        }}
                      >
                        {item.label}
                      </Text>
                    </View>
                  </Pressable>
                )
              })}
            </View>
          )}
        </View>

        <View
          style={{
            backgroundColor: '#111827',
            borderRadius: 18,
            padding: 16,
            borderWidth: 1,
            borderColor: '#1f2937',
            marginBottom: 14,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 10 }}>
            Stav práce
          </Text>

          <Text style={{ color: '#cbd5e1', marginBottom: 6 }}>
            Zahájeno: {assignment?.work_started_at ? formatDateTime(assignment.work_started_at) : 'Ne'}
          </Text>

          <Text style={{ color: '#cbd5e1', marginBottom: 6 }}>
            Dokončeno: {assignment?.work_completed_at ? formatDateTime(assignment.work_completed_at) : 'Ne'}
          </Text>
        </View>

        <View style={{ gap: 10 }}>
          <Pressable
            onPress={handleStartWork}
            disabled={savingStart || assignmentWorkState !== 'idle'}
            style={{
              backgroundColor: savingStart || assignmentWorkState !== 'idle' ? '#334155' : '#16a34a',
              paddingVertical: 14,
              borderRadius: 14,
              alignItems: 'center',
              display: assignmentWorkState === 'idle' ? 'flex' : 'none',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
              {savingStart ? 'Ukládám...' : 'Zahájit práci'}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleFinishWork}
            disabled={savingFinish || assignmentWorkState !== 'started'}
            style={{
              backgroundColor: savingFinish || assignmentWorkState !== 'started' ? '#334155' : '#2563eb',
              paddingVertical: 14,
              borderRadius: 14,
              alignItems: 'center',
              display: assignmentWorkState === 'started' ? 'flex' : 'none',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
              {savingFinish ? 'Ukládám...' : 'Dokončit práci'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
