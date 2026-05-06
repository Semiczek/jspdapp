import NetInfo from '@react-native-community/netinfo'
import { Platform } from 'react-native'
import { OFFLINE_KEYS, getCacheItem, setCacheItem } from './offline'

export type JobPhotoUploadPreference = 'wifi_only' | 'wifi_or_cellular'

export async function isOnline() {
  const state = await NetInfo.fetch()
  return !!state.isConnected
}

export async function isWifiConnection() {
  const state = await NetInfo.fetch()

  if (!state.isConnected) {
    return false
  }

  if (Platform.OS === 'web') {
    return true
  }

  if (state.type === 'wifi' || state.type === 'ethernet') {
    return true
  }

  if (state.type === 'cellular') {
    return false
  }

  if (state.isInternetReachable === false) {
    return false
  }

  return true
}

export async function getJobPhotoUploadPreference(): Promise<JobPhotoUploadPreference> {
  const value = await getCacheItem<JobPhotoUploadPreference>(OFFLINE_KEYS.jobPhotoUploadPreference)
  return value === 'wifi_or_cellular' ? value : 'wifi_only'
}

export async function setJobPhotoUploadPreference(
  value: JobPhotoUploadPreference
): Promise<void> {
  await setCacheItem(OFFLINE_KEYS.jobPhotoUploadPreference, value)
}

export async function canUploadJobPhotosNow() {
  const online = await isOnline()

  if (!online) {
    return false
  }

  const preference = await getJobPhotoUploadPreference()

  if (preference === 'wifi_or_cellular') {
    return true
  }

  return isWifiConnection()
}
