'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { beautifyXml }        from '@/lib/xml-beautifier'
import { detectInvoiceType, hasSignature } from '@/lib/xml-parser'
import { colorizeXmlLine }    from '@/lib/xml-colorizer'
import { validate }           from '@/lib/validators/validator'
import { checkRNCRegistry }   from '@/lib/validators/registry-checks'
import { INVOICE_TYPE_LABELS } from '@/lib/types'
import type { ParsedXml, ValidationIssue, XmlLine, Severity } from '@/lib/types'

// ── Severity colour map ────────────────────────────────────────────────────────

const SEV = {
  red:    { bg: 'rgba(239,68,68,0.09)',  color: '#ef4444', text: '#f87171', labelS: 'error',        labelP: 'errores'        },
  orange: { bg: 'rgba(249,115,22,0.09)', color: '#f97316', text: '#fb923c', labelS: 'discrepancia', labelP: 'discrepancias'  },
  yellow: { bg: 'rgba(234,179,8,0.09)',  color: '#eab308', text: '#fde047', labelS: 'advertencia',  labelP: 'advertencias'   },
  blue:   { bg: 'rgba(96,165,250,0.09)', color: '#60a5fa', text: '#93c5fd', labelS: 'nota',         labelP: 'notas'          },
} as const satisfies Record<Severity, { bg: string; color: string; text: string; labelS: string; labelP: string }>

const SEV_ORDER: Severity[] = ['red', 'orange', 'yellow', 'blue']

// ── Icons ─────────────────────────────────────────────────────────────────────

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

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * A single line in the XML viewer.
 *
 * - severity + issueId come from the validation pass.
 * - isActive brightens the line when its issue is selected in the error panel.
 * - allClear applies the green tint when there are zero issues.
 */
function XmlLineRow({
  line,
  isActive,
  allClear,
  onClick,
}: {
  line: XmlLine
  isActive: boolean
  allClear: boolean
  onClick?: () => void
}) {
  const cls = allClear ? 'line-green' : line.severity ? `line-${line.severity}` : ''

  return (
    <div
      className={cls}
      data-line={line.number}
      onClick={onClick}
      style={{
        display: 'flex',
        borderLeft: '4px solid transparent',
        cursor: onClick ? 'pointer' : 'default',
        filter: isActive ? 'brightness(1.35)' : undefined,
        transition: 'filter 0.15s ease',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '48px',
          minWidth: '48px',
          textAlign: 'right',
          paddingRight: '16px',
          color: line.severity ? SEV[line.severity].color : '#484f58',
          fontSize: '11px',
          opacity: line.severity ? 0.85 : 0.45,
          userSelect: 'none',
          paddingTop: '1px',
        }}
      >
        {line.number}
      </span>
      <span
        className="flex-1 whitespace-pre overflow-hidden pr-6"
        style={{ color: '#e6edf3' }}
        dangerouslySetInnerHTML={{ __html: colorizeXmlLine(line.content) }}
      />
    </div>
  )
}

/** A single error card in the right panel. */
function ErrorCard({
  issue,
  isActive,
  onClick,
}: {
  issue: ValidationIssue
  isActive: boolean
  onClick: () => void
}) {
  const c = SEV[issue.severity]

  return (
    <div
      data-issue-id={issue.id}
      onClick={onClick}
      className="rounded-lg p-3 mb-2 last:mb-0 cursor-pointer transition-all duration-150"
      style={{
        background: c.bg,
        borderTop:    `1px solid rgba(255,255,255,${isActive ? 0.16 : 0.06})`,
        borderRight:  `1px solid rgba(255,255,255,${isActive ? 0.16 : 0.06})`,
        borderBottom: `1px solid rgba(255,255,255,${isActive ? 0.16 : 0.06})`,
        borderLeft:   `3px solid ${c.color}`,
      }}
    >
      {/* Field label */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: c.color }}
        />
        <code
          className="text-xs font-medium"
          style={{ color: c.text, fontFamily: 'var(--font-mono)' }}
        >
          &lt;{issue.field}&gt;
        </code>
      </div>

      {/* Message */}
      <p className="text-xs text-gray-400 leading-relaxed mb-1.5">
        {issue.message}
      </p>

      {/* Line reference */}
      <p className="text-[10px] text-gray-600">
        {issue.line != null ? `línea ${issue.line}` : 'documento'}
      </p>
    </div>
  )
}

