import * as FileSystem from 'expo-file-system/legacy'
import * as ImageManipulator from 'expo-image-manipulator'
import type { ImagePickerAsset } from 'expo-image-picker'
import { OFFLINE_KEYS, getCacheItem, setCacheItem } from './offline'
import type { JobPhotoQueuePayload, JobPhotoRecord, JobPhotoType } from '../types/jobPhotos'

const JOB_PHOTO_BUCKET = 'job-photos'
const DISPLAY_TARGET_BYTES = 550 * 1024
const THUMB_TARGET_WIDTH = 320

function createId(prefix: string) {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now()}_${randomPart}`
}

function createUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function getOriginalExtension(asset: ImagePickerAsset) {
  const fileName = asset.fileName ?? ''
  const match = fileName.match(/\.([a-zA-Z0-9]+)$/)

  if (match?.[1]) {
    return match[1].toLowerCase()
  }

  if (asset.mimeType?.includes('/')) {
    return asset.mimeType.split('/')[1]?.toLowerCase() ?? 'jpg'
  }

  return 'jpg'
}

function getPhotoBaseDirectory() {
  const documentDirectory = FileSystem.documentDirectory

  if (!documentDirectory) {
    throw new Error('Aplikace nemá dostupný documentDirectory pro ukládání fotek.')
  }

  return `${documentDirectory}job-photos`
}

async function ensureDirectory(path: string) {
  const info = await FileSystem.getInfoAsync(path)

  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, {
      intermediates: true,
    })
  }
}

async function getFileSize(uri: string) {
  const info = await FileSystem.getInfoAsync(uri)

  if (!info.exists) {
    throw new Error(`Soubor neexistuje: ${uri}`)
  }

  return typeof info.size === 'number' ? info.size : 0
}

async function createDisplayVariant(sourceUri: string) {
  const attempts = [
    { width: 1800, compress: 0.72 },
    { width: 1600, compress: 0.66 },
    { width: 1440, compress: 0.58 },
    { width: 1280, compress: 0.5 },
    { width: 1080, compress: 0.42 },
  ]

  let latestUri = sourceUri

  for (const attempt of attempts) {
    const result = await ImageManipulator.manipulateAsync(
      sourceUri,
      [
        {
          resize: {
            width: attempt.width,
          },
        },
      ],
      {
        compress: attempt.compress,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    )

    latestUri = result.uri

    const size = await getFileSize(result.uri)

    if (size <= DISPLAY_TARGET_BYTES) {
      return {
        uri: result.uri,
        sizeBytes: size,
      }
    }
  }

  return {
    uri: latestUri,
    sizeBytes: await getFileSize(latestUri),
  }
}

async function createThumbVariant(sourceUri: string) {
  const result = await ImageManipulator.manipulateAsync(
    sourceUri,
    [
      {
        resize: {
          width: THUMB_TARGET_WIDTH,
        },
      },
    ],
    {
      compress: 0.42,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  )

  return {
    uri: result.uri,
    sizeBytes: await getFileSize(result.uri),
  }
}

async function persistVariant(fromUri: string, targetUri: string) {
  await FileSystem.copyAsync({
    from: fromUri,
    to: targetUri,
  })
}

export async function getJobPhotoRecords(jobId: string): Promise<JobPhotoRecord[]> {
  return (await getCacheItem<JobPhotoRecord[]>(OFFLINE_KEYS.jobPhotos(jobId))) ?? []
}

export async function setJobPhotoRecords(
  jobId: string,
  records: JobPhotoRecord[]
): Promise<void> {
  await setCacheItem(OFFLINE_KEYS.jobPhotos(jobId), records)
}

export async function updateJobPhotoRecord(
  jobId: string,
  localId: string,
  updates: Partial<JobPhotoRecord>
) {
  const records = await getJobPhotoRecords(jobId)

  const nextRecords = records.map((record) =>
    record.localId === localId
      ? {
          ...record,
          ...updates,
        }
      : record
  )

  await setJobPhotoRecords(jobId, nextRecords)
}

export async function createJobPhotoFromAsset(params: {
  companyId: string
  jobId: string
  uploadedByProfileId?: string | null
  photoType: JobPhotoType
  asset: ImagePickerAsset
}) {
  const { companyId, jobId, uploadedByProfileId, photoType, asset } = params

  if (!asset.uri) {
    throw new Error('Vybraná fotka nemá lokální URI.')
  }

  if (asset.type && asset.type !== 'image') {
    throw new Error('Vybraný soubor není fotka.')
  }

  const photoId = createUuid()
  const localId = createId('job_photo')
  const createdAt = new Date().toISOString()
  const takenAt = createdAt

  const baseDirectory = `${getPhotoBaseDirectory()}/${jobId}/${localId}`
  const originalDirectory = `${baseDirectory}/original`
  const displayDirectory = `${baseDirectory}/display`
  const thumbDirectory = `${baseDirectory}/thumb`

  await ensureDirectory(originalDirectory)
  await ensureDirectory(displayDirectory)
  await ensureDirectory(thumbDirectory)

  const originalExtension = getOriginalExtension(asset)
  const originalFileName = `original.${originalExtension}`
  const displayFileName = `${photoId}.jpg`
  const thumbFileName = `${photoId}.jpg`

  const localOriginalUri = `${originalDirectory}/${originalFileName}`
  const localDisplayUri = `${displayDirectory}/${displayFileName}`
  const localThumbUri = `${thumbDirectory}/${thumbFileName}`

  await FileSystem.copyAsync({
    from: asset.uri,
    to: localOriginalUri,
  })

  const displayVariant = await createDisplayVariant(localOriginalUri)
  const thumbVariant = await createThumbVariant(localOriginalUri)

  await persistVariant(displayVariant.uri, localDisplayUri)
  await persistVariant(thumbVariant.uri, localThumbUri)

  const fileName = sanitizeFileName(
    `${(asset.fileName ?? photoId).replace(/\.[^.]+$/, '')}.jpg`
  )
  const storagePath = `${jobId}/${photoType}/display/${photoId}.jpg`
  const thumbStoragePath = `${jobId}/${photoType}/thumb/${photoId}.jpg`

  const record: JobPhotoRecord = {
    id: photoId,
    localId,
    companyId,
    jobId,
    uploadedByProfileId: uploadedByProfileId ?? null,
    photoType,
    fileName,
    mimeType: 'image/jpeg',
    takenAt,
    createdAt,
    localOriginalUri,
    localDisplayUri,
    localThumbUri,
    storagePath,
    thumbStoragePath,
    sizeBytes: await getFileSize(localDisplayUri),
    thumbSizeBytes: await getFileSize(localThumbUri),
    uploadStatus: 'local_only',
    uploadedAt: null,
    errorMessage: null,
  }

  const currentRecords = await getJobPhotoRecords(jobId)
  await setJobPhotoRecords(jobId, [record, ...currentRecords])

  const queuePayload: JobPhotoQueuePayload = {
    photo_id: record.id,
    local_id: record.localId,
    company_id: record.companyId,
    job_id: record.jobId,
    uploaded_by: record.uploadedByProfileId ?? null,
    photo_type: record.photoType,
    file_name: record.fileName,
    mime_type: record.mimeType,
    taken_at: record.takenAt,
    created_at: record.createdAt,
    local_display_uri: record.localDisplayUri,
    local_thumb_uri: record.localThumbUri,
    storage_path: record.storagePath,
    thumb_storage_path: record.thumbStoragePath,
    size_bytes: record.sizeBytes,
    thumb_size_bytes: record.thumbSizeBytes,
  }

  return {
    record,
    queuePayload,
    bucket: JOB_PHOTO_BUCKET,
  }
}

export function groupJobPhotoRecords(records: JobPhotoRecord[]) {
  return {
    before: records.filter((record) => record.photoType === 'before'),
    after: records.filter((record) => record.photoType === 'after'),
  }
}

export async function removeJobPhotoRecord(jobId: string, localId: string): Promise<void> {
  const records = await getJobPhotoRecords(jobId)
  const nextRecords = records.filter((record) => record.localId !== localId)
  await setJobPhotoRecords(jobId, nextRecords)
}
