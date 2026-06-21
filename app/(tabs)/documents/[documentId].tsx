import { Ionicons } from '@expo/vector-icons'
import * as WebBrowser from 'expo-web-browser'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from 'react-native'
import SignatureCanvas, {
  type SignatureViewRef,
} from 'react-native-signature-canvas'
import { useAppSession } from '../../../contexts/AppSessionContext'
import {
  createEmployeeDocumentPdfUrl,
  loadEmployeeDocumentDetail,
  signEmployeeDocument,
  type EmployeeDocument,
  type EmployeeDocumentDetail,
  type EmployeeDocumentItem,
  type EmployeeDocumentSignature,
  type EmployeeDocumentStatusTone,
} from '../../../lib/employeeDocuments'

const TONE_COLORS: Record<EmployeeDocumentStatusTone, { bg: string; text: string }> = {
  warning: { bg: '#ffedd5', text: '#c2410c' },
  success: { bg: '#dcfce7', text: '#166534' },
  danger: { bg: '#fee2e2', text: '#991b1b' },
  muted: { bg: '#f1f5f9', text: '#475569' },
  info: { bg: '#dbeafe', text: '#1d4ed8' },
}

const SIGNATURE_WEB_STYLE = `
  .m-signature-pad { box-shadow: none; border: 0; margin: 0; width: 100%; height: 100%; }
  .m-signature-pad--body { border: 0; left: 0; right: 0; top: 0; bottom: 0; }
  .m-signature-pad--footer { display: none; margin: 0; }
  body, html { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #ffffff; }
  canvas { width: 100% !important; height: 100% !important; }
`

function formatDateTime(value: string | null) {
  if (!value) return 'Neuvedeno'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 14,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
      }}
    >
      <Text style={{ color: '#64748b', fontSize: 14 }}>{label}</Text>
      <Text
        style={{
          color: '#0f172a',
          fontSize: 14,
          fontWeight: '800',
          flex: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </Text>
    </View>
  )
}

function DocumentItemRow({ item }: { item: EmployeeDocumentItem }) {
  return (
    <View
      style={{
        backgroundColor: '#f8fafc',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
      }}
    >
      <Text style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>{item.label}</Text>
      <Text style={{ color: '#0f172a', fontSize: 15, lineHeight: 22 }}>
        {item.value ?? 'Neuvedeno'}
      </Text>
    </View>
  )
}

function SignatureHistory({ signatures }: { signatures: EmployeeDocumentSignature[] }) {
  if (signatures.length === 0) {
    return (
      <Text style={{ color: '#64748b', fontSize: 14, lineHeight: 21 }}>
        Dokument zatím nemá uložený podpis.
      </Text>
    )
  }

  return (
    <View style={{ gap: 10 }}>
      {signatures.map((signature) => (
        <View
          key={signature.id}
          style={{
            backgroundColor: '#f8fafc',
            borderRadius: 12,
            padding: 12,
            borderWidth: 1,
            borderColor: '#e2e8f0',
          }}
        >
          <Text style={{ color: '#0f172a', fontSize: 15, fontWeight: '800', marginBottom: 4 }}>
            {signature.signerName ?? 'Zaměstnanec'}
          </Text>
          <Text style={{ color: '#64748b', fontSize: 13 }}>
            Podepsáno: {formatDateTime(signature.signedAt)}
          </Text>
        </View>
      ))}
    </View>
  )
}

export default function EmployeeDocumentDetailScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ documentId?: string }>()
  const { loading: sessionLoading, session, user, profileId } = useAppSession()
  const signatureRef = useRef<SignatureViewRef | null>(null)

  const documentId = Array.isArray(params.documentId)
    ? params.documentId[0]
    : params.documentId

  const [detail, setDetail] = useState<EmployeeDocumentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [openingPdf, setOpeningPdf] = useState(false)
  const [scrollEnabled, setScrollEnabled] = useState(true)
  const [hasSignatureInput, setHasSignatureInput] = useState(false)
  const [savingSignature, setSavingSignature] = useState(false)

  const loadDetail = useCallback(async () => {
    if (!documentId || !profileId) {
      setDetail(null)
      setLoading(false)
      return
    }

    setErrorText(null)

    try {
      const nextDetail = await loadEmployeeDocumentDetail(documentId, profileId)
      setDetail(nextDetail)
    } catch (error: any) {
      console.error('EMPLOYEE_DOCUMENT_DETAIL_LOAD_ERROR', error)
      setErrorText(error?.message ?? 'Nepodařilo se načíst dokument.')
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [documentId, profileId])

  useEffect(() => {
    if (sessionLoading) return
    setLoading(true)
    loadDetail()
  }, [loadDetail, sessionLoading])

  async function openPdf(document: EmployeeDocument) {
    if (openingPdf) return

    setOpeningPdf(true)

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
      setOpeningPdf(false)
    }
  }

  function clearSignature() {
    signatureRef.current?.clearSignature()
    setHasSignatureInput(false)
  }

  function requestSignatureSave() {
    if (!detail?.document.isAwaitingSignature || savingSignature) return

    if (!hasSignatureInput) {
      Alert.alert('Chybí podpis', 'Nejdřív se podepiš do podpisového pole.')
      return
    }

    setSavingSignature(true)
    signatureRef.current?.readSignature()
  }

  async function handleSignatureReady(signatureDataUrl: string) {
    if (!detail?.document || !profileId) {
      setSavingSignature(false)
      return
    }

    if (!signatureDataUrl || signatureDataUrl.length < 200) {
      setSavingSignature(false)
      Alert.alert('Chybí podpis', 'Podpisové pole je prázdné.')
      return
    }

    try {
      await signEmployeeDocument({
        documentId: detail.document.id,
        signatureDataUrl,
        accessToken: session?.access_token,
      })

      clearSignature()
      await loadDetail()
      Alert.alert('Podepsáno', 'Dokument byl podepsán a uložen.')
    } catch (error: any) {
      Alert.alert('Chyba', error?.message ?? 'Podpis se nepodařilo uložit.')
    } finally {
      setSavingSignature(false)
    }
  }

  function handleSignatureEmpty() {
    setSavingSignature(false)
    setHasSignatureInput(false)
    Alert.alert('Chybí podpis', 'Podpisové pole je prázdné.')
  }

  if (sessionLoading || loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <ActivityIndicator size="large" color="#0f2a44" />
          <Text style={{ marginTop: 12, color: '#475569', fontSize: 15 }}>
            Načítám dokument...
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!user || !profileId || !documentId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
          <Text style={{ color: '#0f172a', fontSize: 20, fontWeight: '800', marginBottom: 8 }}>
            Dokument nejde otevřít
          </Text>
          <Text style={{ color: '#475569', fontSize: 14, lineHeight: 21 }}>
            Chybí přihlášený profil nebo identifikátor dokumentu.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!detail) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
        <View style={{ flex: 1, padding: 20 }}>
          <Pressable
            onPress={() => router.back()}
            style={{
              alignSelf: 'flex-start',
              backgroundColor: '#e2e8f0',
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 10,
              marginBottom: 16,
            }}
          >
            <Text style={{ color: '#0f172a', fontWeight: '800' }}>Zpět</Text>
          </Pressable>

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
              Dokument nebyl nalezen
            </Text>
            <Text style={{ color: '#475569', fontSize: 14, lineHeight: 21 }}>
              {errorText ?? 'Dokument buď neexistuje, nebo nepatří k tvému profilu.'}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const { document, items, signatures } = detail

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f7fb' }}>
      <ScrollView
        scrollEnabled={scrollEnabled}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{
            alignSelf: 'flex-start',
            backgroundColor: '#e2e8f0',
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 10,
            marginBottom: 14,
          }}
        >
          <Text style={{ color: '#0f172a', fontWeight: '800' }}>Zpět</Text>
        </Pressable>

        <View
          style={{
            backgroundColor: '#0f2a44',
            borderRadius: 16,
            padding: 18,
            marginBottom: 14,
          }}
        >
          <StatusBadge document={document} />

          <Text style={{ color: '#ffffff', fontSize: 25, fontWeight: '900', marginTop: 12 }}>
            {document.title}
          </Text>

          <Text style={{ color: '#cbd5e1', marginTop: 8, fontSize: 15 }}>
            {document.documentType}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            marginBottom: 14,
          }}
        >
          <Text style={{ color: '#0f172a', fontSize: 18, fontWeight: '900', marginBottom: 8 }}>
            Údaje dokumentu
          </Text>
          <InfoRow label="Vytvořeno" value={formatDate(document.createdAt)} />
          <InfoRow label="Platnost od" value={formatDate(document.validFrom)} />
          <InfoRow label="Platnost do" value={formatDate(document.validTo)} />
          <InfoRow label="Podpis" value={document.signedAt ? formatDateTime(document.signedAt) : 'Nepodepsáno'} />
        </View>

        {items.length > 0 ? (
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: '#e2e8f0',
              marginBottom: 14,
              gap: 10,
            }}
          >
            <Text style={{ color: '#0f172a', fontSize: 18, fontWeight: '900' }}>
              Položky dokumentu
            </Text>
            {items.map((item) => (
              <DocumentItemRow key={item.id} item={item} />
            ))}
          </View>
        ) : null}

        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            marginBottom: 14,
          }}
        >
          <Text style={{ color: '#0f172a', fontSize: 18, fontWeight: '900', marginBottom: 10 }}>
            Text dokumentu
          </Text>
          <Text style={{ color: '#334155', fontSize: 15, lineHeight: 23 }}>
            {document.textContent ?? 'Text dokumentu není v aplikaci uložený. Otevři PDF náhled.'}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            marginBottom: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Ionicons name="document-attach-outline" size={22} color="#0f2a44" />
            <Text style={{ color: '#0f172a', fontSize: 18, fontWeight: '900' }}>
              PDF náhled
            </Text>
          </View>

          <Text style={{ color: '#475569', fontSize: 14, lineHeight: 21, marginBottom: 12 }}>
            {document.pdfStoragePath
              ? 'PDF je dostupné přes zabezpečený krátkodobý odkaz.'
              : 'PDF se připravuje.'}
          </Text>

          <Pressable
            onPress={() => openPdf(document)}
            disabled={openingPdf || !document.pdfStoragePath}
            style={{
              backgroundColor: document.pdfStoragePath ? '#0f2a44' : '#cbd5e1',
              borderRadius: 13,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: openingPdf ? 0.7 : 1,
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '900' }}>
              {openingPdf ? 'Otevírám PDF...' : 'Otevřít PDF'}
            </Text>
          </Pressable>
        </View>

        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: '#e2e8f0',
            marginBottom: 14,
          }}
        >
          <Text style={{ color: '#0f172a', fontSize: 18, fontWeight: '900', marginBottom: 10 }}>
            Historie podpisů
          </Text>
          <SignatureHistory signatures={signatures} />
        </View>

        {document.isAwaitingSignature ? (
          <View
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: '#fed7aa',
            }}
          >
            <Text style={{ color: '#0f172a', fontSize: 18, fontWeight: '900', marginBottom: 8 }}>
              Podpis dokumentu
            </Text>
            <Text style={{ color: '#475569', fontSize: 14, lineHeight: 21, marginBottom: 12 }}>
              Podepiš se prstem do pole níže. Po uložení už dokument nepůjde podepsat znovu.
            </Text>

            <View
              style={{
                height: 230,
                borderRadius: 14,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: '#cbd5e1',
                backgroundColor: '#ffffff',
                marginBottom: 12,
              }}
            >
              <SignatureCanvas
                ref={signatureRef}
                onBegin={() => {
                  setScrollEnabled(false)
                  setHasSignatureInput(true)
                }}
                onEnd={() => setScrollEnabled(true)}
                onOK={handleSignatureReady}
                onEmpty={handleSignatureEmpty}
                onClear={() => setHasSignatureInput(false)}
                onError={(error) => {
                  setSavingSignature(false)
                  Alert.alert('Chyba podpisu', error.message)
                }}
                autoClear={false}
                backgroundColor="#ffffff"
                penColor="#0f172a"
                imageType="image/png"
                minWidth={1.2}
                maxWidth={3}
                trimWhitespace
                webStyle={SIGNATURE_WEB_STYLE}
                webviewContainerStyle={{ flex: 1 }}
                style={{ flex: 1 }}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={clearSignature}
                disabled={savingSignature}
                style={{
                  flex: 1,
                  backgroundColor: '#e2e8f0',
                  borderRadius: 13,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#0f172a', fontSize: 15, fontWeight: '900' }}>
                  Vymazat
                </Text>
              </Pressable>

              <Pressable
                onPress={requestSignatureSave}
                disabled={savingSignature}
                style={{
                  flex: 1,
                  backgroundColor: '#ea580c',
                  borderRadius: 13,
                  paddingVertical: 14,
                  alignItems: 'center',
                  opacity: savingSignature ? 0.7 : 1,
                }}
              >
                <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '900' }}>
                  {savingSignature ? 'Ukládám...' : 'Podepsat dokument'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: '#ecfdf5',
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: '#bbf7d0',
            }}
          >
            <Text style={{ color: '#166534', fontSize: 16, fontWeight: '900' }}>
              Dokument je uzamčený pro další podpis.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