/** Right-hand error panel — scrollable, sticky on desktop. */
function ErrorPanel({
  issues,
  activeIssueId,
  onSelect,
  panelRef,
  registryPending,
}: {
  issues: ValidationIssue[]
  activeIssueId: string | null
  onSelect: (id: string) => void
  panelRef: React.RefObject<HTMLDivElement | null>
  registryPending: boolean
}) {
  if (issues.length === 0 && !registryPending) {
    return (
      <div
        className="rounded-2xl flex flex-col items-center justify-center py-12 px-6 text-center"
        style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)', minHeight: '200px' }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
          style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}
        >
          <CheckIcon />
        </div>
        <p className="text-sm font-medium text-emerald-400 mb-1">Sin problemas</p>
        <p className="text-xs text-gray-500">No se encontraron errores en el XML.</p>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className="rounded-2xl overflow-y-auto"
      style={{
        border: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        maxHeight: '640px',
      }}
    >
      {/* Panel header */}
      <div
        className="sticky top-0 px-4 py-3"
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          zIndex: 1,
        }}
      >
        <p className="text-sm font-medium text-gray-300">
          {issues.length} issue{issues.length !== 1 ? 's' : ''} encontrado{issues.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Cards — sorted red → orange → yellow → blue */}
      <div className="p-3">
        {SEV_ORDER.flatMap((sev) =>
          issues
            .filter((i) => i.severity === sev)
            .map((issue) => (
              <ErrorCard
                key={issue.id}
                issue={issue}
                isActive={activeIssueId === issue.id}
                onClick={() => onSelect(issue.id)}
              />
            )),
        )}

        {/* Registry check spinner */}
        {registryPending && (
          <div
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl mt-1"
            style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)' }}
          >
            <svg
              className="shrink-0 animate-spin"
              width="14" height="14" viewBox="0 0 14 14" fill="none"
              style={{ color: '#60a5fa' }}
            >
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
              <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="text-xs text-blue-400">Verificando RNCs en registro DGII…</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

type InputMode = 'paste' | 'upload'

export default function ValidatorPage() {
  const [mode,          setMode]          = useState<InputMode>('paste')
  const [rawXml,        setRawXml]        = useState('')
  const [parsedXml,     setParsedXml]     = useState<ParsedXml | null>(null)
  const [parseError,    setParseError]    = useState<string | null>(null)
  const [isDragging,    setIsDragging]    = useState(false)
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null)
  const [registryIssues,  setRegistryIssues]  = useState<ValidationIssue[]>([])
  const [registryPending, setRegistryPending] = useState(false)

  const fileInputRef    = useRef<HTMLInputElement>(null)
  const xmlContainerRef = useRef<HTMLDivElement>(null)
  const errorPanelRef   = useRef<HTMLDivElement>(null)

  // ── Async registry check ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!parsedXml) {
      setRegistryIssues([])
      setRegistryPending(false)
      return
    }

    setRegistryIssues([])
    setRegistryPending(true)

    let cancelled = false

    checkRNCRegistry(parsedXml.raw, parsedXml.invoiceType)
      .then((issues) => {
        if (!cancelled) {
          setRegistryIssues(issues)
          setRegistryPending(false)
        }
      })
      .catch(() => {
        if (!cancelled) setRegistryPending(false)
      })

    return () => { cancelled = true }
  }, [parsedXml])

  // ── Click handlers ──────────────────────────────────────────────────────────

  /** Called when an error card is clicked — scrolls the XML pane to that line. */
  function handleSelectIssue(issueId: string) {
    setActiveIssueId(issueId)
    const allIssues = [...(parsedXml?.issues ?? []), ...registryIssues]
    const issue = allIssues.find((i) => i.id === issueId)
    if (issue?.line) {
      const el = xmlContainerRef.current?.querySelector(`[data-line="${issue.line}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  /** Called when a highlighted XML line is clicked — scrolls the error panel to that card. */
  function handleLineClick(issueId: string) {
    setActiveIssueId(issueId)
    const el = errorPanelRef.current?.querySelector(`[data-issue-id="${issueId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  // ── Core processing ─────────────────────────────────────────────────────────

  const processXml = useCallback((xml: string) => {
    if (!xml.trim()) return
    setActiveIssueId(null)

    try {
      const beautified  = beautifyXml(xml)
      const invoiceType = detectInvoiceType(xml)
      const signed      = hasSignature(xml)

      // Build initial lines (no severity yet)
      const rawLines: XmlLine[] = beautified.split('\n').map((content, i) => ({
        number:   i + 1,
        content,
        severity: null,
        issueId:  null,
      }))

      // Run validation against the initial state
      const initial: ParsedXml = {
        raw: xml,
        beautified,
        lines:        rawLines,
        invoiceType,
        hasSignature: signed,
        issues:       [],
      }

      const issues = validate(initial)

      // Map issues back to lines so the viewer can highlight them
      const mappedLines = rawLines.map((line) => {
        const hit = issues.find((issue) => issue.line === line.number)
        return hit ? { ...line, severity: hit.severity, issueId: hit.id } : line
      })

      setParsedXml({ ...initial, lines: mappedLines, issues })
      setParseError(null)
    } catch {
      setParseError(
        'No se pudo procesar el XML. Verifique que sea XML válido y vuelva a intentarlo.',
      )
      setParsedXml(null)
    }
  }, [])

  const handleValidate = () => processXml(rawXml)
  const handleReset    = () => {
    setRawXml('')
    setParsedXml(null)
    setParseError(null)
    setActiveIssueId(null)
    setMode('paste')
  }

  // ── File handling ───────────────────────────────────────────────────────────

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith('.xml')) {
        setParseError('Solo se aceptan archivos con extensión .xml')
        return
      }
      const reader = new FileReader()
      reader.onload  = (e) => {
        const text = e.target?.result as string
        setRawXml(text)
        processXml(text)
      }
      reader.onerror = () => setParseError('No se pudo leer el archivo. Intente de nuevo.')
      reader.readAsText(file, 'utf-8')
    },
    [processXml],
  )

  // ── Severity badge counts ───────────────────────────────────────────────────

  const allIssues = [...(parsedXml?.issues ?? []), ...registryIssues]
  const counts = allIssues.reduce<Partial<Record<Severity, number>>>(
    (acc, issue) => ({ ...acc, [issue.severity]: (acc[issue.severity] ?? 0) + 1 }),
    {},
  ) ?? {}

  const allClear = allIssues.length === 0 && !registryPending

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)' }}>

      {/* ── Header ── */}
      <header
        className="shrink-0 border-b px-6 py-3 flex items-center justify-between"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-white text-sm">ECF XML Validator</span>
          <span className="text-xs bg-blue-950 text-blue-300 px-2 py-0.5 rounded-full">beta</span>
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
      </header>

      {/* ── Main ── */}
      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-6 py-8">
        {!parsedXml ? (

          /* ──────── Input state ──────── */
          <div className="max-w-3xl mx-auto">
            <h1 className="text-2xl font-semibold text-white mb-1">Valida tu XML e-CF</h1>
            <p className="text-gray-400 text-sm mb-8 leading-relaxed">
              Pega o carga un XML de factura electrónica para verificarlo contra los esquemas XSD
              oficiales de la DGII.
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
                    mode === m ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {m === 'paste' ? 'Pegar XML' : 'Cargar archivo'}
                </button>
              ))}
            </div>

            {mode === 'paste' ? (
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
              <div
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-80 rounded-xl flex flex-col items-center justify-center gap-4 cursor-pointer transition-colors"
                style={{
                  border: `2px dashed ${isDragging ? 'rgba(96,165,250,0.5)' : 'var(--border)'}`,
                  background: isDragging ? 'rgba(96,165,250,0.04)' : 'var(--bg-surface)',
                }}
              >
                <span className="text-gray-600"><UploadIcon /></span>
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
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                />
              </div>
            )}

            {parseError && <p className="mt-3 text-sm text-red-400">{parseError}</p>}

            <button
              onClick={handleValidate}
              disabled={!rawXml.trim()}
              className="mt-5 px-6 py-2.5 bg-white text-gray-950 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Validar
            </button>
          </div>

        ) : (

          /* ──────── Results state ──────── */
          <div className="flex flex-col gap-4">

            {/* Info bar */}
            <div
              className="flex items-center justify-between flex-wrap gap-3 rounded-xl px-5 py-3"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-3 flex-wrap">
                {/* Invoice type */}
                <span className="text-sm font-medium text-gray-200">
                  {INVOICE_TYPE_LABELS[parsedXml.invoiceType]}
                </span>
                <span className="text-gray-700">·</span>
                {/* Signature status */}
                <span className={`text-sm ${parsedXml.hasSignature ? 'text-emerald-400' : 'text-blue-400'}`}>
                  {parsedXml.hasSignature ? 'firmado' : 'pre-firma'}
                </span>
                <span className="text-gray-700">·</span>
                {/* Line count */}
                <span className="text-sm text-gray-500">{parsedXml.lines.length} líneas</span>

                {/* Severity badges — only shown severities that have ≥ 1 issue */}
                {allIssues.length > 0 && (
                  <>
                    <span className="text-gray-700">·</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {SEV_ORDER.map((sev) => {
                        const n = counts[sev] ?? 0
                        if (!n) return null
                        const c = SEV[sev]
                        return (
                          <span
                            key={sev}
                            className="text-xs px-2.5 py-0.5 rounded-full flex items-center gap-1.5"
                            style={{
                              background: c.bg,
                              border: `1px solid ${c.color}40`,
                              color: c.text,
                            }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />
                            {n} {n === 1 ? c.labelS : c.labelP}
                          </span>
                        )
                      })}
                    </div>
                  </>
                )}

                {/* All-clear badge */}
                {allClear && (
                  <>
                    <span className="text-gray-700">·</span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full text-emerald-400 flex items-center gap-1.5" style={{ background: 'rgba(34,197,94,0.09)', border: '1px solid rgba(34,197,94,0.3)' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      sin errores
                    </span>
                  </>
                )}
              </div>

              <button
                onClick={handleReset}
                className="text-xs text-gray-500 hover:text-white transition-colors shrink-0"
              >
                ← Validar otro
              </button>
            </div>

            {/* Split pane */}
            <div className="flex flex-col lg:flex-row gap-4 items-start">

              {/* XML viewer — left */}
              <div
                className="flex-1 min-w-0 rounded-2xl overflow-hidden"
                style={{ border: '1px solid var(--border)' }}
              >
                <div
                  ref={xmlContainerRef}
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
                    <XmlLineRow
                      key={line.number}
                      line={line}
                      isActive={activeIssueId === line.issueId && line.issueId !== null}
                      allClear={allClear}
                      onClick={line.issueId ? () => handleLineClick(line.issueId!) : undefined}
                    />
                  ))}
                </div>
              </div>

              {/* Error panel — right */}
              <div className="w-full lg:w-80 lg:shrink-0">
                <ErrorPanel
                  issues={allIssues}
                  activeIssueId={activeIssueId}
                  onSelect={handleSelectIssue}
                  panelRef={errorPanelRef}
                  registryPending={registryPending}
                />
              </div>

            </div>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer
        className="shrink-0 border-t px-6 py-4 text-xs text-gray-600 flex items-center justify-between flex-wrap gap-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <span>ECF XML Validator — Gary De la Cruz</span>
        <span>Open source · In development</span>
      </footer>
    </div>
  )
}