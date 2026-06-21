import AsyncStorage from '@react-native-async-storage/async-storage'

export const OFFLINE_KEYS = {
  todayJobs: (dateKey: string) => `cache:today_jobs:${dateKey}`,
  activeShift: 'cache:active_shift',
  queue: 'queue:actions',
  sessionProfile: 'cache:session_profile',
  sessionMembership: 'cache:session_membership',
  jobDetail: (jobId: string) => `cache:job_detail:${jobId}`,
  jobChecklist: (jobId: string) => `cache:job_checklist:${jobId}`,
  jobPhotos: (jobId: string) => `cache:job_photos:${jobId}`,
  jobPhotoPickerContext: 'cache:job_photo_picker_context',
  jobPhotoUploadPreference: 'settings:job_photo_upload_preference',
}

export type PendingActionType =
  | 'start_shift'
  | 'end_shift'
  | 'save_shift_note'
  | 'start_job_work'
  | 'complete_job_work'
  | 'toggle_checklist_item'
  | 'upload_job_photo'

export type PendingActionStatus = 'pending' | 'syncing' | 'failed'

export type PendingAction = {
  id: string
  type: PendingActionType
  payload: Record<string, any>
  created_at: string
  status: PendingActionStatus
  retry_count?: number
  last_error?: string | null
}

export type QueueSummary = {
  total: number
  pending: number
  syncing: number
  failed: number
  latestFailedError: string | null
  latestFailedRetryCount: number
}

function createActionId() {
  return `action_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function normalizeLastError(value: unknown) {
  if (!value) return null

  if (typeof value === 'string') {
    return value === '[object Object]' ? 'Neznámá chyba synchronizace.' : value
  }

  if (value && typeof value === 'object') {
    const item = value as Record<string, any>
    const parts = [
      item.message,
      item.error_description,
      item.details,
      item.hint,
      item.code ? `kód ${item.code}` : null,
      item.status ? `HTTP ${item.status}` : null,
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)

    if (parts.length > 0) {
      return parts.join(' | ')
    }
  }

  return 'Neznámá chyba synchronizace.'
}

function normalizePendingAction(action: any): PendingAction | null {
  if (!action || typeof action !== 'object') return null
  if (typeof action.id !== 'string') return null
  if (typeof action.type !== 'string') return null
  if (typeof action.created_at !== 'string') return null

  const status: PendingActionStatus =
    action.status === 'syncing' || action.status === 'failed' ? action.status : 'pending'

  return {
    id: action.id,
    type: action.type as PendingActionType,
    payload:
      action.payload && typeof action.payload === 'object' ? action.payload : {},
    created_at: action.created_at,
    status,
    retry_count: Number.isFinite(action.retry_count) ? Number(action.retry_count) : 0,
    last_error: normalizeLastError(action.last_error),
  }
}

export async function setCacheItem<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error('offline.setCacheItem error', { key, error })
  }
}

export async function getCacheItem<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key)

    if (!raw) return null

    return JSON.parse(raw) as T
  } catch (error) {
    console.error('offline.getCacheItem error', { key, error })
    return null
  }
}

export async function removeCacheItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key)
  } catch (error) {
    console.error('offline.removeCacheItem error', { key, error })
  }
}

export async function getQueue(): Promise<PendingAction[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_KEYS.queue)

    if (!raw) return []

    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) return []

    return parsed
      .map((item) => normalizePendingAction(item))
      .filter((item): item is PendingAction => item !== null)
  } catch (error) {
    console.error('offline.getQueue error', error)
    return []
  }
}

export async function setQueue(queue: PendingAction[]): Promise<void> {
  try {
    await AsyncStorage.setItem(OFFLINE_KEYS.queue, JSON.stringify(queue))
  } catch (error) {
    console.error('offline.setQueue error', error)
  }
}

export async function clearQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(OFFLINE_KEYS.queue)
  } catch (error) {
    console.error('offline.clearQueue error', error)
  }
}

export async function addPendingAction(
  type: PendingActionType,
  payload: Record<string, any>
): Promise<PendingAction> {
  const currentQueue = await getQueue()

  const newAction: PendingAction = {
    id: createActionId(),
    type,
    payload,
    created_at: new Date().toISOString(),
    status: 'pending',
    retry_count: 0,
    last_error: null,
  }

  const nextQueue = [...currentQueue, newAction]
  await setQueue(nextQueue)

  return newAction
}

export async function updatePendingAction(
  actionId: string,
  updates: Partial<PendingAction>
): Promise<void> {
  const currentQueue = await getQueue()

  const nextQueue = currentQueue.map((action) =>
    action.id === actionId
      ? {
          ...action,
          ...updates,
        }
      : action
  )

  await setQueue(nextQueue)
}

export async function removePendingAction(actionId: string): Promise<void> {
  const currentQueue = await getQueue()
  const nextQueue = currentQueue.filter((action) => action.id !== actionId)
  await setQueue(nextQueue)
}

export async function getPendingActionsCount(): Promise<number> {
  const queue = await getQueue()
  return queue.filter((item) => item.status === 'pending').length
}

export async function getQueueSummary(): Promise<QueueSummary> {
  const queue = await getQueue()

  return {
    total: queue.length,
    pending: queue.filter((item) => item.status === 'pending').length,
    syncing: queue.filter((item) => item.status === 'syncing').length,
    failed: queue.filter((item) => item.status === 'failed').length,
    latestFailedError:
      [...queue]
        .reverse()
        .find((item) => item.status === 'failed' && item.last_error)?.last_error ?? null,
    latestFailedRetryCount:
      [...queue]
        .reverse()
        .find((item) => item.status === 'failed')?.retry_count ?? 0,
  }
}

export async function getNextPendingAction(): Promise<PendingAction | null> {
  const queue = await getQueue()

  const sorted = [...queue].sort((a, b) => {
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  const next = sorted.find((item) => item.status === 'pending')

  return next ?? null
}

export async function retryRetriableFailedActions(maxRetryCount = 3): Promise<void> {
  const currentQueue = await getQueue()

  const nextQueue = currentQueue.map((action) => {
    if (action.status !== 'failed') return action
    if ((action.retry_count ?? 0) >= maxRetryCount) return action

    return {
      ...action,
      status: 'pending' as PendingActionStatus,
    }
  })

  await setQueue(nextQueue)
}

export async function resetSyncingActionsToPending(): Promise<void> {
  const currentQueue = await getQueue()

  const nextQueue = currentQueue.map((action) =>
    action.status === 'syncing'
      ? {
          ...action,
          status: 'pending' as PendingActionStatus,
        }
      : action
  )

  await setQueue(nextQueue)
}

export async function resetFailedActionsToPending(): Promise<void> {
  const currentQueue = await getQueue()

  const nextQueue = currentQueue.map((action) =>
    action.status === 'failed'
      ? {
          ...action,
          status: 'pending' as PendingActionStatus,
          retry_count: 0,
          last_error: null,
        }
      : action
  )

  await setQueue(nextQueue)
}
