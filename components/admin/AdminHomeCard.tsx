import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { supabase } from '../../lib/supabase'

type AdvanceStatus = 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled'
type AbsenceStatus = 'pending' | 'approved' | 'rejected'
type AbsenceType = 'planned' | 'sick'

type ProfileJoin =
  | {
      id: string
      full_name: string | null
      email?: string | null
    }
  | {
      id: string
      full_name: string | null
      email?: string | null
    }[]
  | null

type AdminAdvanceRequest = {
  id: string
  company_id: string
  profile_id: string
  amount: number | string
  reason: string | null
  payroll_month: string | null
  status: AdvanceStatus
  requested_at: string
  approved_at: string | null
  approved_by: string | null
  paid_at: string | null
  profiles?: ProfileJoin
}

type AdminAbsenceRequest = {
  id: string
  company_id: string
  profile_id: string
  absence_mode: 'planned' | 'sick'
  absence_type: AbsenceType
  start_at: string
  end_at: string
  note: string | null
  status: AbsenceStatus
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  profiles?: ProfileJoin
}

type AdminHomeCardProps = {
  role: string | null
  companyId: string
  profileId: string | null
  syncTick?: number
  onOpenControl: () => void
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDateTime(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatPayrollMonth(value: string | null) {
  if (!value) return '—'

  const date = new Date(`${value}T00:00:00`)

  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('cs-CZ', {
    month: 'long',
    year: 'numeric',
  })
}

function getProfileJoinValue(profile: ProfileJoin) {
  if (Array.isArray(profile)) {
    return profile[0] ?? null
  }

  return profile ?? null
}

function getProfileLabel(profile: ProfileJoin, profileId: string) {
  const joined = getProfileJoinValue(profile)

  if (joined?.full_name) return joined.full_name
  if (joined?.email) return joined.email
  return `Profil ${profileId.slice(0, 8)}`
}

function attachProfiles<T extends { profile_id: string; profiles?: ProfileJoin }>(
  rows: T[],
  profileMap: Map<string, { id: string; full_name: string | null; email?: string | null }>
) {
  return rows.map((row) => ({
    ...row,
    profiles: profileMap.get(row.profile_id) ?? null,
  }))
}

function getAdvanceActionLabel(status: AdvanceStatus) {
  if (status === 'pending') return 'Čeká na rozhodnutí'
  if (status === 'approved') return 'Schváleno, čeká na výplatu'
  if (status === 'paid') return 'Vyplaceno'
  if (status === 'rejected') return 'Zamítnuto'
  return status
}

function getAbsenceTypeLabel(type: AbsenceType) {
  return type === 'sick' ? 'Nemoc' : 'Plánovaná nepřítomnost'
}

function getAbsenceActionLabel(status: AbsenceStatus) {
  if (status === 'pending') return 'Čeká na rozhodnutí'
  if (status === 'approved') return 'Schváleno'
  if (status === 'rejected') return 'Zamítnuto'
  return status
}

function buildWorkerAdvanceNote(item: AdminAdvanceRequest) {
  const requestLabel = `Záloha ze žádosti ${item.id}`

  if (!item.reason?.trim()) {
    return requestLabel
  }

  return `${requestLabel}: ${item.reason.trim()}`
}

function getExpectedCurrentAdvanceStatus(nextStatus: AdvanceStatus) {
  if (nextStatus === 'approved') return 'pending'
  if (nextStatus === 'rejected') return 'pending'
  if (nextStatus === 'paid') return 'approved'
  return null
}

export function AdminHomeCard({
  role,
  companyId,
  profileId,
  syncTick = 0,
  onOpenControl,
}: AdminHomeCardProps) {
  const [loading, setLoading] = useState(true)
  const [advances, setAdvances] = useState<AdminAdvanceRequest[]>([])
  const [absences, setAbsences] = useState<AdminAbsenceRequest[]>([])
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const pendingSickCount = useMemo(
    () => absences.filter((item) => item.absence_type === 'sick').length,
    [absences]
  )

  const loadAdminActions = useCallback(async () => {
    if (!companyId) {
      setAdvances([])
      setAbsences([])
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      const [advanceResponse, absenceResponse] = await Promise.all([
        supabase
          .from('advance_requests')
          .select(
            `
            id,
            company_id,
            profile_id,
            amount,
            reason,
            payroll_month,
            status,
            requested_at,
            approved_at,
            approved_by,
            paid_at
          `
          )
          .eq('company_id', companyId)
          .in('status', ['pending', 'approved'])
          .order('requested_at', { ascending: false })
          .limit(6),
        supabase
          .from('absence_requests')
          .select(
            `
            id,
            company_id,
            profile_id,
            absence_mode,
            absence_type,
            start_at,
            end_at,
            note,
            status,
            created_at,
            reviewed_at,
            reviewed_by
          `
          )
          .eq('company_id', companyId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(6),
      ])

      if (advanceResponse.error) {
        throw advanceResponse.error
      }

      if (absenceResponse.error) {
        throw absenceResponse.error
      }

      const nextAdvances = (advanceResponse.data as AdminAdvanceRequest[] | null) ?? []
      const nextAbsences = (absenceResponse.data as AdminAbsenceRequest[] | null) ?? []
      const profileIds = Array.from(
        new Set([
          ...nextAdvances.map((item) => item.profile_id),
          ...nextAbsences.map((item) => item.profile_id),
        ].filter(Boolean))
      )

      const profileMap = new Map<
        string,
        { id: string; full_name: string | null; email?: string | null }
      >()

      if (profileIds.length > 0) {
        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, auth_user_id')
          .in('id', profileIds)

        if (profileError) {
          throw profileError
        }

        for (const row of profileRows ?? []) {
          profileMap.set(row.id, {
            id: row.id,
            full_name: row.full_name,
            email: row.auth_user_id ?? null,
          })
        }
      }

      setAdvances(attachProfiles(nextAdvances, profileMap))
      setAbsences(attachProfiles(nextAbsences, profileMap))
      setAmountDrafts((current) => {
        const next = { ...current }

        for (const item of nextAdvances) {
          if (!next[item.id]) {
            next[item.id] = String(toNumber(item.amount))
          }
        }

        return next
      })
    } catch (error: any) {
      console.error('ADMIN_HOME_CARD_LOAD_ERROR', error)
      Alert.alert('Chyba', error?.message ?? 'Nepodařilo se načíst admin akce.')
      setAdvances([])
      setAbsences([])
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    loadAdminActions()
  }, [loadAdminActions, syncTick])

  useEffect(() => {
    if (!companyId) {
      return
    }

    const channel = supabase
      .channel(`admin-home-card:${companyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'advance_requests',
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          loadAdminActions()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'absence_requests',
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          loadAdminActions()
        }
      )

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [companyId, loadAdminActions])

  const updateAdvanceStatus = useCallback(
    async (item: AdminAdvanceRequest, nextStatus: AdvanceStatus) => {
      if (!profileId || savingKey) return

      const draftValue = amountDrafts[item.id] ?? String(toNumber(item.amount))
      const parsedAmount = Number(draftValue.replace(',', '.'))

      if (!parsedAmount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        Alert.alert('Chyba', 'Zadej platnou částku větší než 0 Kč.')
        return
      }

      setSavingKey(`advance:${item.id}:${nextStatus}`)

      try {
        const now = new Date().toISOString()
        const expectedCurrentStatus = getExpectedCurrentAdvanceStatus(nextStatus)

        if (!expectedCurrentStatus) {
          throw new Error('Nepodporovaná změna stavu zálohy.')
        }

        const payload: Record<string, any> = {
          amount: parsedAmount,
          status: nextStatus,
        }

        if (nextStatus === 'approved') {
          payload.approved_at = now
          payload.approved_by = profileId
        }

        if (nextStatus === 'rejected') {
          payload.approved_at = null
          payload.approved_by = profileId
          payload.paid_at = null
        }

        if (nextStatus === 'paid') {
          payload.status = 'paid'
          payload.approved_at = item.approved_at ?? now
          payload.approved_by = item.approved_by ?? profileId
          payload.paid_at = now
        }

        const { data: updatedRows, error } = await supabase
          .from('advance_requests')
          .update(payload)
          .eq('id', item.id)
          .eq('company_id', companyId)
          .eq('status', expectedCurrentStatus)
          .select('id')

        if (error) {
          throw error
        }

        if (!updatedRows || updatedRows.length === 0) {
          await loadAdminActions()
          return
        }

        if (nextStatus === 'paid') {
          const workerAdvanceNote = buildWorkerAdvanceNote(item)
          const workerAdvancePayload = {
            advance_request_id: item.id,
            profile_id: item.profile_id,
            amount: parsedAmount,
            issued_at: payload.paid_at ?? now,
            note: workerAdvanceNote,
          }

          const { error: workerAdvanceUpsertError } = await supabase
            .from('worker_advances')
            .upsert(workerAdvancePayload, { onConflict: 'advance_request_id' })

          if (workerAdvanceUpsertError) {
            throw workerAdvanceUpsertError
          }
        }

        await loadAdminActions()
      } catch (error: any) {
        console.error('ADMIN_HOME_CARD_ADVANCE_UPDATE_ERROR', error)
        Alert.alert('Chyba', error?.message ?? 'Nepodařilo se uložit změnu zálohy.')
      } finally {
        setSavingKey(null)
      }
    },
    [amountDrafts, companyId, loadAdminActions, profileId, savingKey]
  )

  const updateAbsenceStatus = useCallback(
    async (item: AdminAbsenceRequest, nextStatus: AbsenceStatus) => {
      if (!profileId || savingKey) return

      setSavingKey(`absence:${item.id}:${nextStatus}`)

      try {
        const { error } = await supabase
          .from('absence_requests')
          .update({
            status: nextStatus,
            reviewed_at: new Date().toISOString(),
            reviewed_by: profileId,
          })
          .eq('id', item.id)
          .eq('company_id', companyId)

        if (error) {
          throw error
        }

        await loadAdminActions()
      } catch (error: any) {
        console.error('ADMIN_HOME_CARD_ABSENCE_UPDATE_ERROR', error)
        Alert.alert('Chyba', error?.message ?? 'Nepodařilo se uložit změnu nepřítomnosti.')
      } finally {
        setSavingKey(null)
      }
    },
    [companyId, loadAdminActions, profileId, savingKey]
  )

  return (
    <View
      style={{
        backgroundColor: '#dbeafe',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#93c5fd',
      }}
    >
      <Text
        style={{
          fontSize: 20,
          fontWeight: '700',
          color: '#1e3a8a',
          marginBottom: 8,
        }}
      >
        Admin sekce
      </Text>

      <Text
        style={{
          fontSize: 14,
          color: '#1e40af',
          marginBottom: 6,
          lineHeight: 22,
        }}
      >
        Rychlý přístup ke kontrole zakázek, záloh a nepřítomností zaměstnanců.
      </Text>

      <Text
        style={{
          fontSize: 13,
          color: '#1d4ed8',
          marginBottom: 10,
        }}
      >
        Role: {role ?? 'neznámá'}
      </Text>

      <View
        style={{
          flexDirection: 'row',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: '#eff6ff',
            borderRadius: 12,
            padding: 10,
            borderWidth: 1,
            borderColor: '#bfdbfe',
          }}
        >
          <Text style={{ color: '#1d4ed8', fontSize: 12 }}>Čekající zálohy</Text>
          <Text style={{ color: '#1e3a8a', fontSize: 18, fontWeight: '700', marginTop: 2 }}>
            {advances.length}
          </Text>
        </View>

        <View
          style={{
            flex: 1,
            backgroundColor: '#eff6ff',
            borderRadius: 12,
            padding: 10,
            borderWidth: 1,
            borderColor: '#bfdbfe',
          }}
        >
          <Text style={{ color: '#1d4ed8', fontSize: 12 }}>Nemoc / absence</Text>
          <Text style={{ color: '#1e3a8a', fontSize: 18, fontWeight: '700', marginTop: 2 }}>
            {absences.length}
            {pendingSickCount ? ` / nemoc ${pendingSickCount}` : ''}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={onOpenControl}
        style={{
          backgroundColor: '#2563eb',
          borderRadius: 14,
          paddingVertical: 14,
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
          Otevřít kontrolu prací
        </Text>
      </Pressable>

      <Pressable
        onPress={loadAdminActions}
        disabled={loading}
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 12,
          paddingVertical: 12,
          alignItems: 'center',
          marginBottom: 14,
          borderWidth: 1,
          borderColor: '#93c5fd',
          opacity: loading ? 0.6 : 1,
        }}
      >
        <Text style={{ color: '#1d4ed8', fontSize: 14, fontWeight: '700' }}>
          Obnovit admin sekci
        </Text>
      </Pressable>

      {loading ? (
        <View style={{ paddingVertical: 16, alignItems: 'center' }}>
          <ActivityIndicator size="small" color="#2563eb" />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <View
            style={{
              backgroundColor: '#f8fbff',
              borderRadius: 14,
              padding: 12,
              borderWidth: 1,
              borderColor: '#bfdbfe',
            }}
          >
            <Text style={{ color: '#1e3a8a', fontSize: 16, fontWeight: '700', marginBottom: 8 }}>
              Admin akce: zálohy
            </Text>

            {advances.length === 0 ? (
              <Text style={{ color: '#475569', fontSize: 13 }}>
                Teď tu není žádná čekající záloha.
              </Text>
            ) : (
              <View style={{ gap: 10 }}>
                {advances.map((item) => {
                  const isSaving = savingKey?.startsWith(`advance:${item.id}:`)

                  return (
                    <View
                      key={item.id}
                      style={{
                        backgroundColor: '#ffffff',
                        borderRadius: 12,
                        padding: 12,
                        borderWidth: 1,
                        borderColor: '#dbeafe',
                      }}
                    >
                      <Text style={{ color: '#111827', fontWeight: '700', fontSize: 14 }}>
                        {getProfileLabel(item.profiles ?? null, item.profile_id)}
                      </Text>

                      <Text style={{ color: '#475569', fontSize: 12, marginTop: 3 }}>
                        {getAdvanceActionLabel(item.status)} • žádost{' '}
                        {formatDateTime(item.requested_at)}
                      </Text>

                      <Text style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>
                        Výplatní měsíc: {formatPayrollMonth(item.payroll_month)}
                      </Text>

                      {!!item.reason && (
                        <Text style={{ color: '#334155', fontSize: 13, marginTop: 6 }}>
                          Důvod: {item.reason}
                        </Text>
                      )}

                      <View style={{ marginTop: 10 }}>
                        <Text style={{ color: '#1e3a8a', fontSize: 12, marginBottom: 6 }}>
                          Výše zálohy
                        </Text>

                        <TextInput
                          value={amountDrafts[item.id] ?? String(toNumber(item.amount))}
                          onChangeText={(value) =>
                            setAmountDrafts((current) => ({
                              ...current,
                              [item.id]: value,
                            }))
                          }
                          editable={!isSaving}
                          keyboardType="numeric"
                          placeholder="0"
                          style={{
                            backgroundColor: '#f8fafc',
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: '#cbd5e1',
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            color: '#111827',
                          }}
                        />

                        <Text
                          style={{
                            color: '#0f172a',
                            fontSize: 15,
                            fontWeight: '700',
                            marginTop: 8,
                          }}
                        >
                          Náhled: {formatMoney(toNumber(amountDrafts[item.id] ?? item.amount))}
                        </Text>
                      </View>

                      <View
                        style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}
                      >
                        {item.status === 'pending' && (
                          <>
                            <Pressable
                              onPress={() => updateAdvanceStatus(item, 'approved')}
                              disabled={!!isSaving}
                              style={{
                                backgroundColor: '#16a34a',
                                borderRadius: 10,
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                                opacity: isSaving ? 0.6 : 1,
                              }}
                            >
                              <Text style={{ color: '#fff', fontWeight: '700' }}>Potvrdit</Text>
                            </Pressable>

                            <Pressable
                              onPress={() => updateAdvanceStatus(item, 'rejected')}
                              disabled={!!isSaving}
                              style={{
                                backgroundColor: '#fff',
                                borderRadius: 10,
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                                borderWidth: 1,
                                borderColor: '#dc2626',
                                opacity: isSaving ? 0.6 : 1,
                              }}
                            >
                              <Text style={{ color: '#dc2626', fontWeight: '700' }}>
                                Zamítnout
                              </Text>
                            </Pressable>
                          </>
                        )}

                        {item.status === 'approved' && (
                          <>
                            <Pressable
                              onPress={() => updateAdvanceStatus(item, 'paid')}
                              disabled={!!isSaving}
                              style={{
                                backgroundColor: '#2563eb',
                                borderRadius: 10,
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                                opacity: isSaving ? 0.6 : 1,
                              }}
                            >
                              <Text style={{ color: '#fff', fontWeight: '700' }}>Vyplatit</Text>
                            </Pressable>
                          </>
                        )}
                      </View>
                    </View>
                  )
                })}
              </View>
            )}
          </View>

          <View
            style={{
              backgroundColor: '#f8fbff',
              borderRadius: 14,
              padding: 12,
              borderWidth: 1,
              borderColor: '#bfdbfe',
            }}
          >
            <Text style={{ color: '#1e3a8a', fontSize: 16, fontWeight: '700', marginBottom: 8 }}>
              Admin akce: nepřítomnost
            </Text>

            {absences.length === 0 ? (
              <Text style={{ color: '#475569', fontSize: 13 }}>
                Teď tu není žádná čekající nepřítomnost.
              </Text>
            ) : (
              <View style={{ gap: 10 }}>
                {absences.map((item) => {
                  const isSaving = savingKey?.startsWith(`absence:${item.id}:`)

                  return (
                    <View
                      key={item.id}
                      style={{
                        backgroundColor: '#ffffff',
                        borderRadius: 12,
                        padding: 12,
                        borderWidth: 1,
                        borderColor: '#dbeafe',
                      }}
                    >
                      <Text style={{ color: '#111827', fontWeight: '700', fontSize: 14 }}>
                        {getProfileLabel(item.profiles ?? null, item.profile_id)}
                      </Text>

                      <Text style={{ color: '#475569', fontSize: 12, marginTop: 3 }}>
                        {getAbsenceTypeLabel(item.absence_type)} •{' '}
                        {getAbsenceActionLabel(item.status)}
                      </Text>

                      <Text style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>
                        {formatDateTime(item.start_at)} → {formatDateTime(item.end_at)}
                      </Text>

                      {!!item.note && (
                        <Text style={{ color: '#334155', fontSize: 13, marginTop: 6 }}>
                          Poznámka: {item.note}
                        </Text>
                      )}

                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                        <Pressable
                          onPress={() => updateAbsenceStatus(item, 'approved')}
                          disabled={!!isSaving}
                          style={{
                            backgroundColor: '#16a34a',
                            borderRadius: 10,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            opacity: isSaving ? 0.6 : 1,
                          }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700' }}>Potvrdit</Text>
                        </Pressable>

                        <Pressable
                          onPress={() => updateAbsenceStatus(item, 'rejected')}
                          disabled={!!isSaving}
                          style={{
                            backgroundColor: '#fff',
                            borderRadius: 10,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            borderWidth: 1,
                            borderColor: '#dc2626',
                            opacity: isSaving ? 0.6 : 1,
                          }}
                        >
                          <Text style={{ color: '#dc2626', fontWeight: '700' }}>Zamítnout</Text>
                        </Pressable>
                      </View>
                    </View>
                  )
                })}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  )
}
