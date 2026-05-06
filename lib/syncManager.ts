import NetInfo from '@react-native-community/netinfo'
import * as FileSystem from 'expo-file-system/legacy'
import {
  getQueue,
  removePendingAction,
  resetSyncingActionsToPending,
  retryRetriableFailedActions,
  setQueue,
  updatePendingAction,
  type PendingAction,
} from './offline'
import { canUploadJobPhotosNow } from './jobPhotoNet'
import { updateJobPhotoRecord } from './jobPhotoStorage'
import { supabase } from './supabase'

let isSyncRunning = false
const MAX_ACTION_RETRY_COUNT = 3

function base64ToArrayBuffer(base64: string) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const sanitized = base64.replace(/[^A-Za-z0-9+/=]/g, '')
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0
  const outputLength = Math.floor((sanitized.length * 3) / 4) - padding
  const bytes = new Uint8Array(outputLength)

  let byteIndex = 0

  for (let i = 0; i < sanitized.length; i += 4) {
    const encoded1 = chars.indexOf(sanitized[i] ?? 'A')
    const encoded2 = chars.indexOf(sanitized[i + 1] ?? 'A')
    const encoded3 = sanitized[i + 2] === '=' ? 64 : chars.indexOf(sanitized[i + 2] ?? 'A')
    const encoded4 = sanitized[i + 3] === '=' ? 64 : chars.indexOf(sanitized[i + 3] ?? 'A')

    const chunk =
      (encoded1 << 18) |
      (encoded2 << 12) |
      ((encoded3 & 63) << 6) |
      (encoded4 & 63)

    bytes[byteIndex++] = (chunk >> 16) & 0xff

    if (encoded3 !== 64 && byteIndex < outputLength + 1) {
      bytes[byteIndex++] = (chunk >> 8) & 0xff
    }

    if (encoded4 !== 64 && byteIndex < outputLength + 1) {
      bytes[byteIndex++] = chunk & 0xff
    }
  }

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

async function createUploadBody(uri: string) {
  const info = await FileSystem.getInfoAsync(uri)

  if (!info.exists) {
    throw new Error('Lokální soubor pro upload neexistuje.')
  }

  if (!info.size) {
    throw new Error('Lokální soubor pro upload je prázdný (0 kB).')
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  })

  if (!base64) {
    throw new Error('Lokální soubor pro upload se nepodařilo načíst.')
  }

  const buffer = base64ToArrayBuffer(base64)

  if (!buffer.byteLength) {
    throw new Error('Lokální soubor pro upload je po načtení prázdný.')
  }

  return buffer
}

async function isOnline() {
  const state = await NetInfo.fetch()
  return !!state.isConnected
}

async function getNextProcessableAction(): Promise<PendingAction | null> {
  const queue = await getQueue()
  const canUploadPhotos = await canUploadJobPhotosNow()

  const sorted = [...queue].sort((a, b) => {
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })

  const nextAction = sorted.find((item) => {
    if (item.status !== 'pending') return false
    if (item.type !== 'upload_job_photo') return true
    return canUploadPhotos
  })

  return nextAction ?? null
}

async function replaceLocalShiftIdInQueue(
  localShiftId: string,
  serverShiftId: string
) {
  const queue = await getQueue()

  const nextQueue = queue.map((action) => {
    if (!action?.payload) return action

    if (action.payload.local_shift_id === localShiftId) {
      return {
        ...action,
        payload: {
          ...action.payload,
          local_shift_id: serverShiftId,
        },
      }
    }

    return action
  })

  await setQueue(nextQueue)
}

async function processStartShift(action: PendingAction) {
  const {
    local_shift_id,
    profile_id,
    company_id,
    shift_date,
    started_at,
  } = action.payload ?? {}

  if (!profile_id || !shift_date || !started_at) {
    throw new Error('Neplatná data pro start_shift.')
  }

  const { data, error } = await supabase
    .from('work_shifts')
    .insert({
      profile_id,
      company_id: company_id ?? null,
      shift_date,
      started_at,
      ended_at: null,
    })
    .select('id')
    .single()

  if (error) {
    throw error
  }

  const serverShiftId = data?.id

  if (!serverShiftId) {
    throw new Error('Server nevrátil id nové směny.')
  }

  if (
    local_shift_id &&
    typeof local_shift_id === 'string' &&
    local_shift_id.startsWith('local_shift_')
  ) {
    await replaceLocalShiftIdInQueue(local_shift_id, serverShiftId)
  }
}

async function processSaveShiftNote(action: PendingAction) {
  const { local_shift_id, note } = action.payload ?? {}

  if (!local_shift_id) {
    throw new Error('Chybí local_shift_id pro save_shift_note.')
  }

  if (String(local_shift_id).startsWith('local_shift_')) {
    throw new Error(
      'save_shift_note stále odkazuje na local_shift_id. Start směny se zřejmě ještě nesynchronizoval.'
    )
  }

  const { error } = await supabase
    .from('work_shifts')
    .update({
      note: note ?? null,
    })
    .eq('id', local_shift_id)

  if (error) {
    throw error
  }
}

async function processEndShift(action: PendingAction) {
  const { local_shift_id, ended_at } = action.payload ?? {}

  if (!local_shift_id || !ended_at) {
    throw new Error('Neplatná data pro end_shift.')
  }

  if (String(local_shift_id).startsWith('local_shift_')) {
    throw new Error(
      'end_shift stále odkazuje na local_shift_id. Start směny se zřejmě ještě nesynchronizoval.'
    )
  }

  const { error } = await supabase
    .from('work_shifts')
    .update({
      ended_at,
    })
    .eq('id', local_shift_id)

  if (error) {
    throw error
  }
}

