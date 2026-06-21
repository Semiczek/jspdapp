import NetInfo from '@react-native-community/netinfo'
import { useRouter } from 'expo-router'
import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useAppSession } from '../../contexts/AppSessionContext'
import { JobPhotoSection } from '../../components/job-photos/JobPhotoSection'
import {
  OFFLINE_KEYS,
  addPendingAction,
  getQueueSummary,
  getCacheItem,
  removeCacheItem,
  resetFailedActionsToPending,
  setCacheItem,
  type QueueSummary,
} from '../../lib/offline'
import { getAssignmentWorkState, hasOpenJobWork } from '../../lib/assignmentWork'
import { jobOverlapsDay } from '../../lib/jobDateRange'
import { supabase } from '../../lib/supabase'
import { AdminHomeCard } from '../../components/admin/AdminHomeCard'
import { syncPendingActions } from '../../lib/syncManager'

type AssignedJob = {
  assignmentId: string
  id: string
  title: string | null
  description: string | null
  address: string | null
  start_at: string | null
  end_at: string | null
  status: string | null
  work_started_at: string | null
  work_completed_at: string | null
}

type WorkShift = {
  id: string
  profile_id: string
  company_id: string | null
  started_at: string | null
  ended_at: string | null
  note: string | null
  shift_date?: string | null
  sync_status?: 'pending' | 'synced'
}

type SelectedJobDetail = {
  assignmentId: string
  id: string
  title: string | null
  description: string | null
  address: string | null
  start_at: string | null
  end_at: string | null
  status: string | null
  work_started_at: string | null
  work_completed_at: string | null
}

type SelectedJobTarget = {
  assignmentId: string
  jobId: string
}

type SelectedChecklistItem = {
  id: string
  label: string
  is_done: boolean
}

const NETWORK_TIMEOUT_MS = 5000

function formatDateTime(value: string | null) {
  if (!value) return 'Bez času'

  const date = new Date(value)

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatDateOnly(value: string | null) {
  if (!value) return 'Bez data'

  const date = new Date(value)

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function getTodayDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isMultiDayJob(startAt: string | null, endAt: string | null) {
  if (!startAt || !endAt) return false

  const start = new Date(startAt)
  const end = new Date(endAt)

  return (
    start.getFullYear() !== end.getFullYear() ||
    start.getMonth() !== end.getMonth() ||
    start.getDate() !== end.getDate()
  )
}

function getChecklistItemLabel(row: any) {
  return (
    row?.label ??
    row?.title ??
    row?.text ??
    row?.name ??
    row?.item_label ??
    row?.description ??
    'Položka checklistu'
  )
}

function getChecklistItemDone(row: any) {
  return Boolean(
    row?.is_done ??
      row?.is_checked ??
      row?.checked ??
      row?.done ??
      row?.completed ??
      false
  )
}

function getSingleJob(rawJobs: any): any | null {
  if (Array.isArray(rawJobs)) return rawJobs[0] ?? null
  return rawJobs ?? null
}

function getChildJobs(rawJob: any): any[] {
  if (!Array.isArray(rawJob?.child_jobs)) return []
  return rawJob.child_jobs.filter(Boolean)
}

function resolveDisplayJobs(rawJob: any): any[] {
  if (!rawJob) return []

  if (rawJob.parent_job_id) {
    return [rawJob]
  }

  const childJobs = getChildJobs(rawJob)

  if (childJobs.length > 0) {
    return childJobs
  }

  return [rawJob]
}

async function isOnline() {
  const state = await NetInfo.fetch()
  return !!state.isConnected
}

async function withTimeout<T>(
  promiseLike: PromiseLike<T>,
  timeoutMs = NETWORK_TIMEOUT_MS
): Promise<T> {
  return Promise.race([
    Promise.resolve(promiseLike),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('NETWORK_TIMEOUT')), timeoutMs)
    }),
  ])
}

