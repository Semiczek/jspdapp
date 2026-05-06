import React from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Redirect } from 'expo-router'
import { useAppSession } from '../contexts/AppSessionContext'

export default function IndexPage() {
  const { loading, user } = useAppSession()

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
        }}
      >
        <ActivityIndicator size="large" />
      </View>
    )
  }

  if (!user) {
    return <Redirect href="/login" />
  }

  return <Redirect href="/(tabs)" />
}