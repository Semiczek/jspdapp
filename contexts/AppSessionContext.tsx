import NetInfo from '@react-native-community/netinfo'
import type { Session, User } from '@supabase/supabase-js'
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { JSPD_CLEANING_COMPANY_ID } from '../lib/company'
import { OFFLINE_KEYS, getCacheItem, removeCacheItem, setCacheItem } from '../lib/offline'
import { supabase } from '../lib/supabase'
import { syncPendingActions } from '../lib/syncManager'

type EmployeeProfile = {
  id: string
  full_name: string | null
  auth_user_id: string | null
}

type CompanyMembership = {
  company_id: string
  role: string | null
  is_active: boolean | null
}

type AppSessionContextValue = {
  loading: boolean
  session: Session | null
  user: User | null
  profile: EmployeeProfile | null
  profileId: string | null
  companyId: string
  membership: CompanyMembership | null
  role: string | null
  isAdmin: boolean
  syncTick: number
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AppSessionContext = createContext<AppSessionContextValue | undefined>(undefined)

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<EmployeeProfile | null>(null)
  const [membership, setMembership] = useState<CompanyMembership | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [syncTick, setSyncTick] = useState(0)

  async function loadProfileAndMembership(authUserId: string | null) {
    const cachedProfile = await getCacheItem<EmployeeProfile>(OFFLINE_KEYS.sessionProfile)
    const cachedMembership = await getCacheItem<CompanyMembership>(
      OFFLINE_KEYS.sessionMembership
    )

    if (!authUserId) {
      console.log('LOAD_PROFILE: missing authUserId')
      setProfile(cachedProfile ?? null)
      setMembership(cachedMembership ?? null)
      await removeCacheItem(OFFLINE_KEYS.sessionProfile)
      await removeCacheItem(OFFLINE_KEYS.sessionMembership)
      return
    }

    console.log('LOAD_PROFILE_FOR_AUTH_USER', authUserId)

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, auth_user_id')
      .eq('auth_user_id', authUserId)
      .maybeSingle()

    console.log('LOAD_PROFILE_RESULT', { profileData, profileError })

    if (profileError) {
      console.error('Chyba při načítání profilu:', profileError)
      setProfile(cachedProfile ?? null)
      setMembership(cachedMembership ?? null)
      return
    }

    if (!profileData) {
      console.log('PROFILE_NOT_FOUND_FOR_AUTH_USER', authUserId)
      setProfile(cachedProfile ?? null)
      setMembership(cachedMembership ?? null)
      return
    }

    setProfile(profileData)
    await setCacheItem(OFFLINE_KEYS.sessionProfile, profileData)

    const { data: membershipData, error: membershipError } = await supabase
      .from('company_members')
      .select('company_id, role, is_active')
      .eq('profile_id', profileData.id)
      .eq('company_id', JSPD_CLEANING_COMPANY_ID)
      .maybeSingle()

    console.log('LOAD_MEMBERSHIP_RESULT', { membershipData, membershipError })

    if (membershipError) {
      console.error('Chyba při načítání company membership:', membershipError)
      setMembership(cachedMembership ?? null)
      return
    }

    setMembership(membershipData ?? null)
    if (membershipData) {
      await setCacheItem(OFFLINE_KEYS.sessionMembership, membershipData)
    } else {
      await removeCacheItem(OFFLINE_KEYS.sessionMembership)
    }
  }

  async function runSyncAndNotify() {
    try {
      await syncPendingActions()
    } catch (error) {
      console.error('SYNC_PENDING_ACTIONS_FAILED', error)
    } finally {
      setSyncTick((prev) => prev + 1)
    }
  }

  async function bootstrap() {
    setLoading(true)

    const {
      data: { session: currentSession },
      error,
    } = await supabase.auth.getSession()

    console.log('BOOTSTRAP_SESSION', currentSession)

    if (error) {
      console.error('Chyba při načítání session:', error)
      setLoading(false)
      return
    }

    setSession(currentSession)
    setUser(currentSession?.user ?? null)

    if (currentSession?.user?.id) {
      await loadProfileAndMembership(currentSession.user.id)
    } else {
      setProfile(null)
      setMembership(null)
    }

    setLoading(false)
  }

  useEffect(() => {
    bootstrap()

    const netUnsub = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected
      setIsOnline(online)

      if (online && user?.id) {
        runSyncAndNotify()
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      console.log('AUTH_STATE_CHANGED', _event, nextSession)

      if (!nextSession && !isOnline) {
        console.log('IGNORING NULL SESSION BECAUSE OFFLINE')
        return
      }

      setSession(nextSession)
      setUser(nextSession?.user ?? null)

      if (!nextSession?.user?.id) {
        setProfile(null)
        setMembership(null)
        setLoading(false)
        return
      }

      setLoading(true)

      setTimeout(() => {
        loadProfileAndMembership(nextSession.user.id).finally(() => {
          setLoading(false)
        })
      }, 0)
    })

    return () => {
      subscription.unsubscribe()
      netUnsub()
    }
  }, [isOnline, user?.id])

  useEffect(() => {
    if (!user?.id) return
    runSyncAndNotify()
  }, [user?.id])

  async function refreshProfile() {
    await loadProfileAndMembership(user?.id ?? null)
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('Chyba při odhlášení:', error)
      return
    }

    await removeCacheItem(OFFLINE_KEYS.sessionProfile)
    await removeCacheItem(OFFLINE_KEYS.sessionMembership)

    setSession(null)
    setUser(null)
    setProfile(null)
    setMembership(null)
    setLoading(false)
  }

  const role = membership?.role ?? null
  const isAdmin = role === 'super_admin' || role === 'company_admin'

  const value = useMemo<AppSessionContextValue>(
    () => ({
      loading,
      session,
      user,
      profile,
      profileId: profile?.id ?? null,
      companyId: JSPD_CLEANING_COMPANY_ID,
      membership,
      role,
      isAdmin,
      syncTick,
      refreshProfile,
      signOut,
    }),
    [loading, session, user, profile, membership, role, isAdmin, syncTick]
  )

  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>
}

export function useAppSession() {
  const context = useContext(AppSessionContext)

  if (!context) {
    throw new Error('useAppSession musí být použit uvnitř AppSessionProvider')
  }

  return context
}
