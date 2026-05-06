export type JobPhotoType = 'before' | 'after'

export type JobPhotoUploadStatus =
  | 'local_only'
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'failed'

export type JobPhotoRecord = {
  id: string
  localId: string
  companyId: string
  jobId: string
  photoType: JobPhotoType
  fileName: string
  mimeType: string
  takenAt: string
  createdAt: string
  localOriginalUri: string
  localDisplayUri: string
  localThumbUri: string
  storagePath: string
  thumbStoragePath: string
  sizeBytes: number
  thumbSizeBytes: number
  uploadStatus: JobPhotoUploadStatus
  uploadedAt?: string | null
  errorMessage?: string | null
}

export type JobPhotoQueuePayload = {
  photo_id: string
  local_id: string
  company_id: string
  job_id: string
  photo_type: JobPhotoType
  file_name: string
  mime_type: string
  taken_at: string
  created_at: string
  local_display_uri: string
  local_thumb_uri: string
  storage_path: string
  thumb_storage_path: string
  size_bytes: number
  thumb_size_bytes: number
}
