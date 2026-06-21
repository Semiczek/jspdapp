import NetInfo from '@react-native-community/netinfo'
import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  Text,
  View,
} from 'react-native'
import { useAppSession } from '../../contexts/AppSessionContext'

async function isOnline() {
  const state = await NetInfo.fetch()
  return !!state.isConnected
}

export default function ProfileTabScreen() {
  const router = useRouter()
  const { loading, user, profile, profileId, signOut } = useAppSession()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    if (signingOut) return

    const online = await isOnline()

    if (!online) {
      Alert.alert(
        'Jsi offline',
        'Teď se neodhlašuj. Bez internetu by ses už znovu nepřihlásil.'
      )
      return
    }

    setSigningOut(true)

    try {
      await signOut()
      router.replace('/login')
    } finally {
      setSigningOut(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#0f2a44" />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
      <View style={{ flex: 1, padding: 16, gap: 14 }}>
        <View
          style={{
            backgroundColor: '#0f2a44',
            borderRadius: 16,
            padding: 18,
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 26, fontWeight: '900' }}>Profil</Text>
          <Text style={{ color: '#cbd5e1', marginTop: 6, fontSize: 14 }}>
            Přihlášený zaměstnanec
          </Text>
        </View>

        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            gap: 10,
          }}
        >
          <Text style={{ color: '#64748b', fontSize: 13 }}>Jméno</Text>
          <Text style={{ color: '#0f172a', fontSize: 18, fontWeight: '900' }}>
            {profile?.full_name ?? 'Neuvedeno'}
          </Text>

          <View style={{ height: 1, backgroundColor: '#e2e8f0' }} />

          <Text style={{ color: '#64748b', fontSize: 13 }}>E-mail</Text>
          <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '800' }}>
            {user?.email ?? 'Neuvedeno'}
          </Text>

          <View style={{ height: 1, backgroundColor: '#e2e8f0' }} />

          <Text style={{ color: '#64748b', fontSize: 13 }}>Profile ID</Text>
          <Text style={{ color: '#0f172a', fontSize: 13, fontWeight: '700' }}>
            {profileId ?? 'Nenačteno'}
          </Text>
        </View>

        <Pressable
          onPress={handleSignOut}
          disabled={signingOut}
          style={{
            backgroundColor: '#dc2626',
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: signingOut ? 0.7 : 1,
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '900' }}>
            {signingOut ? 'Odhlašuji...' : 'Odhlásit se'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}
