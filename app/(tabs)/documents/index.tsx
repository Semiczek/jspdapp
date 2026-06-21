import { Ionicons } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { useFocusEffect, useRouter } from 'expo-router'
import React, { useCallback, useMemo, useState } from 'react'
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
import { useAppSession } from '../../../contexts/AppSessionContext'
import {
  createEmployeeDocumentPdfUrl,
  loadEmployeeDocuments,
  type EmployeeDocument,
  type EmployeeDocumentStatusTone,
} from '../../../lib/employeeDocuments'

const TONE_COLORS: Record<EmployeeDocumentStatusTone, { bg: string; text: string }> = {
  warning: { bg: '#ffedd5', text: '#c2410c' },
  success: { bg: '#dcfce7', text: '#166534' },
  danger: { bg: '#fee2e2', text: '#991b1b' },
  muted: { bg: '#f1f5f9', text: '#475569' },
  info: { bg: '#dbeafe', text: '#1d4ed8' },
}

function formatDate(value: string | null) {
  if (!value) return 'Neuvedeno'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatSignatureInfo(document: EmployeeDocument) {
  if (document.signedAt) {
    return `Podepsáno ${formatDate(document.signedAt)}`
  }

  if (document.signatureCount > 0) {
    return `Podpisů: ${document.signatureCount}`
  }

  return 'Bez podpisu'
}

function StatusBadge({ document }: { document: EmployeeDocument }) {
  const colors = TONE_COLORS[document.statusTone]

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: colors.bg,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
        {document.statusLabel}
      </Text>
    </View>
  )
}

