import { useRouter } from 'expo-router'
import React, { useEffect, useMemo, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    Pressable,
    SafeAreaView,
    ScrollView,
    Text,
    TextInput,
    View,
} from 'react-native'
import { useAppSession } from '../contexts/AppSessionContext'
import { supabase } from '../lib/supabase'

type AbsenceType = 'planned' | 'sick'
type AbsenceStatus = 'pending' | 'approved' | 'rejected'

type AbsenceRequest = {
  id: string
  company_id: string
  profile_id: string
  absence_mode: AbsenceType
  absence_type: AbsenceType
  start_at: string
  end_at: string
  note: string | null
  status: AbsenceStatus
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

function formatDateTime(value: string) {
  const date = new Date(value)

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function getAbsenceTypeLabel(type: AbsenceType) {
  switch (type) {
    case 'planned':
      return 'Plánovaná absence'
    case 'sick':
      return 'Nemoc'
    default:
      return type
  }
}

function getAbsenceModeLabel(mode: AbsenceType) {
  return mode === 'planned' ? 'Plánovaná' : 'Akutní'
}

function getAbsenceModeFromType(type: AbsenceType): AbsenceType {
  return type === 'sick' ? 'sick' : 'planned'
}

function getAbsenceStatusLabel(status: AbsenceStatus) {
  switch (status) {
    case 'pending':
      return 'Čeká na schválení'
    case 'approved':
      return 'Schváleno'
    case 'rejected':
      return 'Zamítnuto'
    default:
      return status
  }
}

function getAbsenceStatusColor(status: AbsenceStatus) {
  switch (status) {
    case 'pending':
      return '#fef3c7'
    case 'approved':
      return '#dcfce7'
    case 'rejected':
      return '#fee2e2'
    default:
      return '#f3f4f6'
  }
}

export default function AbsenceScreen() {
  const router = useRouter()
  const { profileId, companyId } = useAppSession()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [requests, setRequests] = useState<AbsenceRequest[]>([])

  const now = useMemo(() => new Date(), [])
  const plannedEndDefault = useMemo(() => new Date(now.getTime() + 24 * 60 * 60 * 1000), [now])
  const [absenceType, setAbsenceType] = useState<AbsenceType>('planned')
  const [startAt, setStartAt] = useState(toDateTimeLocalValue(now))
  const [endAt, setEndAt] = useState(toDateTimeLocalValue(plannedEndDefault))
  const [note, setNote] = useState('')

  async function loadAbsenceRequests() {
    if (!profileId || !companyId) {
      setRequests([])
      setLoading(false)
      return
    }

    setLoading(true)

    const { data, error } = await supabase
      .from('absence_requests')
      .select(`
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
      `)
      .eq('profile_id', profileId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Chyba při načítání absence_requests:', error)
      Alert.alert('Chyba', error.message || 'Nepodařilo se načíst nepřítomnosti.')
      setRequests([])
      setLoading(false)
      return
    }

    setRequests((data as AbsenceRequest[]) ?? [])
    setLoading(false)
  }

  async function submitAbsenceRequest() {
    if (!profileId || !companyId || saving) return

    const startDate = new Date(startAt)
    const endDate = new Date(endAt)
    const absenceMode = getAbsenceModeFromType(absenceType)

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      Alert.alert('Chyba', 'Zadej platné datum a čas.')
      return
    }

    if (endDate.getTime() < startDate.getTime()) {
      Alert.alert('Chyba', 'Konec nepřítomnosti nesmí být dřív než začátek.')
      return
    }

    setSaving(true)

    const { error } = await supabase.from('absence_requests').insert({
      company_id: companyId,
      profile_id: profileId,
      absence_mode: absenceMode,
      absence_type: absenceType,
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
      note: note.trim() ? note.trim() : null,
      status: 'pending',
    })

    if (error) {
      console.error('Chyba při vložení absence requestu:', error)
      Alert.alert('Chyba', error.message || 'Nepodařilo se odeslat nepřítomnost.')
      setSaving(false)
      return
    }

    setSaving(false)
    setNote('')

    if (absenceMode === 'planned') {
      const start = new Date()
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)

      setAbsenceType('planned')
      setStartAt(toDateTimeLocalValue(start))
      setEndAt(toDateTimeLocalValue(end))
      Alert.alert('Hotovo', 'Plánovaná nepřítomnost byla odeslána ke schválení.')
    } else {
      const start = new Date()
      const end = new Date(start.getTime() + 8 * 60 * 60 * 1000)

      setAbsenceType('sick')
      setStartAt(toDateTimeLocalValue(start))
      setEndAt(toDateTimeLocalValue(end))
      Alert.alert('Hotovo', 'Akutní nepřítomnost byla nahlášena.')
    }

    await loadAbsenceRequests()
  }

  useEffect(() => {
    loadAbsenceRequests()
  }, [profileId, companyId])

  useEffect(() => {
    const start = new Date()
    const end =
      absenceType === 'sick'
        ? new Date(start.getTime() + 8 * 60 * 60 * 1000)
        : new Date(start.getTime() + 24 * 60 * 60 * 1000)

    setStartAt(toDateTimeLocalValue(start))
    setEndAt(toDateTimeLocalValue(end))
  }, [absenceType])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 16,
          flexGrow: 1,
        }}
      >
        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: '700', marginBottom: 12 }}>
            Nepřítomnost
          </Text>

          <Text style={{ fontSize: 14, color: '#555', lineHeight: 22 }}>
            Tady můžeš odeslat nepřítomnost a vybrat jen její druh.
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
          <Text style={{ fontSize: 18, fontWeight: '700' }}>
            Odeslat nepřítomnost
          </Text>

          <Text style={{ fontSize: 14, fontWeight: '600' }}>Druh nepřítomnosti</Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['planned', 'sick'] as AbsenceType[]).map((type) => {
              const active = absenceType === type

              return (
                <Pressable
                  key={type}
                  onPress={() => setAbsenceType(type)}
                  style={{
                    backgroundColor: active ? '#111827' : '#f3f4f6',
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                  }}
                >
                  <Text
                    style={{
                      color: active ? '#fff' : '#111827',
                      fontWeight: '700',
                      fontSize: 13,
                    }}
                  >
                    {getAbsenceTypeLabel(type)}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          <Text style={{ fontSize: 14, fontWeight: '600', marginTop: 4 }}>
            Začátek
          </Text>

          <TextInput
            value={startAt}
            onChangeText={setStartAt}
            placeholder="YYYY-MM-DDTHH:mm"
            style={{
              borderWidth: 1,
              borderColor: '#d1d5db',
              borderRadius: 12,
              padding: 12,
              backgroundColor: '#ffffff',
              fontSize: 14,
            }}
          />

          <Text style={{ fontSize: 14, fontWeight: '600' }}>
            Konec
          </Text>

          <TextInput
            value={endAt}
            onChangeText={setEndAt}
            placeholder="YYYY-MM-DDTHH:mm"
            style={{
              borderWidth: 1,
              borderColor: '#d1d5db',
              borderRadius: 12,
              padding: 12,
              backgroundColor: '#ffffff',
              fontSize: 14,
            }}
          />

          <Text style={{ fontSize: 14, fontWeight: '600' }}>
            Poznámka
          </Text>

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Napiš důvod nebo doplnění"
            multiline
            textAlignVertical="top"
            style={{
              minHeight: 90,
              borderWidth: 1,
              borderColor: '#d1d5db',
              borderRadius: 12,
              padding: 12,
              backgroundColor: '#ffffff',
              fontSize: 14,
            }}
          />

          <Pressable
            onPress={submitAbsenceRequest}
            disabled={saving}
            style={{
              backgroundColor: '#111827',
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: saving ? 0.6 : 1,
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>
              {saving ? 'Odesílám...' : 'Odeslat nepřítomnost'}
            </Text>
          </Pressable>
        </View>

        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '700' }}>
            Moje nepřítomnosti
          </Text>

          {loading ? (
            <ActivityIndicator size="large" />
          ) : requests.length === 0 ? (
            <Text style={{ fontSize: 14, color: '#666' }}>
              Zatím tu nemáš žádné nahlášené nepřítomnosti.
            </Text>
          ) : (
            requests.map((request) => (
              <View
                key={request.id}
                style={{
                  borderWidth: 1,
                  borderColor: '#e5e7eb',
                  borderRadius: 14,
                  padding: 14,
                  gap: 6,
                  backgroundColor: '#ffffff',
                }}
              >
                <View
                  style={{
                    alignSelf: 'flex-start',
                    backgroundColor: getAbsenceStatusColor(request.status),
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#111827' }}>
                    {getAbsenceStatusLabel(request.status)}
                  </Text>
                </View>

                <Text style={{ fontSize: 16, fontWeight: '700' }}>
                  {getAbsenceModeLabel(request.absence_mode)} • {getAbsenceTypeLabel(request.absence_type)}
                </Text>

                <Text style={{ fontSize: 14, color: '#555' }}>
                  Od: {formatDateTime(request.start_at)}
                </Text>

                <Text style={{ fontSize: 14, color: '#555' }}>
                  Do: {formatDateTime(request.end_at)}
                </Text>

                <Text style={{ fontSize: 14, color: '#555' }}>
                  Odesláno: {formatDateTime(request.created_at)}
                </Text>

                {request.note ? (
                  <Text style={{ fontSize: 14, color: '#555' }}>
                    Poznámka: {request.note}
                  </Text>
                ) : null}

                {request.reviewed_at ? (
                  <Text style={{ fontSize: 14, color: '#555' }}>
                    Vyřízeno: {formatDateTime(request.reviewed_at)}
                  </Text>
                ) : null}
              </View>
            ))
          )}
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
      </ScrollView>
    </SafeAreaView>
  )
}
