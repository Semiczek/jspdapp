import React, { useState } from 'react'
import { View, Text, Pressable, Alert, TextInput } from 'react-native'
import { useRouter } from 'expo-router'
import NetInfo from '@react-native-community/netinfo'
import { useAppSession } from '../contexts/AppSessionContext'
import { supabase } from '../lib/supabase'

async function isOnline() {
  const state = await NetInfo.fetch()
  return !!state.isConnected
}

export default function ProfileScreen() {
  const router = useRouter()
  const { user, profile, profileId, signOut } = useAppSession()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  async function handleChangePassword() {
    if (savingPassword) return

    const online = await isOnline()

    if (!online) {
      Alert.alert('Jsi offline', 'Změnu hesla lze udělat jen s internetem.')
      return
    }

    if (!newPassword.trim() || !confirmPassword.trim()) {
      Alert.alert('Chyba', 'Vyplň nové heslo i potvrzení hesla.')
      return
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Chyba', 'Hesla se neshodují.')
      return
    }

    if (newPassword.length < 6) {
      Alert.alert('Chyba', 'Nové heslo musí mít aspoň 6 znaků.')
      return
    }

    setSavingPassword(true)

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) {
        Alert.alert('Chyba', error.message || 'Nepodařilo se změnit heslo.')
        return
      }

      setNewPassword('')
      setConfirmPassword('')
      Alert.alert('Hotovo', 'Heslo bylo změněno.')
    } finally {
      setSavingPassword(false)
    }
  }

  async function handleSignOut() {
    const online = await isOnline()

    if (!online) {
      Alert.alert(
        'Jsi offline',
        'Teď se neodhlašuj. Bez internetu by ses už znovu nepřihlásil.'
      )
      return
    }

    await signOut()
    router.replace('/login')
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#f5f7fb',
        padding: 16,
        gap: 16,
      }}
    >
      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 12 }}>
          Profil
        </Text>

        <Text style={{ fontSize: 16, marginBottom: 8 }}>
          Jméno: {profile?.full_name ?? '—'}
        </Text>

        <Text style={{ fontSize: 16, marginBottom: 8 }}>
          E-mail: {user?.email ?? '—'}
        </Text>

        <Text style={{ fontSize: 16 }}>
          Profile ID: {profileId ?? '—'}
        </Text>
      </View>

      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 16,
          padding: 16,
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: '700' }}>
          Změna hesla
        </Text>

        <Text style={{ fontSize: 14, color: '#555', lineHeight: 22 }}>
          Zadej nové heslo a potvrď ho. Změna hesla vyžaduje internet.
        </Text>

        <Text style={{ fontSize: 14, fontWeight: '600' }}>
          Nové heslo
        </Text>

        <TextInput
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Zadej nové heslo"
          secureTextEntry={!showNewPassword}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            borderWidth: 1,
            borderColor: '#d1d5db',
            borderRadius: 12,
            padding: 12,
            backgroundColor: '#ffffff',
            fontSize: 14,
          }}
        />

        <Pressable
          onPress={() => setShowNewPassword((current) => !current)}
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: '#f3f4f6',
          }}
        >
          <Text style={{ color: '#111827', fontSize: 13, fontWeight: '700' }}>
            {showNewPassword ? 'Skrýt heslo' : 'Zobrazit heslo'}
          </Text>
        </Pressable>

        <Text style={{ fontSize: 14, fontWeight: '600' }}>
          Potvrzení hesla
        </Text>

        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Zadej heslo znovu"
          secureTextEntry={!showConfirmPassword}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            borderWidth: 1,
            borderColor: '#d1d5db',
            borderRadius: 12,
            padding: 12,
            backgroundColor: '#ffffff',
            fontSize: 14,
          }}
        />

        <Pressable
          onPress={() => setShowConfirmPassword((current) => !current)}
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: '#f3f4f6',
          }}
        >
          <Text style={{ color: '#111827', fontSize: 13, fontWeight: '700' }}>
            {showConfirmPassword ? 'Skrýt heslo' : 'Zobrazit heslo'}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleChangePassword}
          disabled={savingPassword}
          style={{
            backgroundColor: '#111827',
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: 'center',
            opacity: savingPassword ? 0.6 : 1,
          }}
        >
          <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
            {savingPassword ? 'Ukládám...' : 'Změnit heslo'}
          </Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.back()}
        style={{
          backgroundColor: '#111827',
          borderRadius: 14,
          paddingVertical: 16,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
          Zpět
        </Text>
      </Pressable>

      <Pressable
        onPress={handleSignOut}
        style={{
          backgroundColor: '#dc2626',
          borderRadius: 14,
          paddingVertical: 16,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
          Odhlásit se
        </Text>
      </Pressable>
    </View>
  )
}