function buildLocalShiftId() {
  return `local_shift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function shouldShowJobOnHome(row: {
  work_started_at: string | null
  work_completed_at: string | null
}, job: any, companyId: string, todayDateKey: string) {

  if (!job || job.company_id !== companyId) {
    return false
  }

  const assignmentState = getAssignmentWorkState({
    work_started_at: row.work_started_at ?? null,
    work_completed_at: row.work_completed_at ?? null,
  })

  if (assignmentState === 'started') {
    return true
  }

  return jobOverlapsDay(job.start_at ?? null, job.end_at ?? null, todayDateKey)
}

export default function HomeScreen() {
  const router = useRouter()
  const { user, profile, profileId, companyId, syncTick, isAdmin, role } = useAppSession()

  const [loadingShift, setLoadingShift] = useState(true)
  const [savingShift, setSavingShift] = useState(false)
  const [savingShiftNote, setSavingShiftNote] = useState(false)
  const [activeShift, setActiveShift] = useState<WorkShift | null>(null)
  const [shiftNote, setShiftNote] = useState('')

  const [loadingJobs, setLoadingJobs] = useState(true)
  const [savingJobId, setSavingJobId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<AssignedJob[]>([])

  const [payrollBoxOpen, setPayrollBoxOpen] = useState(false)

  const [selectedJobTarget, setSelectedJobTarget] = useState<SelectedJobTarget | null>(null)
  const [selectedJobDetail, setSelectedJobDetail] =
    useState<SelectedJobDetail | null>(null)
  const [selectedChecklistItems, setSelectedChecklistItems] = useState<
    SelectedChecklistItem[]
  >([])
  const [loadingSelectedJob, setLoadingSelectedJob] = useState(false)
  const [savingChecklistItemId, setSavingChecklistItemId] = useState<string | null>(
    null
  )
  const [offlineQueueSummary, setOfflineQueueSummary] = useState<QueueSummary>({
    total: 0,
    pending: 0,
    syncing: 0,
    failed: 0,
    latestFailedError: null,
    latestFailedRetryCount: 0,
  })
  const [manualSyncing, setManualSyncing] = useState(false)
  const todayDateKey = getTodayDateString()
  const todayJobsCacheKey = OFFLINE_KEYS.todayJobs(todayDateKey)

  async function refreshOfflineQueueSummary() {
    const summary = await getQueueSummary()
    setOfflineQueueSummary(summary)
  }

  async function handleManualSync() {
    if (manualSyncing) return

    setManualSyncing(true)

    try {
      if (offlineQueueSummary.failed > 0) {
        await resetFailedActionsToPending()
      }

      await syncPendingActions()
      await refreshOfflineQueueSummary()
      await loadActiveShift()
      await loadTodayJobs()

      if (selectedJobTarget) {
        await loadSelectedJobDetail(selectedJobTarget.jobId, selectedJobTarget.assignmentId)
      }
    } finally {
      setManualSyncing(false)
    }
  }

  async function handleResetFailedActions() {
    await resetFailedActionsToPending()
    await refreshOfflineQueueSummary()
  }

  async function persistLocalActiveShift(shift: WorkShift | null) {
    setActiveShift(shift)
    setShiftNote(shift?.note ?? '')

    if (shift) {
      await setCacheItem(OFFLINE_KEYS.activeShift, shift)
    } else {
      await removeCacheItem(OFFLINE_KEYS.activeShift)
    }
  }

  async function queueOfflineShiftStart(localShift: WorkShift) {
    await addPendingAction('start_shift', {
      local_shift_id: localShift.id,
      profile_id: localShift.profile_id,
      company_id: localShift.company_id,
      shift_date: localShift.shift_date ?? null,
      started_at: localShift.started_at,
      note: localShift.note,
    })

    await persistLocalActiveShift(localShift)
    await refreshOfflineQueueSummary()
  }

  async function queueOfflineShiftEnd(
    shift: WorkShift,
    endedAt: string,
    noteValue: string | null
  ) {
    const updatedShift: WorkShift = {
      ...shift,
      note: noteValue,
      ended_at: endedAt,
      sync_status: 'pending',
    }

    await addPendingAction('save_shift_note', {
      local_shift_id: shift.id,
      note: noteValue,
    })

    await addPendingAction('end_shift', {
      local_shift_id: shift.id,
      ended_at: endedAt,
    })

    await persistLocalActiveShift(updatedShift)
    await refreshOfflineQueueSummary()
  }

  async function loadActiveShift() {
    if (!profileId) {
      setActiveShift(null)
      setShiftNote('')
      setLoadingShift(false)
      return
    }

    setLoadingShift(true)

    const cached = await getCacheItem<WorkShift | null>(OFFLINE_KEYS.activeShift)
    const online = await isOnline()

    if (!online) {
      setActiveShift(cached ?? null)
      setShiftNote(cached?.note ?? '')
      setLoadingShift(false)
      return
    }

    const { data, error } = await supabase
      .from('work_shifts')
      .select('id, profile_id, company_id, started_at, ended_at, note, shift_date')
      .eq('profile_id', profileId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('Chyba při načítání směny:', error)
      setActiveShift(cached ?? null)
      setShiftNote(cached?.note ?? '')
      setLoadingShift(false)
      return
    }

    if (data) {
      const syncedShift: WorkShift = {
        ...data,
        sync_status: 'synced',
      }

      await persistLocalActiveShift(syncedShift)
      setLoadingShift(false)
      return
    }

    if (cached?.sync_status === 'pending' && cached.profile_id === profileId) {
      await persistLocalActiveShift(cached)
      setLoadingShift(false)
      return
    }

    await persistLocalActiveShift(null)
    setLoadingShift(false)
  }

  async function saveShiftNote(shiftId: string, noteValue: string) {
    if (!activeShift) return false

    setSavingShiftNote(true)

    const normalizedNote = noteValue.trim() === '' ? null : noteValue.trim()

    try {
      const online = await isOnline()

      if (!online) {
        const updatedShift: WorkShift = {
          ...activeShift,
          note: normalizedNote,
          sync_status: 'pending',
        }

        await persistLocalActiveShift(updatedShift)

        await addPendingAction('save_shift_note', {
          local_shift_id: activeShift.id,
          note: normalizedNote,
        })

        await refreshOfflineQueueSummary()
        return true
      }

      const response: any = await withTimeout(
        supabase
          .from('work_shifts')
          .update({
            note: normalizedNote,
          })
          .eq('id', shiftId)
      )

      if (response?.error) {
        throw response.error
      }

      const updatedShift: WorkShift = {
        ...activeShift,
        note: normalizedNote,
        sync_status: 'synced',
      }

      await persistLocalActiveShift(updatedShift)
      return true
    } catch (error) {
      console.error('Chyba při ukládání poznámky ke směně, padám do offline queue:', error)

      try {
        const updatedShift: WorkShift = {
          ...activeShift,
          note: normalizedNote,
          sync_status: 'pending',
        }

        await persistLocalActiveShift(updatedShift)

        await addPendingAction('save_shift_note', {
          local_shift_id: activeShift.id,
          note: normalizedNote,
        })

        await refreshOfflineQueueSummary()
        return true
      } catch (queueError) {
        console.error('Chyba při offline ukládání poznámky ke směně:', queueError)
        Alert.alert('Chyba', 'Nepodařilo se uložit poznámku ke směně.')
        return false
      }
    } finally {
      setSavingShiftNote(false)
    }
  }

  async function startShift() {
    if (!profileId || savingShift) return

    if (activeShift && !activeShift.ended_at) {
      Alert.alert('Směna už běží', 'Nejdřív ukonči aktuální směnu.')
      return
    }

    setSavingShift(true)

    const now = new Date().toISOString()
    const noteValue = shiftNote.trim() === '' ? null : shiftNote.trim()
    const shiftDate = getTodayDateString()

    const localShift: WorkShift = {
      id: buildLocalShiftId(),
      profile_id: profileId,
      company_id: companyId,
      started_at: now,
      ended_at: null,
      note: noteValue,
      shift_date: shiftDate,
      sync_status: 'pending',
    }

    try {
      const online = await isOnline()

      if (!online) {
        await queueOfflineShiftStart(localShift)

        Alert.alert(
          'Uloženo offline',
          'Směna byla spuštěna offline a čeká na synchronizaci.'
        )
        return
      }

      const response: any = await withTimeout(
        supabase.from('work_shifts').insert({
          profile_id: profileId,
          company_id: companyId,
          shift_date: shiftDate,
          started_at: now,
          ended_at: null,
          note: noteValue,
        })
      )

      if (response?.error) {
        throw response.error
      }

      await loadActiveShift()
      Alert.alert('Hotovo', 'Směna byla zahájena.')
    } catch (error) {
      console.error('Chyba při zahájení směny, padám do offline queue:', error)

      try {
        await queueOfflineShiftStart(localShift)

        Alert.alert(
          'Uloženo offline',
          'Směna byla uložena lokálně a čeká na synchronizaci.'
        )
      } catch (queueError) {
        console.error('Chyba při offline zahájení směny:', queueError)
        Alert.alert('Chyba', 'Nepodařilo se uložit zahájení směny.')
      }
    } finally {
      setSavingShift(false)
    }
  }

  async function endShift() {
    if (!activeShift?.id || savingShift) return

    setSavingShift(true)

    const now = new Date().toISOString()
    const normalizedNote = shiftNote.trim() === '' ? null : shiftNote.trim()

    try {
      if (hasOpenJobWork([selectedJobDetail, ...jobs])) {
        Alert.alert('Nejdřív zakázka', 'Nejdřív dokonči rozpracovanou zakázku.')
        return
      }

      const online = await isOnline()

      if (online && profileId) {
        const { data: openAssignments, error: openAssignmentsError } = await supabase
          .from('job_assignments')
          .select('id, work_started_at, work_completed_at')
          .eq('profile_id', profileId)
          .not('work_started_at', 'is', null)
          .is('work_completed_at', null)

        if (openAssignmentsError) {
          console.error('Chyba při kontrole rozpracované zakázky:', openAssignmentsError)
          Alert.alert('Chyba', 'Nepodařilo se ověřit rozpracovanou zakázku.')
          return
        }

        if (hasOpenJobWork(openAssignments ?? [])) {
          Alert.alert('Nejdřív zakázka', 'Nejdřív dokonči rozpracovanou zakázku.')
          return
        }
      }

      if (!online) {
        await queueOfflineShiftEnd(activeShift, now, normalizedNote)

        Alert.alert(
          'Uloženo offline',
          'Ukončení směny bylo uloženo offline a čeká na synchronizaci.'
        )
        return
      }

      const response: any = await withTimeout(
        supabase
          .from('work_shifts')
          .update({
            note: normalizedNote,
            ended_at: now,
          })
          .eq('id', activeShift.id)
      )

      if (response?.error) {
        throw response.error
      }

      await persistLocalActiveShift(null)
      Alert.alert('Hotovo', 'Směna byla ukončena.')
    } catch (error) {
      console.error('Chyba při ukončení směny, padám do offline queue:', error)

      try {
        await queueOfflineShiftEnd(activeShift, now, normalizedNote)

        Alert.alert(
          'Uloženo offline',
          'Ukončení směny bylo uloženo lokálně a čeká na synchronizaci.'
        )
      } catch (queueError) {
        console.error('Chyba při offline ukončení směny:', queueError)
        Alert.alert('Chyba', 'Nepodařilo se uložit ukončení směny.')
      }
    } finally {
      setSavingShift(false)
    }
  }

  async function loadTodayJobs() {
    if (!profileId) {
      setJobs([])
      setLoadingJobs(false)
      return
    }

    setLoadingJobs(true)

    const online = await isOnline()

    if (!online) {
      const cached = await getCacheItem<AssignedJob[]>(todayJobsCacheKey)
      setJobs(cached ?? [])
      setLoadingJobs(false)
      return
    }

    const { data, error } = await supabase
      .from('job_assignments')
      .select(
        `
        id,
        profile_id,
        work_started_at,
        work_completed_at,
        jobs (
          id,
          title,
          description,
          address,
          start_at,
          end_at,
          status,
          company_id
        )
      `
      )
      .eq('profile_id', profileId)

    if (error) {
      console.error('Chyba při načítání dnešních zakázek:', error)

      const cached = await getCacheItem<AssignedJob[]>(todayJobsCacheKey)
      setJobs(cached ?? [])
      setLoadingJobs(false)
      return
    }

    const mapped: AssignedJob[] = (data ?? [])
      .map((row: any) => {
        const job = getSingleJob(row.jobs)

        if (!shouldShowJobOnHome(row, job, companyId, todayDateKey)) {
          return null
        }

        return {
          assignmentId: row.id,
          id: job.id,
          title: job.title ?? 'Zakázka bez názvu',
          description: job.description ?? null,
          address: job.address ?? null,
          start_at: job.start_at ?? null,
          end_at: job.end_at ?? null,
          status: job.status ?? null,
          work_started_at: row.work_started_at ?? null,
          work_completed_at: row.work_completed_at ?? null,
        }
      })
      .filter((item): item is AssignedJob => item !== null)

    const directlyAssignedJobIds = new Set(mapped.map((item) => item.id))
    const parentJobIds = mapped.map((item) => item.id)
    let normalizedJobs = mapped

    if (parentJobIds.length > 0) {
      const { data: childJobsData, error: childJobsError } = await supabase
        .from('jobs')
        .select(
          'id, parent_job_id, title, description, address, start_at, end_at, status, company_id'
        )
        .in('parent_job_id', parentJobIds)

      if (childJobsError) {
        console.error('Chyba pÅ™i naÄÃ­tÃ¡nÃ­ pÅ™idruÅ¾enÃ½ch zakÃ¡zek:', childJobsError)
      } else if ((childJobsData ?? []).length > 0) {
        const childJobsByParentId = new Map<string, any[]>()

        for (const childJob of childJobsData ?? []) {
          if (!childJob.parent_job_id) continue

          const current = childJobsByParentId.get(childJob.parent_job_id) ?? []
          current.push(childJob)
          childJobsByParentId.set(childJob.parent_job_id, current)
        }

        normalizedJobs = mapped.flatMap((item) => {
          const childJobs = childJobsByParentId.get(item.id) ?? []

          if (childJobs.length === 0) {
            return [item]
          }

          return childJobs
            .filter((childJob) => !directlyAssignedJobIds.has(childJob.id))
            .filter((childJob) => shouldShowJobOnHome(item, childJob, companyId, todayDateKey))
            .map((childJob) => ({
              ...item,
              id: childJob.id,
              title: childJob.title ?? item.title,
              description: childJob.description ?? item.description,
              address: childJob.address ?? item.address,
              start_at: childJob.start_at ?? item.start_at,
              end_at: childJob.end_at ?? item.end_at,
              status: childJob.status ?? item.status,
            }))
        })
      }
    }

    const deduplicatedJobs = Array.from(
      new Map(
        normalizedJobs.map((item) => [item.id, item] as const)
      ).values()
    )

    setJobs(deduplicatedJobs)
    await setCacheItem(todayJobsCacheKey, deduplicatedJobs)
    setLoadingJobs(false)
  }

  async function loadSelectedJobDetail(jobId: string, assignmentId: string) {
    if (!profileId) return

    setLoadingSelectedJob(true)
    setSelectedJobDetail(null)
    setSelectedChecklistItems([])

    const online = await isOnline()

    if (!online) {
      const cachedJobDetail = await getCacheItem<SelectedJobDetail>(
        OFFLINE_KEYS.jobDetail(jobId)
      )
      const cachedChecklist = await getCacheItem<SelectedChecklistItem[]>(
        OFFLINE_KEYS.jobChecklist(jobId)
      )

      setSelectedJobDetail(cachedJobDetail ?? null)
      setSelectedChecklistItems(cachedChecklist ?? [])
      setLoadingSelectedJob(false)
      return
    }

    const { data, error } = await supabase
      .from('job_assignments')
      .select(
        `
        id,
        profile_id,
        work_started_at,
        work_completed_at
      `
      )
      .eq('profile_id', profileId)
      .eq('id', assignmentId)
      .maybeSingle()

    if (error) {
      console.error('Chyba při načítání detailu zakázky:', error)

      const cachedJobDetail = await getCacheItem<SelectedJobDetail>(
        OFFLINE_KEYS.jobDetail(jobId)
      )
      const cachedChecklist = await getCacheItem<SelectedChecklistItem[]>(
        OFFLINE_KEYS.jobChecklist(jobId)
      )

      setSelectedJobDetail(cachedJobDetail ?? null)
      setSelectedChecklistItems(cachedChecklist ?? [])
      setLoadingSelectedJob(false)
      return
    }

    const { data: jobData, error: jobError } = await supabase
      .from('jobs')
      .select('id, title, description, address, start_at, end_at, status, company_id')
      .eq('id', jobId)
      .maybeSingle()

    if (jobError) {
      console.error('Chyba pÅ™i naÄÃ­tÃ¡nÃ­ pracovnÃ­ zakÃ¡zky:', jobError)

      const cachedJobDetail = await getCacheItem<SelectedJobDetail>(
        OFFLINE_KEYS.jobDetail(jobId)
      )
      const cachedChecklist = await getCacheItem<SelectedChecklistItem[]>(
        OFFLINE_KEYS.jobChecklist(jobId)
      )

      setSelectedJobDetail(cachedJobDetail ?? null)
      setSelectedChecklistItems(cachedChecklist ?? [])
      setLoadingSelectedJob(false)
      return
    }

    if (!data || !jobData || jobData.company_id !== companyId) {
      Alert.alert('Chyba', 'Zakázka nebyla nalezena.')
      setLoadingSelectedJob(false)
      return
    }

    const job = jobData

    const detail: SelectedJobDetail = {
      assignmentId: data.id,
      id: jobData.id,
      title: job.title ?? 'Zakázka bez názvu',
      description: job.description ?? null,
      address: job.address ?? null,
      start_at: job.start_at ?? null,
      end_at: job.end_at ?? null,
      status: job.status ?? null,
      work_started_at: data.work_started_at ?? null,
      work_completed_at: data.work_completed_at ?? null,
    }

    detail.title = jobData.title ?? detail.title
    detail.description = jobData.description ?? detail.description
    detail.address = jobData.address ?? detail.address
    detail.start_at = jobData.start_at ?? detail.start_at
    detail.end_at = jobData.end_at ?? detail.end_at
    detail.status = jobData.status ?? detail.status

    setSelectedJobDetail(detail)
    await setCacheItem(OFFLINE_KEYS.jobDetail(jobId), detail)

    const { data: checklistRows, error: checklistError } = await supabase
      .from('job_checklists')
      .select('id')
      .eq('job_id', jobId)

    if (checklistError) {
      console.error('Chyba při načítání checklistů zakázky:', checklistError)
      setSelectedChecklistItems([])
      setLoadingSelectedJob(false)
      return
    }

    const checklistIds = checklistRows?.map((row: any) => row.id) ?? []

    if (checklistIds.length === 0) {
      setSelectedChecklistItems([])
      await setCacheItem(OFFLINE_KEYS.jobChecklist(jobId), [])
      setLoadingSelectedJob(false)
      return
    }

    const { data: checklistItemsData, error: checklistItemsError } = await supabase
      .from('job_checklist_items')
      .select('*')
      .in('job_checklist_id', checklistIds)

    if (checklistItemsError) {
      console.error('Chyba při načítání checklist položek:', checklistItemsError)
      setSelectedChecklistItems([])
      setLoadingSelectedJob(false)
      return
    }

    const mappedChecklistItems: SelectedChecklistItem[] =
      checklistItemsData?.map((row: any) => ({
        id: row.id,
        label: getChecklistItemLabel(row),
        is_done: getChecklistItemDone(row),
      })) ?? []

    setSelectedChecklistItems(mappedChecklistItems)
    await setCacheItem(OFFLINE_KEYS.jobChecklist(jobId), mappedChecklistItems)
    setLoadingSelectedJob(false)
  }

  async function openJobDetail(job: AssignedJob) {
    setSelectedJobTarget({
      assignmentId: job.assignmentId,
      jobId: job.id,
    })
    await loadSelectedJobDetail(job.id, job.assignmentId)
  }

  function closeJobDetail() {
    setSelectedJobTarget(null)
    setSelectedJobDetail(null)
    setSelectedChecklistItems([])
    setLoadingSelectedJob(false)
    setSavingChecklistItemId(null)
  }

  async function applyLocalAssignmentState(
    assignmentId: string,
    updates: Partial<Pick<AssignedJob, 'work_started_at' | 'work_completed_at'>>
  ) {
    const updatedJobs = jobs.map((job) =>
      job.assignmentId === assignmentId
        ? {
            ...job,
            ...updates,
          }
        : job
    )

    setJobs(updatedJobs)
    await setCacheItem(todayJobsCacheKey, updatedJobs)

    if (selectedJobDetail?.assignmentId === assignmentId && selectedJobTarget?.jobId) {
      const updatedDetail: SelectedJobDetail = {
        ...selectedJobDetail,
        ...updates,
      }

      setSelectedJobDetail(updatedDetail)
      await setCacheItem(OFFLINE_KEYS.jobDetail(selectedJobTarget.jobId), updatedDetail)
    }
  }

  async function startJobWork(assignmentId: string) {
    if (!profileId) return

    if (!activeShift || activeShift.ended_at) {
      Alert.alert('Nejdřív směna', 'Nejdřív musíš zahájit směnu.')
      return
    }

    setSavingJobId(assignmentId)

    const now = new Date().toISOString()
    const online = await isOnline()

    if (!online) {
      try {
        await addPendingAction('start_job_work', {
          assignment_id: assignmentId,
          profile_id: profileId,
          started_at: now,
        })

        await applyLocalAssignmentState(assignmentId, {
          work_started_at: now,
          work_completed_at: null,
        })

        await refreshOfflineQueueSummary()
        setSavingJobId(null)
        Alert.alert(
          'Uloženo offline',
          'Zahájení práce bylo uloženo offline a čeká na synchronizaci.'
        )
        return
      } catch (error) {
        console.error('Chyba při offline zahájení práce:', error)
        Alert.alert('Chyba', 'Nepodařilo se uložit offline zahájení práce.')
        setSavingJobId(null)
        return
      }
    }

    const { error } = await supabase
      .from('job_assignments')
      .update({
        work_started_at: now,
        work_completed_at: null,
      })
      .eq('id', assignmentId)
      .eq('profile_id', profileId)

    if (error) {
      console.error('Chyba při zahájení práce na zakázce:', error)
      Alert.alert('Chyba', 'Nepodařilo se zahájit práci.')
      setSavingJobId(null)
      return
    }

    await applyLocalAssignmentState(assignmentId, {
      work_started_at: now,
      work_completed_at: null,
    })
    await loadTodayJobs()

    if (selectedJobDetail?.assignmentId === assignmentId && selectedJobTarget?.jobId) {
      await loadSelectedJobDetail(selectedJobTarget.jobId, assignmentId)
    }

    setSavingJobId(null)
    Alert.alert('Hotovo', 'Práce na zakázce byla zahájena.')
  }

  async function completeJobWork(assignmentId: string) {
    if (!profileId) return

    if (!activeShift || activeShift.ended_at) {
      Alert.alert('Nejdřív směna', 'Nejdřív musíš zahájit směnu.')
      return
    }

    setSavingJobId(assignmentId)

    const now = new Date().toISOString()
    const online = await isOnline()

    if (!online) {
      try {
        await addPendingAction('complete_job_work', {
          assignment_id: assignmentId,
          profile_id: profileId,
          completed_at: now,
        })

        await applyLocalAssignmentState(assignmentId, {
          work_completed_at: now,
        })

        await refreshOfflineQueueSummary()
        setSavingJobId(null)
        Alert.alert(
          'Uloženo offline',
          'Dokončení práce bylo uloženo offline a čeká na synchronizaci.'
        )
        return
      } catch (error) {
        console.error('Chyba při offline dokončení práce:', error)
        Alert.alert('Chyba', 'Nepodařilo se uložit offline dokončení práce.')
        setSavingJobId(null)
        return
      }
    }

    const { error } = await supabase
      .from('job_assignments')
      .update({
        work_completed_at: now,
      })
      .eq('id', assignmentId)
      .eq('profile_id', profileId)

    if (error) {
      console.error('Chyba při dokončení práce na zakázce:', error)
      Alert.alert('Chyba', 'Nepodařilo se označit zakázku jako hotovou.')
      setSavingJobId(null)
      return
    }

    await applyLocalAssignmentState(assignmentId, {
      work_completed_at: now,
    })
    await loadTodayJobs()

    if (selectedJobDetail?.assignmentId === assignmentId && selectedJobTarget?.jobId) {
      await loadSelectedJobDetail(selectedJobTarget.jobId, assignmentId)
    }

    setSavingJobId(null)
    Alert.alert('Hotovo', 'Zakázka byla označena jako hotová.')
  }

  async function toggleChecklistItem(itemId: string, currentValue: boolean) {
    if (!selectedJobTarget?.jobId) return

    setSavingChecklistItemId(itemId)

    const nextValue = !currentValue
    const online = await isOnline()

    if (!online) {
      try {
        await addPendingAction('toggle_checklist_item', {
          item_id: itemId,
          next_value: nextValue,
        })

        const updatedItems = selectedChecklistItems.map((item) =>
          item.id === itemId
            ? {
                ...item,
                is_done: nextValue,
              }
            : item
        )

        setSelectedChecklistItems(updatedItems)
        await setCacheItem(OFFLINE_KEYS.jobChecklist(selectedJobTarget.jobId), updatedItems)

        await refreshOfflineQueueSummary()
        setSavingChecklistItemId(null)
        Alert.alert(
          'Uloženo offline',
          'Checklist byl uložen offline a čeká na synchronizaci.'
        )
        return
      } catch (error) {
        console.error('Chyba při offline ukládání checklist položky:', error)
        Alert.alert('Chyba', 'Nepodařilo se uložit checklist offline.')
        setSavingChecklistItemId(null)
        return
      }
    }

    const { error } = await supabase
      .from('job_checklist_items')
      .update({
        is_done: nextValue,
      })
      .eq('id', itemId)

    if (error) {
      console.error('Chyba při ukládání checklist položky:', error)
      Alert.alert('Chyba', 'Nepodařilo se uložit checklist.')
      setSavingChecklistItemId(null)
      return
    }

    const updatedItems = selectedChecklistItems.map((item) =>
      item.id === itemId
        ? {
            ...item,
            is_done: nextValue,
          }
        : item
    )

    setSelectedChecklistItems(updatedItems)
    await setCacheItem(OFFLINE_KEYS.jobChecklist(selectedJobTarget.jobId), updatedItems)

    setSavingChecklistItemId(null)
  }

  useEffect(() => {
    refreshOfflineQueueSummary()
    loadActiveShift()
    loadTodayJobs()
  }, [profileId, companyId])

  useEffect(() => {
    if (!profileId) return

    refreshOfflineQueueSummary()
    loadActiveShift()
    loadTodayJobs()

    if (selectedJobTarget) {
      loadSelectedJobDetail(selectedJobTarget.jobId, selectedJobTarget.assignmentId)
    }
  }, [syncTick])

  const greetingName = useMemo(() => {
    if (profile?.full_name) return profile.full_name
    if (user?.email) return user.email
    return 'Uživatel'
  }, [profile?.full_name, user?.email])

  const shiftIsRunning = !!activeShift && !activeShift.ended_at
  const shiftIsPendingSync = activeShift?.sync_status === 'pending'
  const shiftIsEndedOffline = !!activeShift?.ended_at
  const hasOfflineQueueItems = offlineQueueSummary.total > 0

  if (selectedJobTarget) {
    const selectedJobState = getAssignmentWorkState(selectedJobDetail)
    const isSavingSelectedJob =
      savingJobId !== null && savingJobId === selectedJobDetail?.assignmentId

    return (
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 16,
          backgroundColor: '#f5f7fb',
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
          <Pressable
            onPress={closeJobDetail}
            style={{
              alignSelf: 'flex-start',
              backgroundColor: '#e5e7eb',
              borderRadius: 12,
              paddingVertical: 10,
              paddingHorizontal: 14,
              marginBottom: 12,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827' }}>
              Zpět na přehled
            </Text>
          </Pressable>

          <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 4 }}>
            Detail zakázky
          </Text>

          <Text style={{ fontSize: 14, color: '#555' }}>
            Pořád jsi ve stejném screenu.
          </Text>
        </View>

        {loadingSelectedJob ? (
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 24,
              alignItems: 'center',
            }}
          >
            <ActivityIndicator size="large" />
            <Text style={{ marginTop: 12, color: '#555' }}>
              Načítám detail zakázky...
            </Text>
          </View>
        ) : !selectedJobDetail ? (
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 16,
            }}
          >
            <Text style={{ fontSize: 15, color: '#666' }}>
              Detail zakázky se nepodařilo načíst.
            </Text>
          </View>
        ) : (
          <>
            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 10 }}>
                {selectedJobDetail.title ?? 'Zakázka'}
              </Text>

                <Text style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                  Adresa: {selectedJobDetail.address ?? 'Bez adresy'}
                </Text>

                <Text style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                  ID zakázky: {selectedJobDetail.id}
                </Text>

              <Text style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                Začátek: {formatDateTime(selectedJobDetail.start_at)}
              </Text>

              <Text style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                Konec: {formatDateTime(selectedJobDetail.end_at)}
              </Text>

              <Text style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                Stav zakázky: {selectedJobDetail.status ?? 'Bez stavu'}
              </Text>

              <Text style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                Vícedenní:{' '}
                <Text style={{ fontWeight: '700' }}>
                  {isMultiDayJob(
                    selectedJobDetail.start_at,
                    selectedJobDetail.end_at
                  )
                    ? 'Ano'
                    : 'Ne'}
                </Text>
              </Text>

              <Text style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                Stav práce pracovníka:{' '}
                <Text style={{ fontWeight: '700' }}>
                  {selectedJobState === 'completed'
                    ? 'Hotovo'
                    : selectedJobState === 'started'
                      ? 'Probíhá'
                      : 'Nezahájeno'}
                </Text>
              </Text>

              {selectedJobDetail.work_started_at && (
                <Text style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                  Zahájeno: {formatDateTime(selectedJobDetail.work_started_at)}
                </Text>
              )}

              {selectedJobDetail.work_completed_at && (
                <Text style={{ fontSize: 14, color: '#555' }}>
                  Dokončeno: {formatDateTime(selectedJobDetail.work_completed_at)}
                </Text>
              )}
            </View>

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>
                Instrukce od admina
              </Text>

              <View
                style={{
                  backgroundColor: '#f9fafb',
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <Text style={{ fontSize: 15, color: '#444', lineHeight: 22 }}>
                  {selectedJobDetail.description?.trim()
                    ? selectedJobDetail.description
                    : 'K této zakázce zatím nejsou žádné instrukce.'}
                </Text>
              </View>
            </View>

            <JobPhotoSection
              companyId={companyId}
              jobId={selectedJobDetail.id}
              uploadedByProfileId={profileId}
              syncTick={syncTick}
              onPhotosChanged={refreshOfflineQueueSummary}
            />

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>
                Checklist
              </Text>

              {selectedChecklistItems.length === 0 ? (
                <Text style={{ fontSize: 15, color: '#666' }}>
                  K této zakázce zatím není checklist.
                </Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {selectedChecklistItems.map((item, index) => {
                    const isSavingThisItem = savingChecklistItemId === item.id

                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => toggleChecklistItem(item.id, item.is_done)}
                        disabled={isSavingThisItem}
                        style={{
                          borderWidth: 1,
                          borderColor: item.is_done ? '#86efac' : '#e5e7eb',
                          borderRadius: 12,
                          padding: 12,
                          backgroundColor: item.is_done ? '#ecfdf5' : '#f9fafb',
                          opacity: isSavingThisItem ? 0.6 : 1,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 15,
                            fontWeight: '600',
                            color: '#111827',
                            marginBottom: 6,
                          }}
                        >
                          {index + 1}. {item.label}
                        </Text>

                        <Text
                          style={{
                            fontSize: 14,
                            color: item.is_done ? '#166534' : '#555',
                            fontWeight: '600',
                          }}
                        >
                          {isSavingThisItem
                            ? 'Ukládám...'
                            : item.is_done
                              ? 'Splněno – klepni pro zrušení'
                              : 'Nesplněno – klepni pro splnění'}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              )}
            </View>

            <View
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>
                Akce
              </Text>

              {(!activeShift || activeShift.ended_at) && (
                <View
                  style={{
                    backgroundColor: '#fef3c7',
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 12,
                  }}
                >
                  <Text style={{ color: '#92400e', fontSize: 14, fontWeight: '600' }}>
                    Nejdřív musíš zahájit směnu.
                  </Text>
                </View>
              )}

              {selectedJobState === 'idle' && (
                <Pressable
                  onPress={() => startJobWork(selectedJobDetail.assignmentId)}
                  disabled={isSavingSelectedJob}
                  style={{
                    backgroundColor: '#2563eb',
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: 'center',
                    opacity: isSavingSelectedJob ? 0.6 : 1,
                    marginBottom: 12,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                    {isSavingSelectedJob ? 'Ukládám...' : 'Zahájit práci'}
                  </Text>
                </Pressable>
              )}

              {selectedJobState === 'started' && (
                <Pressable
                  onPress={() => completeJobWork(selectedJobDetail.assignmentId)}
                  disabled={isSavingSelectedJob}
                  style={{
                    backgroundColor: '#16a34a',
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: 'center',
                    opacity: isSavingSelectedJob ? 0.6 : 1,
                    marginBottom: 12,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                    {isSavingSelectedJob ? 'Ukládám...' : 'Dokončit práci'}
                  </Text>
                </Pressable>
              )}

              {selectedJobState === 'completed' && (
                <View
                  style={{
                    backgroundColor: '#dcfce7',
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <Text style={{ color: '#166534', fontSize: 16, fontWeight: '700' }}>
                    Zakázka dokončena
                  </Text>
                </View>
              )}

              <Pressable
                onPress={closeJobDetail}
                style={{
                  backgroundColor: '#111827',
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                  Zpět na přehled
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    )
  }

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        gap: 16,
        backgroundColor: '#f5f7fb',
        flexGrow: 1,
      }}
    >
      {isAdmin && (
        <AdminHomeCard
          role={role}
          companyId={companyId}
          profileId={profileId}
          syncTick={syncTick}
          onOpenControl={() => router.push('/kontrola-praci')}
        />
      )}

      {hasOfflineQueueItems && (
        <View
          style={{
            backgroundColor: offlineQueueSummary.failed > 0 ? '#fef2f2' : '#fffbeb',
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: offlineQueueSummary.failed > 0 ? '#fecaca' : '#fde68a',
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: offlineQueueSummary.failed > 0 ? '#991b1b' : '#92400e',
              marginBottom: 8,
            }}
          >
            Offline synchronizace
          </Text>

          <Text
            style={{
              fontSize: 14,
              color: offlineQueueSummary.failed > 0 ? '#991b1b' : '#78350f',
              lineHeight: 22,
            }}
          >
            Čeká akcí: {offlineQueueSummary.pending}
            {offlineQueueSummary.syncing > 0
              ? ` | Právě se synchronizuje: ${offlineQueueSummary.syncing}`
              : ''}
            {offlineQueueSummary.failed > 0
              ? ` | Vyžaduje kontrolu: ${offlineQueueSummary.failed}`
              : ''}
          </Text>

          <Text
            style={{
              fontSize: 13,
              color: offlineQueueSummary.failed > 0 ? '#7f1d1d' : '#92400e',
              marginTop: 8,
              lineHeight: 20,
            }}
          >
            {offlineQueueSummary.failed > 0
              ? 'Aplikace je online, ale některá uložená akce selhala opakovaně. Tlačítko Synchronizovat teď ji zkusí odeslat znovu.'
              : 'Jakmile bude internet dostupný, aplikace to zkusí znovu automaticky.'}
          </Text>

          {!!offlineQueueSummary.latestFailedError && (
            <Text
              style={{
                fontSize: 13,
                color: '#7f1d1d',
                marginTop: 8,
                lineHeight: 20,
              }}
            >
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
                backgroundColor: offlineQueueSummary.failed > 0 ? '#b91c1c' : '#92400e',
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

      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 8 }}>
          Dobrý den
        </Text>

        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 4 }}>
          {greetingName}
        </Text>

        <Text style={{ fontSize: 14, color: '#555' }}>
          Profile ID: {profileId ?? 'Nenačteno'}
        </Text>
      </View>

      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>
          Směna
        </Text>

        {loadingShift ? (
          <ActivityIndicator size="large" />
        ) : (
          <>
            <Text style={{ fontSize: 16, color: '#444', marginBottom: 8 }}>
              Stav:{' '}
              <Text style={{ fontWeight: '700' }}>
                {shiftIsRunning
                  ? 'Směna běží'
                  : shiftIsEndedOffline
                    ? 'Směna ukončena offline'
                    : 'Směna neběží'}
              </Text>
            </Text>

            {activeShift?.started_at ? (
              <Text style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                Začátek směny: {formatDateTime(activeShift.started_at)}
              </Text>
            ) : (
              <Text style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>
                Dnes ještě nemáš otevřenou směnu.
              </Text>
            )}

            {activeShift?.ended_at && (
              <Text style={{ fontSize: 14, color: '#555', marginBottom: 16 }}>
                Konec směny: {formatDateTime(activeShift.ended_at)}
              </Text>
            )}

            {shiftIsPendingSync && (
              <View
                style={{
                  backgroundColor: '#fef3c7',
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 12,
                }}
              >
                <Text style={{ color: '#92400e', fontSize: 14, fontWeight: '600' }}>
                  Změny směny jsou uložené offline a čekají na synchronizaci.
                </Text>
              </View>
            )}

            <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 8 }}>
              Poznámka ke směně
            </Text>

            <TextInput
              value={shiftNote}
              onChangeText={setShiftNote}
              placeholder="Napiš, co právě děláš nebo co se změnilo..."
              multiline
              textAlignVertical="top"
              style={{
                minHeight: 90,
                borderWidth: 1,
                borderColor: '#d1d5db',
                borderRadius: 12,
                padding: 12,
                backgroundColor: '#ffffff',
                marginBottom: 12,
                fontSize: 14,
              }}
            />

            {!!activeShift && (
              <Pressable
                onPress={async () => {
                  if (!activeShift?.id || savingShiftNote) return

                  const saved = await saveShiftNote(activeShift.id, shiftNote)

                  if (saved) {
                    if (activeShift.sync_status === 'pending' || !(await isOnline())) {
                      Alert.alert(
                        'Uloženo offline',
                        'Poznámka byla uložena lokálně a čeká na synchronizaci.'
                      )
                    } else {
                      Alert.alert('Hotovo', 'Poznámka ke směně byla uložena.')
                    }
                  }
                }}
                disabled={savingShiftNote}
                style={{
                  backgroundColor: '#6b7280',
                  borderRadius: 12,
                  paddingVertical: 12,
                  alignItems: 'center',
                  marginBottom: 12,
                  opacity: savingShiftNote ? 0.6 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                  {savingShiftNote ? 'Ukládám poznámku...' : 'Uložit poznámku'}
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={shiftIsRunning ? endShift : startShift}
              disabled={savingShift || !profileId}
              style={{
                backgroundColor: shiftIsRunning ? '#dc2626' : '#111827',
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: 'center',
                opacity: savingShift || !profileId ? 0.6 : 1,
              }}
            >
              <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700' }}>
                {savingShift
                  ? 'Ukládám...'
                  : shiftIsRunning
                    ? 'Ukončit směnu'
                    : 'Začít směnu'}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>
          Dnešní zakázky
        </Text>

        {loadingJobs ? (
          <ActivityIndicator size="large" />
        ) : jobs.length === 0 ? (
          <Text style={{ fontSize: 15, color: '#666' }}>
            Dnes nemáš přiřazenou žádnou zakázku.
          </Text>
        ) : (
          <View style={{ gap: 12 }}>
            {jobs.map((job) => {
              const jobState = getAssignmentWorkState(job)
              const isSavingThisJob = savingJobId === job.assignmentId

              return (
                <View
                  key={job.assignmentId}
                  style={{
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    borderRadius: 14,
                    padding: 14,
                    backgroundColor: '#ffffff',
                  }}
                >
                  <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 6 }}>
                    {job.title ?? 'Zakázka'}
                  </Text>

                    <Text style={{ fontSize: 14, color: '#555', marginBottom: 4 }}>
                      {job.address ?? 'Bez adresy'}
                    </Text>

                  <Text style={{ fontSize: 14, color: '#555', marginBottom: 4 }}>
                    {formatDateTime(job.start_at)}
                  </Text>

                  <Text style={{ fontSize: 14, color: '#555', marginBottom: 4 }}>
                    {isMultiDayJob(job.start_at, job.end_at)
                      ? `Vícedenní: ano (${formatDateOnly(job.start_at)} – ${formatDateOnly(job.end_at)})`
                      : 'Vícedenní: ne'}
                  </Text>

                  <Text style={{ fontSize: 14, color: '#555', marginBottom: 12 }}>
                    Stav práce:{' '}
                    <Text style={{ fontWeight: '700' }}>
                      {jobState === 'completed'
                        ? 'Hotovo'
                        : jobState === 'started'
                          ? 'Probíhá'
                          : 'Nezahájeno'}
                    </Text>
                  </Text>

                  <View style={{ gap: 10 }}>
                    <Pressable
                        onPress={() => openJobDetail(job)}
                      style={{
                        backgroundColor: '#111827',
                        borderRadius: 12,
                        paddingVertical: 12,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                        Otevřít detail
                      </Text>
                    </Pressable>

                    {jobState === 'idle' && (
                      <Pressable
                        onPress={() => startJobWork(job.assignmentId)}
                        disabled={isSavingThisJob}
                        style={{
                          backgroundColor: '#2563eb',
                          borderRadius: 12,
                          paddingVertical: 14,
                          alignItems: 'center',
                          opacity: isSavingThisJob ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                          {isSavingThisJob ? 'Ukládám...' : 'Začít práci'}
                        </Text>
                      </Pressable>
                    )}

                    {jobState === 'started' && (
                      <Pressable
                        onPress={() => completeJobWork(job.assignmentId)}
                        disabled={isSavingThisJob}
                        style={{
                          backgroundColor: '#16a34a',
                          borderRadius: 12,
                          paddingVertical: 14,
                          alignItems: 'center',
                          opacity: isSavingThisJob ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                          {isSavingThisJob ? 'Ukládám...' : 'Hotovo'}
                        </Text>
                      </Pressable>
                    )}

                    {jobState === 'completed' && (
                      <View
                        style={{
                          backgroundColor: '#dcfce7',
                          borderRadius: 12,
                          paddingVertical: 14,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: '#166534', fontSize: 16, fontWeight: '700' }}>
                          Zakázka dokončena
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </View>

      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <Pressable
          onPress={() => setPayrollBoxOpen((prev) => !prev)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: '700' }}>Odměny a zálohy</Text>

          <Text style={{ fontSize: 22, fontWeight: '700', color: '#111827' }}>
            {payrollBoxOpen ? '−' : '+'}
          </Text>
        </Pressable>

        <Text style={{ fontSize: 14, color: '#555', marginTop: 10 }}>
          Přehled odpracovaných hodin, orientační odměny, záloh a dalších položek.
        </Text>

        {payrollBoxOpen && (
          <View style={{ marginTop: 16 }}>
            <View
              style={{
                backgroundColor: '#f9fafb',
                borderRadius: 12,
                padding: 12,
                marginBottom: 12,
              }}
            >
              <Text style={{ fontSize: 14, color: '#555', lineHeight: 22 }}>
                Tady najdeš přehled odměn za aktuální měsíc, zálohy, bonusy,
                příplatky, stravné, srážky a orientační zůstatek k vyplacení.
              </Text>
            </View>

            <Pressable
              onPress={() => router.push('/payroll')}
              style={{
                backgroundColor: '#111827',
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
                Otevřít přehled odměn
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 10 }}>
          Nepřítomnost
        </Text>

        <Text style={{ fontSize: 14, color: '#555', marginBottom: 14, lineHeight: 22 }}>
          Nahlášení plánované nebo akutní nepřítomnosti.
        </Text>

        <Pressable
          onPress={() => router.push('/absence')}
          style={{
            backgroundColor: '#111827',
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
            Otevřít nepřítomnost
          </Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push('/profile')}
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          padding: 16,
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: '700' }}>Otevřít profil</Text>
      </Pressable>
    </ScrollView>
  )
}