async function processStartJobWork(action: PendingAction) {
  const { assignment_id, profile_id, started_at } = action.payload ?? {}

  if (!assignment_id || !profile_id || !started_at) {
    throw new Error('Neplatná data pro start_job_work.')
  }

  const { error } = await supabase
    .from('job_assignments')
    .update({
      work_started_at: started_at,
      work_completed_at: null,
    })
    .eq('id', assignment_id)
    .eq('profile_id', profile_id)

  if (error) {
    throw error
  }
}

async function processCompleteJobWork(action: PendingAction) {
  const { assignment_id, profile_id, completed_at } = action.payload ?? {}

  if (!assignment_id || !profile_id || !completed_at) {
    throw new Error('Neplatná data pro complete_job_work.')
  }

  const { error } = await supabase
    .from('job_assignments')
    .update({
      work_completed_at: completed_at,
    })
    .eq('id', assignment_id)
    .eq('profile_id', profile_id)

  if (error) {
    throw error
  }
}

async function processToggleChecklistItem(action: PendingAction) {
  const { item_id, next_value } = action.payload ?? {}

  if (!item_id || typeof next_value !== 'boolean') {
    throw new Error('Neplatná data pro toggle_checklist_item.')
  }

  const { error } = await supabase
    .from('job_checklist_items')
    .update({
      is_done: next_value,
    })
    .eq('id', item_id)

  if (error) {
    throw error
  }
}

async function processUploadJobPhoto(action: PendingAction) {
  const {
    photo_id,
    local_id,
    company_id,
    job_id,
    photo_type,
    file_name,
    mime_type,
    taken_at,
    created_at,
    local_display_uri,
    local_thumb_uri,
    storage_path,
    thumb_storage_path,
    size_bytes,
    thumb_size_bytes,
  } = action.payload ?? {}

  if (
    !photo_id ||
    !local_id ||
    !company_id ||
    !job_id ||
    !photo_type ||
    !local_display_uri ||
    !local_thumb_uri ||
    !storage_path ||
    !thumb_storage_path ||
    !taken_at
  ) {
    throw new Error('Neplatná data pro upload_job_photo.')
  }

  await updateJobPhotoRecord(job_id, local_id, {
    uploadStatus: 'uploading',
    errorMessage: null,
  })

  const displayBody = await createUploadBody(local_display_uri)
  const thumbBody = await createUploadBody(local_thumb_uri)

  const { error: displayError } = await supabase.storage
    .from('job-photos')
    .upload(storage_path, displayBody, {
      upsert: true,
      contentType: mime_type ?? 'image/jpeg',
    })

  if (displayError) {
    throw displayError
  }

  const { error: thumbError } = await supabase.storage
    .from('job-photos')
    .upload(thumb_storage_path, thumbBody, {
      upsert: true,
      contentType: mime_type ?? 'image/jpeg',
    })

  if (thumbError) {
    throw thumbError
  }

  const { error: rowError } = await supabase.from('job_photos').upsert(
    {
      id: photo_id,
      company_id,
      job_id,
      photo_type,
      storage_path,
      thumb_storage_path,
      file_name: file_name ?? `${photo_id}.jpg`,
      mime_type: mime_type ?? 'image/jpeg',
      size_bytes: size_bytes ?? 0,
      thumb_size_bytes: thumb_size_bytes ?? 0,
      taken_at,
      created_at: created_at ?? new Date().toISOString(),
    },
    {
      onConflict: 'id',
    }
  )

  if (rowError) {
    throw rowError
  }

  await updateJobPhotoRecord(job_id, local_id, {
    uploadStatus: 'uploaded',
    uploadedAt: new Date().toISOString(),
    errorMessage: null,
  })
}

async function processAction(action: PendingAction) {
  switch (action.type) {
    case 'start_shift':
      await processStartShift(action)
      return

    case 'save_shift_note':
      await processSaveShiftNote(action)
      return

    case 'end_shift':
      await processEndShift(action)
      return

    case 'start_job_work':
      await processStartJobWork(action)
      return

    case 'complete_job_work':
      await processCompleteJobWork(action)
      return

    case 'toggle_checklist_item':
      await processToggleChecklistItem(action)
      return

    case 'upload_job_photo':
      await processUploadJobPhoto(action)
      return

    default:
      throw new Error(`Neznámý typ akce: ${action.type}`)
  }
}

export async function syncPendingActions() {
  if (isSyncRunning) return

  const online = await isOnline()
  if (!online) return

  isSyncRunning = true

  try {
    await resetSyncingActionsToPending()
    await retryRetriableFailedActions(MAX_ACTION_RETRY_COUNT)

    while (true) {
      const nextAction = await getNextProcessableAction()

      if (!nextAction) {
        break
      }

      await updatePendingAction(nextAction.id, {
        status: 'syncing',
      })

      try {
        await processAction(nextAction)
        await removePendingAction(nextAction.id)
      } catch (error) {
        console.error('SYNC_ACTION_ERROR', nextAction.type, error)

        if (nextAction.type === 'upload_job_photo') {
          const { job_id, local_id } = nextAction.payload ?? {}

          if (job_id && local_id) {
            await updateJobPhotoRecord(job_id, local_id, {
              uploadStatus: 'failed',
              errorMessage: error instanceof Error ? error.message : String(error),
            })
          }
        }

        await updatePendingAction(nextAction.id, {
          status: 'failed',
          retry_count: (nextAction.retry_count ?? 0) + 1,
          last_error: error instanceof Error ? error.message : String(error),
        })

        break
      }
    }
  } finally {
    isSyncRunning = false
  }
}
