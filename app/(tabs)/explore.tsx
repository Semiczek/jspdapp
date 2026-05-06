import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { supabase } from '@/lib/supabase'
import { useAppSession } from '@/contexts/AppSessionContext'

type CalendarMode = 'list' | 'week' | 'month'

type CalendarItem = {
  id: string
  type: 'job' | 'event' | 'shift'
  title: string
  description: string | null
  startAt: string
  endAt: string | null
  address?: string | null
  status?: string | null
}

type JobAssignmentRow = {
  profile_id: string
  job_id: string
  jobs:
    | {
        id: string
        title: string | null
        description: string | null
        address: string | null
        status: string | null
        start_at: string | null
        end_at: string | null
      }
    | {
        id: string
        title: string | null
        description: string | null
        address: string | null
        status: string | null
        start_at: string | null
        end_at: string | null
      }[]
    | null
}

type EventAssignmentRow = {
  profile_id: string
  event_id: string
  calendar_events:
    | {
        id: string
        title: string | null
        description: string | null
        start_at: string | null
        end_at: string | null
      }
    | {
        id: string
        title: string | null
        description: string | null
        start_at: string | null
        end_at: string | null
      }[]
    | null
}

type WorkShiftRow = {
  id: string
  company_id: string | null
  profile_id: string
  shift_date: string | null
  started_at: string | null
  ended_at: string | null
}

function startOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function startOfWeek(date: Date) {
  const d = startOfDay(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function endOfWeek(date: Date) {
  const d = startOfWeek(date)
  d.setDate(d.getDate() + 6)
  return endOfDay(d)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function isSameDay(a: string | Date, b: string | Date) {
  const da = typeof a === 'string' ? new Date(a) : a
  const db = typeof b === 'string' ? new Date(b) : b

  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

function formatDateLabel(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value

  return new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(date)
}

function formatTimeLabel(value?: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatRange(item: CalendarItem) {
  const start = formatTimeLabel(item.startAt)
  const end = item.endAt ? formatTimeLabel(item.endAt) : null

  if (!end) return start
  return `${start} – ${end}`
}

function getMonthGrid(anchorDate: Date) {
  const firstDay = startOfMonth(anchorDate)
  const gridStart = startOfWeek(firstDay)
  const days: Date[] = []

  for (let i = 0; i < 42; i++) {
    days.push(addDays(gridStart, i))
  }

  return days
}

function normalizeSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

export default function ExploreScreen() {
  const { profile } = useAppSession()

  const [mode, setMode] = useState<CalendarMode>('list')
  const [anchorDate, setAnchorDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(new Date())

  const [items, setItems] = useState<CalendarItem[]>([])
  const [loadingCalendar, setLoadingCalendar] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const profileId = profile?.id ?? null
  const profileName = profile?.full_name ?? ''

  const range = useMemo(() => {
    if (mode === 'list') {
      return {
        from: startOfWeek(anchorDate),
        to: endOfWeek(addDays(anchorDate, 13)),
      }
    }

    if (mode === 'week') {
      return {
        from: startOfWeek(anchorDate),
        to: endOfWeek(anchorDate),
      }
    }

    return {
      from: startOfMonth(anchorDate),
      to: endOfMonth(anchorDate),
    }
  }, [anchorDate, mode])

  const loadCalendar = useCallback(async () => {
    if (!profileId) {
      setItems([])
      setLoadingCalendar(false)
      return
    }

    try {
      setLoadingCalendar(true)

      const { data: jobsData, error: jobsError } = await supabase
        .from('job_assignments')
        .select(
          `
          profile_id,
          job_id,
          jobs (
            id,
            title,
            description,
            address,
            status,
            start_at,
            end_at
          )
        `
        )
        .eq('profile_id', profileId)

      if (jobsError) {
        throw jobsError
      }

      const { data: eventsData, error: eventsError } = await supabase
        .from('calendar_event_assignments')
        .select(
          `
          profile_id,
          event_id,
          calendar_events (
            id,
            title,
            description,
            start_at,
            end_at
          )
        `
        )
        .eq('profile_id', profileId)

      const { data: shiftsData, error: shiftsError } = await supabase
        .from('work_shifts')
        .select('id, company_id, profile_id, shift_date, started_at, ended_at')
        .eq('profile_id', profileId)

      if (shiftsError) {
        throw shiftsError
      }

      if (eventsError) {
        console.warn('Calendar events load warning:', eventsError)
      }

      const mappedJobs: CalendarItem[] = ((jobsData as JobAssignmentRow[] | null) ?? [])
        .map((row) => normalizeSingleRelation(row.jobs))
        .filter((job): job is NonNullable<typeof job> => !!job && !!job.start_at)
        .map((job) => ({
          id: job.id,
          type: 'job' as const,
          title: job.title || 'Zakázka bez názvu',
          description: job.description ?? null,
          startAt: job.start_at!,
          endAt: job.end_at ?? null,
          address: job.address ?? null,
          status: job.status ?? null,
        }))

      const mappedEvents: CalendarItem[] = (((eventsData as EventAssignmentRow[] | null) ?? []))
        .map((row) => normalizeSingleRelation(row.calendar_events))
        .filter((event): event is NonNullable<typeof event> => !!event && !!event.start_at)
        .map((event) => ({
          id: event.id,
          type: 'event' as const,
          title: event.title || 'Událost bez názvu',
          description: event.description ?? null,
          startAt: event.start_at!,
          endAt: event.end_at ?? null,
        }))

      const mappedShifts: CalendarItem[] = ((shiftsData as WorkShiftRow[] | null) ?? [])
        .filter((shift) => !!shift.started_at)
        .map((shift) => ({
          id: shift.id,
          type: 'shift' as const,
          title: 'Směna',
          description: shift.shift_date ? `Datum směny: ${shift.shift_date}` : null,
          startAt: shift.started_at!,
          endAt: shift.ended_at ?? null,
        }))

      const fromTime = range.from.getTime()
      const toTime = range.to.getTime()

      const filtered = [...mappedJobs, ...mappedEvents, ...mappedShifts]
        .filter((item) => {
          const start = new Date(item.startAt).getTime()
          return start >= fromTime && start <= toTime
        })
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())

      setItems(filtered)
    } catch (error: any) {
      console.error('Calendar load error:', error)
      Alert.alert('Chyba', error?.message || 'Nepodařilo se načíst kalendář.')
    } finally {
      setLoadingCalendar(false)
    }
  }, [profileId, range.from, range.to])

  useEffect(() => {
    loadCalendar()
  }, [loadCalendar])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadCalendar()
    setRefreshing(false)
  }, [loadCalendar])

  const selectedDayItems = useMemo(() => {
    return items.filter((item) => isSameDay(item.startAt, selectedDate))
  }, [items, selectedDate])

  const weekDays = useMemo(() => {
    const start = startOfWeek(anchorDate)
    return Array.from({ length: 7 }, (_, index) => addDays(start, index))
  }, [anchorDate])

  const monthDays = useMemo(() => getMonthGrid(anchorDate), [anchorDate])

  function goPrev() {
    if (mode === 'month') {
      setAnchorDate((prev) => addMonths(prev, -1))
      return
    }

    if (mode === 'week') {
      setAnchorDate((prev) => addDays(prev, -7))
      return
    }

    setAnchorDate((prev) => addDays(prev, -14))
  }

  function goNext() {
    if (mode === 'month') {
      setAnchorDate((prev) => addMonths(prev, 1))
      return
    }

    if (mode === 'week') {
      setAnchorDate((prev) => addDays(prev, 7))
      return
    }

    setAnchorDate((prev) => addDays(prev, 14))
  }

  function goToday() {
    const today = new Date()
    setAnchorDate(today)
    setSelectedDate(today)
  }

  function getItemsForDay(day: Date) {
    return items.filter((item) => isSameDay(item.startAt, day))
  }

  function openItem(item: CalendarItem) {
    Alert.alert(
      item.type === 'job'
        ? 'Detail zakázky'
        : item.type === 'event'
          ? 'Detail události'
          : 'Detail směny',
      [
        `Název: ${item.title}`,
        `Datum: ${formatDateLabel(item.startAt)}`,
        `Čas: ${formatRange(item)}`,
        item.address ? `Místo: ${item.address}` : null,
        item.status ? `Stav: ${item.status}` : null,
        item.description ? `Popis: ${item.description}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  function getBadgeLabel(item: CalendarItem) {
    if (item.type === 'job') return 'Zakázka'
    if (item.type === 'event') return 'Událost'
    return 'Směna'
  }

  function getBadgeColor(item: CalendarItem) {
    if (item.type === 'job') return '#dbeafe'
    if (item.type === 'event') return '#e5e7eb'
    return '#dcfce7'
  }

  function getDotColor(item: CalendarItem) {
    if (item.type === 'job') return '#2563eb'
    if (item.type === 'event') return '#6b7280'
    return '#16a34a'
  }

  function renderModeSwitch() {
    return (
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {(['list', 'week', 'month'] as CalendarMode[]).map((itemMode) => {
          const active = mode === itemMode

          return (
            <Pressable
              key={itemMode}
              onPress={() => setMode(itemMode)}
              style={{
                flex: 1,
                backgroundColor: active ? '#111827' : '#e5e7eb',
                paddingVertical: 10,
                borderRadius: 12,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  color: active ? '#fff' : '#111827',
                  fontWeight: '700',
                  fontSize: 14,
                }}
              >
                {itemMode === 'list'
                  ? 'Seznam'
                  : itemMode === 'week'
                    ? 'Týden'
                    : 'Měsíc'}
              </Text>
            </Pressable>
          )
        })}
      </View>
    )
  }

  function renderHeaderNav() {
    return (
      <View
        style={{
          backgroundColor: '#fff',
          borderRadius: 16,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Pressable
            onPress={goPrev}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: '#f3f4f6',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827' }}>
              ←
            </Text>
          </Pressable>

          <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827' }}>
              {mode === 'month'
                ? new Intl.DateTimeFormat('cs-CZ', {
                    month: 'long',
                    year: 'numeric',
                  }).format(anchorDate)
                : formatDateLabel(anchorDate)}
            </Text>
          </View>

          <Pressable
            onPress={goNext}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: '#f3f4f6',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827' }}>
              →
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={goToday}
          style={{
            marginTop: 10,
            alignSelf: 'center',
            backgroundColor: '#2563eb',
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Dnes</Text>
        </Pressable>
      </View>
    )
  }

  function renderListMode() {
    if (items.length === 0) {
      return (
        <View
          style={{
            backgroundColor: '#fff',
            borderRadius: 16,
            padding: 18,
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 }}>
            Nic tu není
          </Text>
          <Text style={{ fontSize: 14, color: '#6b7280' }}>
            V tomto období nemáš žádné zakázky, události ani směny.
          </Text>
        </View>
      )
    }

    return (
      <View style={{ gap: 10 }}>
        {items.map((item) => (
          <Pressable
            key={`${item.type}-${item.id}-${item.startAt}`}
            onPress={() => openItem(item)}
            style={{
              backgroundColor: '#fff',
              borderRadius: 16,
              padding: 14,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
                gap: 8,
              }}
            >
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: getBadgeColor(item),
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#111827' }}>
                  {getBadgeLabel(item)}
                </Text>
              </View>

              <Text style={{ fontSize: 12, color: '#6b7280' }}>
                {formatDateLabel(item.startAt)}
              </Text>
            </View>

            <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 }}>
              {item.title}
            </Text>

            <Text style={{ fontSize: 14, color: '#374151', marginBottom: 2 }}>
              {formatRange(item)}
            </Text>

            {item.address ? (
              <Text style={{ fontSize: 14, color: '#374151', marginBottom: 2 }}>
                Místo: {item.address}
              </Text>
            ) : null}

            {item.description ? (
              <Text style={{ marginTop: 6, fontSize: 13, color: '#6b7280' }}>
                {item.description}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    )
  }

  function renderWeekMode() {
    return (
      <>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingBottom: 12 }}
        >
          {weekDays.map((day) => {
            const dayItems = getItemsForDay(day)
            const active = isSameDay(day, selectedDate)

            return (
              <Pressable
                key={day.toISOString()}
                onPress={() => setSelectedDate(day)}
                style={{
                  width: 90,
                  backgroundColor: active ? '#111827' : '#fff',
                  borderRadius: 16,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    color: active ? '#fff' : '#6b7280',
                    marginBottom: 4,
                  }}
                >
                  {new Intl.DateTimeFormat('cs-CZ', { weekday: 'short' }).format(day)}
                </Text>

                <Text
                  style={{
                    fontSize: 24,
                    fontWeight: '700',
                    color: active ? '#fff' : '#111827',
                  }}
                >
                  {day.getDate()}
                </Text>

                <Text
                  style={{
                    marginTop: 6,
                    fontSize: 13,
                    fontWeight: '700',
                    color: active ? '#93c5fd' : '#2563eb',
                  }}
                >
                  {dayItems.length}×
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>

        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 }}>
            Detail dne: {formatDateLabel(selectedDate)}
          </Text>

          {selectedDayItems.length === 0 ? (
            <View
              style={{
                backgroundColor: '#fff',
                borderRadius: 16,
                padding: 18,
              }}
            >
              <Text style={{ fontSize: 14, color: '#6b7280' }}>
                Na tento den není nic naplánováno.
              </Text>
            </View>
          ) : (
            selectedDayItems.map((item) => (
              <Pressable
                key={`${item.type}-${item.id}-${item.startAt}`}
                onPress={() => openItem(item)}
                style={{
                  backgroundColor: '#fff',
                  borderRadius: 16,
                  padding: 14,
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 }}>
                  {item.title}
                </Text>
                <Text style={{ fontSize: 14, color: '#374151', marginBottom: 2 }}>
                  {getBadgeLabel(item)} • {formatRange(item)}
                </Text>
                {item.address ? (
                  <Text style={{ fontSize: 14, color: '#374151' }}>
                    Místo: {item.address}
                  </Text>
                ) : null}
                {item.description ? (
                  <Text style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
                    {item.description}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </View>
      </>
    )
  }

  function renderMonthMode() {
    return (
      <>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            backgroundColor: '#fff',
            borderRadius: 16,
            padding: 8,
            marginBottom: 16,
          }}
        >
          {['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map((label) => (
            <View
              key={label}
              style={{
                width: '14.2857%',
                paddingVertical: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#6b7280' }}>{label}</Text>
            </View>
          ))}

          {monthDays.map((day) => {
            const dayItems = getItemsForDay(day)
            const active = isSameDay(day, selectedDate)
            const inCurrentMonth = day.getMonth() === anchorDate.getMonth()

            return (
              <Pressable
                key={day.toISOString()}
                onPress={() => setSelectedDate(day)}
                style={{
                  width: '14.2857%',
                  minHeight: 72,
                  padding: 6,
                  borderRadius: 12,
                  marginBottom: 4,
                  backgroundColor: active ? '#eff6ff' : 'transparent',
                  opacity: inCurrentMonth ? 1 : 0.45,
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '700',
                    color: active ? '#2563eb' : '#111827',
                    marginBottom: 4,
                  }}
                >
                  {day.getDate()}
                </Text>

                {dayItems.slice(0, 2).map((item) => (
                  <View
                    key={`${item.type}-${item.id}-${item.startAt}`}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      marginBottom: 4,
                      backgroundColor: getDotColor(item),
                    }}
                  />
                ))}

                {dayItems.length > 2 ? (
                  <Text style={{ fontSize: 10, color: '#6b7280' }}>
                    +{dayItems.length - 2}
                  </Text>
                ) : null}
              </Pressable>
            )
          })}
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 }}>
            Detail dne: {formatDateLabel(selectedDate)}
          </Text>

          {selectedDayItems.length === 0 ? (
            <View
              style={{
                backgroundColor: '#fff',
                borderRadius: 16,
                padding: 18,
              }}
            >
              <Text style={{ fontSize: 14, color: '#6b7280' }}>
                Na tento den není nic naplánováno.
              </Text>
            </View>
          ) : (
            selectedDayItems.map((item) => (
              <Pressable
                key={`${item.type}-${item.id}-${item.startAt}`}
                onPress={() => openItem(item)}
                style={{
                  backgroundColor: '#fff',
                  borderRadius: 16,
                  padding: 14,
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 }}>
                  {item.title}
                </Text>
                <Text style={{ fontSize: 14, color: '#374151', marginBottom: 2 }}>
                  {getBadgeLabel(item)} • {formatRange(item)}
                </Text>
                {item.address ? (
                  <Text style={{ fontSize: 14, color: '#374151' }}>
                    Místo: {item.address}
                  </Text>
                ) : null}
                {item.description ? (
                  <Text style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
                    {item.description}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </View>
      </>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={{ fontSize: 28, fontWeight: '700', color: '#111827', marginBottom: 4 }}>
          Kalendář
        </Text>

        <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 4 }}>
          Tvoje zakázky, interní události a směny
        </Text>

        {!!profileName ? (
          <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
            Přihlášený profil: {profileName}
          </Text>
        ) : (
          <View style={{ height: 16 }} />
        )}

        {renderModeSwitch()}
        {renderHeaderNav()}

        {loadingCalendar ? (
          <View
            style={{
              backgroundColor: '#fff',
              borderRadius: 16,
              padding: 24,
              alignItems: 'center',
            }}
          >
            <ActivityIndicator size="large" />
            <Text style={{ color: '#6b7280', marginTop: 10 }}>Načítám kalendář...</Text>
          </View>
        ) : !profileId ? (
          <View
            style={{
              backgroundColor: '#fff',
              borderRadius: 16,
              padding: 18,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 6 }}>
              Profil nenalezen
            </Text>
            <Text style={{ fontSize: 14, color: '#6b7280' }}>
              V AppSessionContext zatím není načtený profil.
            </Text>
          </View>
        ) : mode === 'list' ? (
          renderListMode()
        ) : mode === 'week' ? (
          renderWeekMode()
        ) : (
          renderMonthMode()
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
