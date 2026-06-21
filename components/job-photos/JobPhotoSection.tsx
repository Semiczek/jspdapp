import * as ImagePicker from 'expo-image-picker'
import { Image } from 'expo-image'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import {
  OFFLINE_KEYS,
  addPendingAction,
  getCacheItem,
  removeCacheItem,
  setCacheItem,
} from '../../lib/offline'
import {
  canUploadJobPhotosNow,
  getJobPhotoUploadPreference,
  setJobPhotoUploadPreference,
  type JobPhotoUploadPreference,
} from '../../lib/jobPhotoNet'
import {
  createJobPhotoFromAsset,
  getJobPhotoRecords,
  groupJobPhotoRecords,
  removeJobPhotoRecord,
  updateJobPhotoRecord,
} from '../../lib/jobPhotoStorage'
import { syncPendingActions } from '../../lib/syncManager'
import type { JobPhotoRecord, JobPhotoType } from '../../types/jobPhotos'

type JobPhotoSectionProps = {
  companyId: string
  jobId: string
  uploadedByProfileId?: string | null
  syncTick?: number
  onPhotosChanged?: () => Promise<void> | void
}

type PendingPickerContext = {
  jobId: string
  photoType: JobPhotoType
  source: 'camera' | 'library'
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatStatusLabel(record: JobPhotoRecord) {
  switch (record.uploadStatus) {
    case 'uploaded':
      return 'Nahráno'
    case 'uploading':
      return 'Právě se nahrává'
    case 'failed':
      return 'Chyba uploadu'
    case 'queued':
      return 'Čeká na Wi-Fi upload'
    default:
      return 'Uloženo lokálně'
  }
}

function formatTakenAt(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getUploadPreferenceHint(preference: JobPhotoUploadPreference) {
  return preference === 'wifi_or_cellular'
    ? 'Upload poběží při Wi-Fi i mobilních datech.'
    : 'Upload poběží jen na Wi-Fi.'
}

export function JobPhotoSection({
  companyId,
  jobId,
  uploadedByProfileId = null,
  syncTick = 0,
  onPhotosChanged,
}: JobPhotoSectionProps) {
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<JobPhotoRecord[]>([])
  const [addingType, setAddingType] = useState<JobPhotoType | null>(null)
  const [viewerPhoto, setViewerPhoto] = useState<JobPhotoRecord | null>(null)
  const [uploadPreference, setUploadPreferenceState] =
    useState<JobPhotoUploadPreference>('wifi_only')

  const refreshRecords = useCallback(async () => {
    setLoading(true)

    try {
      const nextRecords = await getJobPhotoRecords(jobId)
      setRecords(nextRecords)
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    refreshRecords()
  }, [refreshRecords, syncTick])

  useEffect(() => {
    let active = true

    async function loadUploadPreference() {
      const value = await getJobPhotoUploadPreference()

      if (active) {
        setUploadPreferenceState(value)
      }
    }

    loadUploadPreference()

    return () => {
      active = false
    }
  }, [])

  const groupedPhotos = useMemo(() => {
    return groupJobPhotoRecords(records)
  }, [records])

  const persistPickerContext = useCallback(
    async (photoType: JobPhotoType, source: 'camera' | 'library') => {
      await setCacheItem<PendingPickerContext>(OFFLINE_KEYS.jobPhotoPickerContext, {
        jobId,
        photoType,
        source,
      })
    },
    [jobId]
  )

  const clearPickerContext = useCallback(async () => {
    await removeCacheItem(OFFLINE_KEYS.jobPhotoPickerContext)
  }, [])

  const maybeRunSync = useCallback(async () => {
    const canUploadNow = await canUploadJobPhotosNow()

    if (!canUploadNow) {
      return false
    }

    try {
      await syncPendingActions()
      await refreshRecords()
      await onPhotosChanged?.()
      return true
    } catch (error) {
      console.error('JOB_PHOTO_SYNC_ERROR', error)
      return false
    }
  }, [onPhotosChanged, refreshRecords])

  const handleUploadPreferenceChange = useCallback(
    async (value: JobPhotoUploadPreference) => {
      setUploadPreferenceState(value)
      await setJobPhotoUploadPreference(value)

      if (value === 'wifi_or_cellular') {
        await maybeRunSync()
      }
    },
    [maybeRunSync]
  )

  async function ensureCameraPermission() {
    const permission = await ImagePicker.requestCameraPermissionsAsync()

    if (!permission.granted) {
      Alert.alert('Přístup zamítnut', 'Bez přístupu ke kameře nepůjde pořídit fotku.')
      return false
    }

    return true
  }

  async function ensureMediaLibraryPermission() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (!permission.granted) {
      Alert.alert(
        'Přístup zamítnut',
        'Bez přístupu ke galerii nepůjde vybrat existující fotku.'
      )
      return false
    }

    return true
  }

  const persistPickedAsset = useCallback(
    async (photoType: JobPhotoType, asset: ImagePicker.ImagePickerAsset) => {
      const { record, queuePayload } = await createJobPhotoFromAsset({
        companyId,
        jobId,
        uploadedByProfileId,
        photoType,
        asset,
      })

      try {
        await updateJobPhotoRecord(jobId, record.localId, {
          uploadStatus: 'queued',
          errorMessage: null,
        })

        await addPendingAction('upload_job_photo', queuePayload)
        await refreshRecords()
        await onPhotosChanged?.()

        const syncedNow = await maybeRunSync()

        if (syncedNow) {
          Alert.alert('Hotovo', 'Fotka byla uložena a odeslána do cloudu.')
          return
        }

        Alert.alert('Uloženo', 'Fotka byla uložena do telefonu a čeká na upload přes Wi-Fi.')
      } catch (error) {
        console.error('JOB_PHOTO_PERSIST_ERROR', error)

        await removeJobPhotoRecord(jobId, record.localId)
        await refreshRecords()

        throw error
      }
    },
    [companyId, jobId, maybeRunSync, onPhotosChanged, refreshRecords, uploadedByProfileId]
  )

  const handlePickerResult = useCallback(
    async (
      result: ImagePicker.ImagePickerResult | ImagePicker.ImagePickerErrorResult | null,
      fallbackPhotoType?: JobPhotoType
    ) => {
      if (!result) {
        console.error('JOB_PHOTO_INVALID_RESULT', {
          reason: 'result_is_null',
          jobId,
          fallbackPhotoType,
        })
        await clearPickerContext()
        Alert.alert('Chyba', 'Galerie nevrátila žádný výsledek.')
        throw new Error('Galerie nevrátila žádný výsledek.')
      }

      if ('code' in result) {
        throw new Error(result.message || 'Výběr fotky skončil chybou.')
      }

      if (result.canceled) {
        await clearPickerContext()
        return
      }

      const asset = result.assets?.[0]

      if (!asset) {
        await clearPickerContext()
        throw new Error('Galerie nevrátila žádnou fotku.')
      }

      const context = await getCacheItem<PendingPickerContext>(OFFLINE_KEYS.jobPhotoPickerContext)
      const resolvedPhotoType =
        fallbackPhotoType ?? (context?.jobId === jobId ? context.photoType : undefined)

      if (!resolvedPhotoType) {
        await clearPickerContext()
        throw new Error('Chybí kontext pro uložení vybrané fotky.')
      }

      console.error('JOB_PHOTO_PERSIST_START', {
        jobId,
        resolvedPhotoType,
        assetUri: asset.uri,
        fileName: asset.fileName ?? null,
        mimeType: asset.mimeType ?? null,
      })
      await persistPickedAsset(resolvedPhotoType, asset)
      await clearPickerContext()
    },
    [clearPickerContext, jobId, persistPickedAsset]
  )

  const resolvePickerResult = useCallback(
    async (
      immediateResult: ImagePicker.ImagePickerResult,
      photoType: JobPhotoType
    ): Promise<ImagePicker.ImagePickerResult | ImagePicker.ImagePickerErrorResult | null> => {
      if (immediateResult.canceled || immediateResult.assets?.[0]) {
        return immediateResult
      }

      if (Platform.OS !== 'android') {
        return immediateResult
      }

      for (const delayMs of [150, 400, 900]) {
        await wait(delayMs)

        const pendingResult = await ImagePicker.getPendingResultAsync()

        if (!pendingResult) {
          continue
        }

        const context = await getCacheItem<PendingPickerContext>(
          OFFLINE_KEYS.jobPhotoPickerContext
        )

        if (!context || context.jobId !== jobId || context.photoType !== photoType) {
          continue
        }

        return pendingResult
      }

      return immediateResult
    },
    [jobId]
  )

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return
    }

    let active = true

    async function restorePendingPickerResult() {
      try {
        const pending = await ImagePicker.getPendingResultAsync()

        if (!active || !pending) {
          return
        }

        const context = await getCacheItem<PendingPickerContext>(
          OFFLINE_KEYS.jobPhotoPickerContext
        )

        if (!context || context.jobId !== jobId) {
          return
        }

        setAddingType(context.photoType)
        await handlePickerResult(pending, context.photoType)
      } catch (error) {
        console.error('JOB_PHOTO_PENDING_RESULT_ERROR', error)
        Alert.alert(
          'Chyba',
          error instanceof Error ? error.message : 'Obnovení vybrané fotky se nepodařilo.'
        )
      } finally {
        if (active) {
          setAddingType(null)
        }
      }
    }

    restorePendingPickerResult()

    return () => {
      active = false
    }
  }, [handlePickerResult, jobId])

  async function handleCamera(photoType: JobPhotoType) {
    if (addingType) return

    const granted = await ensureCameraPermission()

    if (!granted) {
      return
    }

    setAddingType(photoType)

    try {
      await persistPickerContext(photoType, 'camera')

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
      })

      const resolvedResult = await resolvePickerResult(result, photoType)

      if (
        !resolvedResult ||
        (!('code' in resolvedResult) &&
          !resolvedResult.canceled &&
          !resolvedResult.assets?.[0])
      ) {
        console.error('JOB_PHOTO_CAMERA_INVALID_ASSET_AFTER_RECOVERY', {
          jobId,
          photoType,
          result,
          resolvedResult,
        })
        await clearPickerContext()
        Alert.alert('Chyba', 'Po pořízení fotky nebyl vrácen platný obrázek.')
        return
      }

      await handlePickerResult(resolvedResult, photoType)
    } catch (error) {
      console.error('JOB_PHOTO_CAMERA_ERROR', error)
      await clearPickerContext()
      Alert.alert(
        'Chyba',
        error instanceof Error ? error.message : 'Pořízení fotky se nepodařilo.'
      )
    } finally {
      setAddingType(null)
    }
  }

  async function handleLibrary(photoType: JobPhotoType) {
    if (addingType) return

    const granted = await ensureMediaLibraryPermission()

    if (!granted) {
      return
    }

    setAddingType(photoType)

    try {
      await persistPickerContext(photoType, 'library')

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
      })

      const resolvedResult = await resolvePickerResult(result, photoType)

      if (
        !resolvedResult ||
        (!('code' in resolvedResult) &&
          !resolvedResult.canceled &&
          !resolvedResult.assets?.[0])
      ) {
        console.error('JOB_PHOTO_LIBRARY_INVALID_ASSET_AFTER_RECOVERY', {
          jobId,
          photoType,
          result,
          resolvedResult,
        })
        await clearPickerContext()
        Alert.alert('Chyba', 'Po výběru z galerie nebyla vrácena platná fotka.')
        return
      }

      await handlePickerResult(resolvedResult, photoType)
    } catch (error) {
      console.error('JOB_PHOTO_LIBRARY_ERROR', error)
      await clearPickerContext()
      Alert.alert(
        'Chyba',
        error instanceof Error ? error.message : 'Výběr fotky z galerie se nepodařil.'
      )
    } finally {
      setAddingType(null)
    }
  }

  function renderPhotoGroup(title: string, photoType: JobPhotoType, items: JobPhotoRecord[]) {
    const isBusy = addingType === photoType

    return (
      <View
        style={{
          backgroundColor: '#f9fafb',
          borderRadius: 14,
          padding: 14,
        }}
      >
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 8 }}>
          {title}
        </Text>

        <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 12, lineHeight: 20 }}>
          Originál zůstává v telefonu. Do cloudu jde komprimovaná verze a upload čeká na Wi-Fi.
        </Text>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
          <Pressable
            onPress={() => handleCamera(photoType)}
            disabled={isBusy}
            style={{
              flex: 1,
              backgroundColor: '#111827',
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: 'center',
              opacity: isBusy ? 0.6 : 1,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
              {isBusy ? 'Zpracovávám...' : 'Vyfotit'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => handleLibrary(photoType)}
            disabled={isBusy}
            style={{
              flex: 1,
              backgroundColor: '#e5e7eb',
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: 'center',
              opacity: isBusy ? 0.6 : 1,
            }}
          >
            <Text style={{ color: '#111827', fontSize: 14, fontWeight: '700' }}>
              Přidat z galerie
            </Text>
          </Pressable>
        </View>

        {items.length === 0 ? (
          <Text style={{ fontSize: 14, color: '#6b7280' }}>
            Zatím tu není žádná fotka.
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {items.map((record) => (
                <Pressable
                  key={record.localId}
                  onPress={() => setViewerPhoto(record)}
                  style={{
                    width: 124,
                    borderRadius: 12,
                    backgroundColor: '#ffffff',
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    overflow: 'hidden',
                  }}
                >
                  <Image
                    source={{ uri: record.localThumbUri || record.localDisplayUri }}
                    style={{ width: '100%', height: 92, backgroundColor: '#e5e7eb' }}
                    contentFit="cover"
                  />

                  <View style={{ padding: 10 }}>
                    <Text
                      style={{ fontSize: 12, fontWeight: '700', color: '#111827', marginBottom: 4 }}
                      numberOfLines={1}
                    >
                      {formatStatusLabel(record)}
                    </Text>

                    <Text style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                      {formatTakenAt(record.takenAt)}
                    </Text>

                    {!!record.errorMessage && (
                      <Text style={{ fontSize: 11, color: '#b91c1c' }} numberOfLines={2}>
                        {record.errorMessage}
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    )
  }

  return (
    <>
      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>Fotky k zakázce</Text>

        <View
          style={{
            backgroundColor: '#f8fafc',
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: '#e5e7eb',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827' }}>
              Režim uploadu
            </Text>

            <Text style={{ fontSize: 12, color: '#6b7280' }}>
              {uploadPreference === 'wifi_only' ? 'Jen Wi-Fi' : 'Wi-Fi + data'}
            </Text>
          </View>

          <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 10, lineHeight: 18 }}>
            {getUploadPreferenceHint(uploadPreference)}
          </Text>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={() => handleUploadPreferenceChange('wifi_only')}
              style={{
                flex: 1,
                backgroundColor: uploadPreference === 'wifi_only' ? '#111827' : '#ffffff',
                borderRadius: 10,
                paddingVertical: 10,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: uploadPreference === 'wifi_only' ? '#111827' : '#d1d5db',
              }}
            >
              <Text
                style={{
                  color: uploadPreference === 'wifi_only' ? '#fff' : '#111827',
                  fontSize: 13,
                  fontWeight: '700',
                }}
              >
                Jen Wi-Fi
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleUploadPreferenceChange('wifi_or_cellular')}
              style={{
                flex: 1,
                backgroundColor:
                  uploadPreference === 'wifi_or_cellular' ? '#111827' : '#ffffff',
                borderRadius: 10,
                paddingVertical: 10,
                alignItems: 'center',
                borderWidth: 1,
                borderColor:
                  uploadPreference === 'wifi_or_cellular' ? '#111827' : '#d1d5db',
              }}
            >
              <Text
                style={{
                  color: uploadPreference === 'wifi_or_cellular' ? '#fff' : '#111827',
                  fontSize: 13,
                  fontWeight: '700',
                }}
              >
                Wi-Fi + data
              </Text>
            </Pressable>
          </View>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}>
            <ActivityIndicator size="small" />
            <Text style={{ marginTop: 10, fontSize: 14, color: '#6b7280' }}>
              Načítám lokální fotky...
            </Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {renderPhotoGroup('Fotky před', 'before', groupedPhotos.before)}
            {renderPhotoGroup('Fotky po', 'after', groupedPhotos.after)}
          </View>
        )}
      </View>

      <Modal visible={!!viewerPhoto} transparent animationType="fade" onRequestClose={() => setViewerPhoto(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            padding: 20,
            justifyContent: 'center',
          }}
        >
          <Pressable
            onPress={() => setViewerPhoto(null)}
            style={{
              position: 'absolute',
              top: 50,
              right: 20,
              zIndex: 2,
              backgroundColor: 'rgba(255,255,255,0.16)',
              borderRadius: 999,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Zavřít</Text>
          </Pressable>

          {viewerPhoto && (
            <View
              style={{
                backgroundColor: '#0f172a',
                borderRadius: 18,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.12)',
              }}
            >
              <Image
                source={{ uri: viewerPhoto.localDisplayUri }}
                style={{ width: '100%', height: 420, backgroundColor: '#020617' }}
                contentFit="contain"
              />

              <View style={{ padding: 16 }}>
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 6 }}>
                  {viewerPhoto.photoType === 'before' ? 'Fotka před' : 'Fotka po'}
                </Text>

                <Text style={{ color: '#cbd5e1', fontSize: 14, marginBottom: 4 }}>
                  {formatStatusLabel(viewerPhoto)}
                </Text>

                <Text style={{ color: '#cbd5e1', fontSize: 14 }}>
                  Pořízeno: {formatTakenAt(viewerPhoto.takenAt)}
                </Text>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </>
  )
}
