import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { useAppSession } from '../contexts/AppSessionContext'

export default function LoginScreen() {
  const router = useRouter()
  const { session } = useAppSession()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    if (session) {
      router.replace('/(tabs)')
    }
  }, [session, router])

  async function handleLogin() {
    if (loading) return

    const cleanEmail = email.trim().toLowerCase()
    const cleanPassword = password

    if (!cleanEmail || !cleanPassword) {
      setErrorText('Zadej e-mail i heslo.')
      return
    }

    setLoading(true)
    setErrorText('')

    console.log('LOGIN_START', cleanEmail)

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPassword,
    })

    console.log('LOGIN_RESPONSE', { data, error })

    if (error) {
      console.error('LOGIN_ERROR', error)
      setErrorText(error.message || 'Přihlášení se nepodařilo.')
      Alert.alert('Chyba přihlášení', error.message || 'Přihlášení se nepodařilo.')
      setLoading(false)
      return
    }

    if (!data.session) {
      setErrorText('Přihlášení nevrátilo session.')
      Alert.alert('Chyba', 'Přihlášení nevrátilo session.')
      setLoading(false)
      return
    }

    console.log('LOGIN_SUCCESS', data.session.user.id)

    setLoading(false)
    router.replace('/(tabs)')
  }

  if (session) {
    return <Redirect href="/(tabs)" />
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{
        flex: 1,
        backgroundColor: '#f5f7fb',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 18,
          padding: 20,
        }}
      >
        <Text
          style={{
            fontSize: 28,
            fontWeight: '700',
            marginBottom: 8,
            color: '#111827',
          }}
        >
          Přihlášení
        </Text>

        <Text
          style={{
            fontSize: 15,
            color: '#6b7280',
            marginBottom: 20,
          }}
        >
          Přihlas se svým firemním účtem.
        </Text>

        <Text
          style={{
            fontSize: 14,
            fontWeight: '600',
            marginBottom: 6,
            color: '#111827',
          }}
        >
          E-mail
        </Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
          placeholder="napr. test@jspd.cz"
          placeholderTextColor="#9ca3af"
          style={{
            borderWidth: 1,
            borderColor: '#d1d5db',
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 14,
            fontSize: 16,
            marginBottom: 16,
            backgroundColor: '#fff',
          }}
        />

        <Text
          style={{
            fontSize: 14,
            fontWeight: '600',
            marginBottom: 6,
            color: '#111827',
          }}
        >
          Heslo
        </Text>

        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Zadej heslo"
          placeholderTextColor="#9ca3af"
          style={{
            borderWidth: 1,
            borderColor: '#d1d5db',
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 14,
            fontSize: 16,
            marginBottom: 12,
            backgroundColor: '#fff',
          }}
        />

        <Pressable
          onPress={() => setShowPassword((current) => !current)}
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: '#f3f4f6',
            marginBottom: 12,
          }}
        >
          <Text style={{ color: '#111827', fontSize: 13, fontWeight: '700' }}>
            {showPassword ? 'Skrýt heslo' : 'Zobrazit heslo'}
          </Text>
        </Pressable>

        {!!errorText && (
          <View
            style={{
              backgroundColor: '#fee2e2',
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <Text style={{ color: '#991b1b', fontSize: 14 }}>{errorText}</Text>
          </View>
        )}

        <Pressable
          onPress={handleLogin}
          disabled={loading}
          style={{
            backgroundColor: '#111827',
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700' }}>
              Přihlásit se
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
