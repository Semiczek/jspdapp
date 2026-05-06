import { Stack } from 'expo-router'
import React from 'react'
import { AppSessionProvider } from '../contexts/AppSessionContext'

export default function RootLayout() {
  return (
    <AppSessionProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" />
      </Stack>
    </AppSessionProvider>
  )
}