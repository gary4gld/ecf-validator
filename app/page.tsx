'use client'

import { useState, useCallback, useRef } from 'react'
import { beautifyXml } from '@/lib/xml-beautifier'
import { detectInvoiceType, hasSignature } from '@/lib/xml-parser'
import { colorizeXmlLine } from '@/lib/xml-colorizer'
import { INVOICE_TYPE_LABELS } from '@/lib/types'
import type { ParsedXml, XmlLine } from '@/lib/types'

// ── Small icons (inline SVG keeps the bundle light) ───────────────────────────

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

type InputMode = 'paste' | 'upload'

export default function ValidatorPage() {
  const [mode, setMode]           = useState<InputMode>('paste')
  const [rawXml, setRawXml]       = useState('')
  const [parsedXml, setParsedXml] = useState<ParsedXml | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Core processing ──────────────────────────────────────────────────────────

  const processXml = useCallback((xml: string) => {
    if (!xml.trim()) return

    try {
      const beautified = beautifyXml(xml)
      const lines: XmlLine[] = beautified.split('\n').map((content, i) => ({
        number: i + 1,
        content,
        severity: null,  // populated by the validator in Stage 2
        issueId: null,
      }))

      setParsedXml({
        raw: xml,
        beautified,
        lines,
        invoiceType: detectInvoiceType(xml),
        hasSignature: hasSignature(xml),
        issues: [],  // populated by the validator in Stage 2
      })
      setParseError(null)
    } catch {
      setParseError('No se pudo procesar el XML. Verifique que sea XML válido y vuelva a intentarlo.')
      setParsedXml(null)
    }
  }, [])

  const handleValidate = () => processXml(rawXml)

  const handleReset = () => {
    setRawXml('')
    setParsedXml(null)
    setParseError(null)
    setMode('paste')
  }

  // ── File handling ─────────────────────────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      setParseError('Solo se aceptan archivos con extensión .xml')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setRawXml(content)
      processXml(content)
    }
    reader.onerror = () => {
      setParseError('No se pudo leer el archivo. Intente de nuevo.')
    }
    reader.readAsText(file, 'utf-8')
  }, [processXml])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>

      {/* ── Header ── */}
      <header
        className="border-b px-6 py-3 flex-shrink-0"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-white text-sm">ECF XML Validator</span>
            <span className="text-xs bg-blue-950 text-blue-300 px-2 py-0.5 rounded-full">
              beta
            </span>
          </div>
          <a
            href="https://github.com/gary4gld"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-white transition-colors"
            aria-label="GitHub"
          >
            <GitHubIcon />
          </a>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10">
        {!parsedXml ? (
          /* ── Input state ── */
          <div className="max-w-3xl mx-auto">
            <h1 className="text-2xl font-semibold text-white mb-1">
              Valida tu XML e-CF
            </h1>
            <p className="text-gray-400 text-sm mb-8 leading-relaxed">
              Pega o carga un XML de factura electrónica para verificarlo contra los
              esquemas XSD oficiales de la DGII.
            </p>

            {/* Mode tabs */}
            <div
              className="flex gap-1 mb-5 rounded-lg p-1 w-fit"
              style={{ background: 'var(--bg-surface)' }}
            >
              {(['paste', 'upload'] as InputMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`text-sm px-4 py-1.5 rounded-md transition-colors ${
                    mode === m
                      ? 'bg-white/10 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {m === 'paste' ? 'Pegar XML' : 'Cargar archivo'}
                </button>
              ))}
            </div>

            {mode === 'paste' ? (
              /* ── Paste textarea ── */
              <textarea
                value={rawXml}
                onChange={(e) => setRawXml(e.target.value)}
                placeholder="Pega tu XML aquí..."
                className="w-full h-80 rounded-xl px-4 py-3 text-sm text-gray-300 placeholder:text-gray-600 focus:outline-none resize-none"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  fontFamily: 'var(--font-mono), monospace',
                }}
                spellCheck={false}
              />
            ) : (
              /* ── Drag-and-drop area ── */
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`w-full h-80 rounded-xl flex flex-col items-center justify-center gap-4 cursor-pointer transition-colors`}
                style={{
                  border: `2px dashed ${isDragging ? 'rgba(96,165,250,0.5)' : 'var(--border)'}`,
                  background: isDragging ? 'rgba(96,165,250,0.04)' : 'var(--bg-surface)',
                }}
              >
                <span className="text-gray-600">
                  <UploadIcon />
                </span>
                <div className="text-center">
                  <p className="text-sm text-gray-400">
                    Arrastra tu archivo .xml aquí o{' '}
                    <span className="text-blue-400">haz clic para explorar</span>
                  </p>
                  <p className="text-xs text-gray-600 mt-1">Solo archivos .xml</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xml"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFile(file)
                  }}
                />
              </div>
            )}

            {/* Error message */}
            {parseError && (
              <p className="mt-3 text-sm text-red-400">{parseError}</p>
            )}

            {/* Validate button */}
            <button
              onClick={handleValidate}
              disabled={!rawXml.trim()}
              className="mt-5 px-6 py-2.5 bg-white text-gray-950 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Validar
            </button>
          </div>
        ) : (
          /* ── Results state ── */
          <div className="flex flex-col gap-4">

            {/* Info bar */}
            <div
              className="flex items-center justify-between flex-wrap gap-3 rounded-xl px-5 py-3"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-3 flex-wrap text-sm">
                <span className="text-gray-200 font-medium">
                  {INVOICE_TYPE_LABELS[parsedXml.invoiceType]}
                </span>
                <span className="text-gray-700">·</span>
                <span className={parsedXml.hasSignature ? 'text-emerald-400' : 'text-blue-400'}>
                  {parsedXml.hasSignature ? 'firmado' : 'pre-firma'}
                </span>
                <span className="text-gray-700">·</span>
                <span className="text-gray-500">
                  {parsedXml.lines.length} líneas
                </span>
                {/* Stage 2 will add severity badge counts here */}
              </div>

              <button
                onClick={handleReset}
                className="text-xs text-gray-500 hover:text-white transition-colors"
              >
                ← Validar otro
              </button>
            </div>

            {/* XML viewer
                Stage 1: full-width, no highlighting, no error panel.
                Stage 2: this becomes the left pane of a split layout and
                         individual lines receive severity classes. */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{ border: '1px solid var(--border)' }}
            >
              <div
                className="overflow-auto"
                style={{
                  background: '#0d1117',
                  fontFamily: 'var(--font-mono), monospace',
                  fontSize: '13px',
                  lineHeight: '1.88',
                  paddingTop: '12px',
                  paddingBottom: '12px',
                  minHeight: '480px',
                }}
              >
                {parsedXml.lines.map((line) => (
                  <XmlLineRow key={line.number} line={line} />
                ))}
              </div>
            </div>

          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer
        className="border-t px-6 py-4 text-xs text-gray-600 flex items-center justify-between flex-wrap gap-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <span>ECF XML Validator — Gary De la Cruz</span>
        <span>Open source · In development</span>
      </footer>
    </div>
  )
}

// ── XML line component ─────────────────────────────────────────────────────────
// Accepts a severity class for Stage 2 highlighting; renders cleanly without
// one in Stage 1. The left border is always present but transparent by default.

function XmlLineRow({ line }: { line: XmlLine }) {
  const severityClass = line.severity ? `line-${line.severity}` : ''

  return (
    <div
      className={`flex ${severityClass}`}
      style={{ borderLeft: '4px solid transparent' }}
      data-line={line.number}
      data-issue={line.issueId ?? undefined}
    >
      {/* Line number */}
      <span
        style={{
          width: '48px',
          minWidth: '48px',
          textAlign: 'right',
          paddingRight: '16px',
          color: '#484f58',
          fontSize: '11px',
          userSelect: 'none',
          paddingTop: '1px',
        }}
        aria-hidden="true"
      >
        {line.number}
      </span>

      {/* Code content — syntax-highlighted HTML from colorizeXmlLine */}
      <span
        className="flex-1 whitespace-pre overflow-hidden pr-6"
        style={{ color: '#e6edf3' }}
        dangerouslySetInnerHTML={{ __html: colorizeXmlLine(line.content) }}
      />
    </div>
  )
}