export default function EmployeeDocumentsScreen() {
  const router = useRouter()
  const { loading: sessionLoading, user, profileId } = useAppSession()

  const [documents, setDocuments] = useState<EmployeeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [openingPdfId, setOpeningPdfId] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)

  const waitingCount = useMemo(() => {
    return documents.filter((document) => document.isAwaitingSignature).length
  }, [documents])

  const loadDocuments = useCallback(async () => {
    if (!profileId) {
      setDocuments([])
      setLoading(false)
      return
    }

    setErrorText(null)

    try {
      const nextDocuments = await loadEmployeeDocuments(profileId)
      setDocuments(nextDocuments)
    } catch (error: any) {
      console.error('EMPLOYEE_DOCUMENTS_LOAD_ERROR', error)
      setErrorText(error?.message ?? 'Nepodařilo se načíst dokumenty.')
      setDocuments([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [profileId])

  useFocusEffect(
    useCallback(() => {
      if (sessionLoading) return
      setLoading(true)
      loadDocuments()
    }, [loadDocuments, sessionLoading])
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadDocuments()
  }, [loadDocuments])

  async function openPdf(document: EmployeeDocument) {
    if (openingPdfId) return

    setOpeningPdfId(document.id)

    try {
      const url = await createEmployeeDocumentPdfUrl(document)

      if (!url) {
        Alert.alert('PDF se připravuje', 'Dokument zatím nemá dostupný PDF soubor.')
        return
      }

      await WebBrowser.openBrowserAsync(url)
    } catch (error: any) {
      Alert.alert('Chyba', error?.message ?? 'PDF se nepodařilo otevřít.')
    } finally {
      setOpeningPdfId(null)
    }
  }

  if (sessionLoading || loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <ActivityIndicator size="large" color="#0f2a44" />
          <Text style={{ marginTop: 12, color: '#475569', fontSize: 15 }}>
            Načítám dokumenty...
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!user || !profileId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 18,
              borderWidth: 1,
              borderColor: '#e2e8f0',
            }}
          >
            <Text style={{ color: '#0f172a', fontSize: 20, fontWeight: '800', marginBottom: 8 }}>
              Relace není připravená
            </Text>
            <Text style={{ color: '#475569', fontSize: 14, lineHeight: 21 }}>
              Přihlas se znovu, aby aplikace mohla načíst tvoje dokumenty.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View
          style={{
            backgroundColor: '#0f2a44',
            borderRadius: 16,
            padding: 18,
            marginBottom: 16,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.14)',
              }}
            >
              <Ionicons name="document-text-outline" size={24} color="#ffffff" />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={{ color: '#ffffff', fontSize: 26, fontWeight: '900' }}>
                Dokumenty
              </Text>
              <Text style={{ color: '#cbd5e1', marginTop: 4, fontSize: 14 }}>
                {waitingCount > 0
                  ? `${waitingCount} čeká na tvůj podpis`
                  : 'Všechny dostupné pracovní dokumenty'}
              </Text>
            </View>
          </View>
        </View>

        {errorText ? (
          <View
            style={{
              backgroundColor: '#fef2f2',
              borderRadius: 14,
              padding: 14,
              borderWidth: 1,
              borderColor: '#fecaca',
              marginBottom: 14,
            }}
          >
            <Text style={{ color: '#991b1b', fontSize: 14, lineHeight: 21 }}>{errorText}</Text>
          </View>
        ) : null}

        {documents.length === 0 ? (
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 18,
              borderWidth: 1,
              borderColor: '#e2e8f0',
            }}
          >
            <Text style={{ color: '#0f172a', fontSize: 18, fontWeight: '800', marginBottom: 8 }}>
              Zatím tu nejsou dokumenty
            </Text>
            <Text style={{ color: '#475569', fontSize: 14, lineHeight: 21 }}>
              Jakmile ti firma připraví pracovní dokument, zobrazí se tady.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {documents.map((document) => (
              <View
                key={document.id}
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: document.isAwaitingSignature ? '#fed7aa' : '#e2e8f0',
                }}
              >
                <View style={{ gap: 10 }}>
                  <StatusBadge document={document} />

                  <Text style={{ color: '#0f172a', fontSize: 19, fontWeight: '900' }}>
                    {document.title}
                  </Text>

                  <View style={{ gap: 5 }}>
                    <Text style={{ color: '#475569', fontSize: 14 }}>
                      Typ: <Text style={{ fontWeight: '800' }}>{document.documentType}</Text>
                    </Text>
                    <Text style={{ color: '#475569', fontSize: 14 }}>
                      Vytvořeno: {formatDate(document.createdAt)}
                    </Text>
                    <Text style={{ color: '#475569', fontSize: 14 }}>
                      Platnost: {formatDate(document.validFrom)} - {formatDate(document.validTo)}
                    </Text>
                    <Text style={{ color: '#475569', fontSize: 14 }}>
                      {formatSignatureInfo(document)}
                    </Text>
                  </View>

                  <View style={{ gap: 10, marginTop: 4 }}>
                    {document.isAwaitingSignature ? (
                      <Pressable
                        onPress={() =>
                          router.push(`/(tabs)/documents/${document.id}` as any)
                        }
                        style={{
                          backgroundColor: '#ea580c',
                          borderRadius: 13,
                          paddingVertical: 14,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '900' }}>
                          Podepsat
                        </Text>
                      </Pressable>
                    ) : null}

                    <Pressable
                      onPress={() => router.push(`/(tabs)/documents/${document.id}` as any)}
                      style={{
                        backgroundColor: '#0f2a44',
                        borderRadius: 13,
                        paddingVertical: 13,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '800' }}>
                        Zobrazit dokument
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => openPdf(document)}
                      disabled={openingPdfId === document.id}
                      style={{
                        backgroundColor: '#e2e8f0',
                        borderRadius: 13,
                        paddingVertical: 13,
                        alignItems: 'center',
                        opacity: openingPdfId === document.id ? 0.65 : 1,
                      }}
                    >
                      <Text style={{ color: '#0f172a', fontSize: 15, fontWeight: '800' }}>
                        {openingPdfId === document.id ? 'Otevírám PDF...' : 'Otevřít PDF'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
