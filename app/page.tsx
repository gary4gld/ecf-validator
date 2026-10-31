'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { beautifyXml }        from '@/lib/xml-beautifier'
import { detectInvoiceType, hasSignature } from '@/lib/xml-parser'
import { colorizeXmlLine }    from '@/lib/xml-colorizer'
import { validate }           from '@/lib/validators/validator'
import { checkRNCRegistry }   from '@/lib/validators/registry-checks'
import { INVOICE_TYPE_LABELS } from '@/lib/types'
import { SAMPLE_INVOICES } from '@/lib/sample-invoices'
import type { ParsedXml, ValidationIssue, XmlLine, Severity } from '@/lib/types'

// ── Severity colour map ────────────────────────────────────────────────────────

const SEV = {
  red:    { bg: 'rgba(239,68,68,0.09)',  color: '#ef4444', text: '#f87171', labelS: 'error',        labelP: 'errores'        },
  orange: { bg: 'rgba(249,115,22,0.09)', color: '#f97316', text: '#fb923c', labelS: 'discrepancia', labelP: 'discrepancias'  },
  yellow: { bg: 'rgba(234,179,8,0.09)',  color: '#eab308', text: '#fde047', labelS: 'advertencia',  labelP: 'advertencias'   },
  blue:   { bg: 'rgba(96,165,250,0.09)', color: '#60a5fa', text: '#93c5fd', labelS: 'nota',         labelP: 'notas'          },
  advisory:{ bg: 'rgba(148,163,184,0.06)', color: '#94a3b8', text: '#cbd5e1', labelS: 'consideración', labelP: 'consideraciones' },
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
          color: line.severity ? SEV[line.severity].color : '#7d8590',
          fontSize: '11px',
          opacity: line.severity ? 0.85 : 1,
          userSelect: 'none',
          paddingTop: '1px',
        }}
      >
        {line.number}
      </span>
      <span
        className="flex-1 whitespace-pre pr-6"
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
          style={{ color: c.text, fontFamily: 'var(--font-mono), monospace' }}
        >
          &lt;{issue.field}&gt;
        </code>
      </div>

      {/* Message */}
      <p className="text-xs text-gray-400 leading-relaxed mb-1.5">
        {issue.message}
      </p>

      {/* Line reference */}
      <p className="text-[11px] text-gray-400">
        {issue.line != null ? `línea ${issue.line}` : 'documento'}
      </p>
    </div>
  )
}

/** Severity order used everywhere (display + export): most → least severe, advisory last. */
const SEVERITY_RANK: Record<Severity, number> = { red: 0, orange: 1, yellow: 2, blue: 3, advisory: 4 }

/** Sort issues by severity (stable), so exports match the on-screen grouping. */
function sortBySeverity(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

/** Legend copy — one short meaning per severity, shown in the "?" reveal. */
const LEGEND: Array<{ sev: Severity; meaning: string }> = [
  { sev: 'red',      meaning: 'Rechazo por la DGII' },
  { sev: 'orange',   meaning: 'Montos o totales que no cuadran' },
  { sev: 'yellow',   meaning: 'Posible problema; conviene revisar' },
  { sev: 'blue',     meaning: 'Informativo (p. ej. documento pre-firma)' },
  { sev: 'advisory', meaning: 'Aviso que no afecta la validez' },
]

/** Serialize the full issue list to a human-readable text summary. */
function issuesToText(issues: ValidationIssue[]): string {
  if (issues.length === 0) return 'Sin problemas — el XML pasó todas las validaciones.'
  return sortBySeverity(issues)
    .map((i) => {
      const loc = i.line != null ? `línea ${i.line}` : 'documento'
      return `[${i.severity.toUpperCase()}] <${i.field}> (${loc})\n${i.message}`
    })
    .join('\n\n')
}

/** Serialize the full issue list to JSON. */
function issuesToJson(issues: ValidationIssue[]): string {
  return JSON.stringify(
    sortBySeverity(issues).map(({ severity, field, line, message }) => ({ severity, field, line, message })),
    null,
    2,
  )
}

/**
 * Reusable info panel — Acerca / Privacidad / Términos. Opened from the header.
 * Designed to hold more surfaces later (Q&A, usage notes, API terms).
 */
function AboutPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Acerca, privacidad y términos"
    >
      <div
        className="w-full max-w-lg rounded-2xl my-6"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <p className="text-sm font-medium text-gray-200">Acerca · Privacidad · Términos</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-5 text-sm text-gray-400 leading-relaxed">
          <section>
            <h2 className="text-gray-200 font-medium mb-1.5">Acerca</h2>
            <p>
              ECF XML Validator es una herramienta gratuita que valida XML de comprobantes
              fiscales electrónicos (e-CF) de la DGII (República Dominicana) contra los esquemas
              XSD oficiales y las reglas del Formato, antes de enviarlos. La validación ocurre
              completamente en tu navegador.
            </p>
          </section>
          <section>
            <h2 className="text-gray-200 font-medium mb-1.5">Privacidad</h2>
            <p>
              La factura se valida localmente en tu navegador y no se almacena. Lo único que sale
              de tu navegador son los números de RNC (emisor y comprador): se envían al servidor de
              esta herramienta, que los consulta en un servicio de registro de contribuyentes de la
              DGII para verificar su estado. El resto del XML nunca se transmite ni se guarda.
            </p>
          </section>
          <section>
            <h2 className="text-gray-200 font-medium mb-1.5">Términos de uso</h2>
            <p>
              Esta herramienta se ofrece «tal cual», sin garantías de ningún tipo. Es una ayuda de
              desarrollo y verificación previa: no sustituye la validación oficial de la DGII ni
              garantiza que un e-CF sea aceptado. Verifica siempre con los canales oficiales antes
              de enviar. El servicio puede cambiar, limitarse o descontinuarse en cualquier momento.
              Úsala bajo tu propia responsabilidad.
            </p>
          </section>
        </div>
      </div>
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
  hiddenSeverities,
}: {
  issues: ValidationIssue[]
  activeIssueId: string | null
  onSelect: (id: string) => void
  panelRef: React.RefObject<HTMLDivElement | null>
  registryPending: boolean
  hiddenSeverities: Set<Severity>
}) {
  const structural = issues.filter((i) => i.severity !== 'advisory')
  const advisories = issues.filter((i) => i.severity === 'advisory')
  const visibleStructural = structural.filter((i) => !hiddenSeverities.has(i.severity))
  const [advOpen, setAdvOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    try {
      navigator.clipboard?.writeText(issuesToText(issues))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable — ignore */ }
  }

  const handleExport = () => {
    try {
      const blob = new Blob([issuesToJson(issues)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'validacion-ecf.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* download unavailable — ignore */ }
  }

  if (structural.length === 0 && advisories.length === 0 && !registryPending) {
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
        <p className="text-xs text-gray-400">No se encontraron errores en el XML.</p>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className="rounded-2xl overflow-y-auto lg:max-h-[640px]"
      style={{
        border: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      }}
    >
      {/* Panel header */}
      <div
        className="sticky top-0 px-4 py-3 flex items-center justify-between gap-2"
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          zIndex: 1,
        }}
      >
        <p className="text-sm font-medium text-gray-300">
          {structural.length} problema{structural.length !== 1 ? 's' : ''} encontrado{structural.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="text-[11px] px-2 py-0.5 rounded-md text-gray-400 hover:text-white transition-colors"
            style={{ border: '1px solid var(--border)' }}
          >
            {copied ? 'Copiado ✓' : 'Copiar'}
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="text-[11px] px-2 py-0.5 rounded-md text-gray-400 hover:text-white transition-colors"
            style={{ border: '1px solid var(--border)' }}
          >
            JSON
          </button>
        </div>
      </div>

      {/* Cards — sorted red → orange → yellow → blue (advisories render separately below) */}
      <div className="p-3">
        {SEV_ORDER.flatMap((sev) =>
          visibleStructural
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

        {/* Advisory lane — informational only, collapsible, deliberately separate from validity issues */}
        {advisories.length > 0 && (
          <div className="mt-3 pt-3" style={{ borderTop: '1px dashed var(--border)' }}>
            <button
              type="button"
              onClick={() => setAdvOpen((v) => !v)}
              aria-expanded={advOpen}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:brightness-125"
              style={{ background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.18)' }}
            >
              <span
                aria-hidden="true"
                className="text-gray-400 text-xs"
                style={{ display: 'inline-block', transform: advOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
              >
                ›
              </span>
              <span className="text-[11px] uppercase tracking-wide font-medium text-gray-300">
                Consideraciones
              </span>
              <span className="ml-auto text-[11px] text-gray-400">
                {advisories.length} · no afecta la validez
              </span>
            </button>
            {advOpen && (
              <div className="mt-2">
                {advisories.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg p-3 mb-2 last:mb-0"
                    style={{ background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.22)' }}
                  >
                    <p className="text-xs font-medium text-gray-200 mb-1">{a.field}</p>
                    <p className="text-xs text-gray-300 leading-relaxed">{a.message}</p>
                  </div>
                ))}
              </div>
            )}
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
  const [showFloatingReset, setShowFloatingReset] = useState(false)
  const [hiddenSeverities, setHiddenSeverities] = useState<Set<Severity>>(new Set())
  const [legendOpen, setLegendOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const toggleSeverity = (sev: Severity) =>
    setHiddenSeverities((prev) => {
      const next = new Set(prev)
      if (next.has(sev)) next.delete(sev)
      else next.add(sev)
      return next
    })

  const fileInputRef    = useRef<HTMLInputElement>(null)
  const xmlContainerRef = useRef<HTMLDivElement>(null)
  const errorPanelRef   = useRef<HTMLDivElement>(null)
  const topResetRef     = useRef<HTMLButtonElement>(null)

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

  // ── Persist the paste-box content across refreshes (per-browser convenience) ──
  const restoredRef = useRef(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ecf:lastInput')
      if (saved) setRawXml(saved)
    } catch { /* storage unavailable (private mode, blocked) — ignore */ }
    restoredRef.current = true
  }, [])
  useEffect(() => {
    if (!restoredRef.current) return
    try { localStorage.setItem('ecf:lastInput', rawXml) } catch { /* ignore */ }
  }, [rawXml])

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
    setRegistryIssues([])
    setRegistryPending(false)
    setHiddenSeverities(new Set())

    // ── Pre-check: detect malformed XML before any processing ─────────────────
    // DOMParser silently returns a <parsererror> document for invalid XML.
    // We catch this early so we can show the raw XML (not the parsed fragment)
    // and a clear error, without running any validators on broken content.
    const checkDoc = new DOMParser().parseFromString(xml, 'text/xml')
    const parseErrEl = checkDoc.querySelector('parsererror')
    if (parseErrEl) {
      // Extract the error message — browsers put it in a <div> inside parsererror
      const raw = parseErrEl.textContent?.trim() ?? ''
      // Try to extract line/column info from the browser's error text
      const lineMatch = raw.match(/line\s+(\d+)/i)
      const colMatch  = raw.match(/column\s+(\d+)/i)
      const location  = lineMatch
        ? ` (línea ${lineMatch[1]}${colMatch ? `, columna ${colMatch[1]}` : ''})`
        : ''
      // Try to extract the actual error description (after the line info)
      const descMatch = raw.match(/:\s*(.+)$/m)
      const description = descMatch ? descMatch[1].trim() : 'error de sintaxis XML'

      // Show the raw unprocessed XML so the user can see the full content
      const rawLines: XmlLine[] = xml.split('\n').map((content, i) => ({
        number: i + 1, content, severity: null, issueId: null,
      }))
      const parseIssue: ValidationIssue = {
        id: 'parse-1',
        severity: 'red',
        field: 'Estructura XML',
        line: lineMatch ? parseInt(lineMatch[1], 10) : null,
        message: `XML mal formado${location}: ${description}. El documento no puede ser procesado ni enviado a DGII. Corrija la estructura antes de continuar.`,
      }
      const issueLines = rawLines.map(l =>
        l.number === parseIssue.line ? { ...l, severity: 'red' as const, issueId: 'parse-1' } : l
      )
      setParsedXml({
        raw: xml,
        beautified: xml,
        lines: issueLines,
        invoiceType: 'unknown' as any,
        hasSignature: false,
        issues: [parseIssue],
      })
      setParseError(null)
      return
    }

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
        const hit = issues.find((issue) => issue.line === line.number && issue.severity !== 'advisory')
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

  /** Load a built-in example into the box and validate it immediately. */
  const loadSample = (xml: string) => {
    setRawXml(xml)
    processXml(xml)
  }
  // Reveal a floating "Validar otro" once the top button scrolls out of view
  // (long invoices push it far off-screen). Re-runs when results mount/unmount.
  useEffect(() => {
    const el = topResetRef.current
    if (!el) {
      setShowFloatingReset(false)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setShowFloatingReset(!entry.isIntersecting),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [parsedXml])

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

  const allClear = allIssues.filter((i) => i.severity !== 'advisory').length === 0 && !registryPending
  const structuralCount = allIssues.filter((i) => i.severity !== 'advisory').length

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
          <span className="text-[11px] text-gray-400 tracking-wide" style={{ fontFamily: 'var(--font-mono), monospace' }}>v1.0</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Acerca
          </button>
          <a
            href="https://github.com/gary4gld/ecf-validator"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Repositorio en GitHub"
          >
            <GitHubIcon />
          </a>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-6 py-8">
        {!parsedXml ? (

          /* ──────── Input state ──────── */
          <div className="max-w-3xl mx-auto">
            <h1 className="text-2xl font-semibold text-white mb-1">Valida tu XML e-CF</h1>
            <p className="text-gray-400 text-sm mb-2 leading-relaxed">
              Pega o carga un XML de factura electrónica para verificarlo contra los esquemas XSD
              oficiales de la DGII.
            </p>
            <p className="text-xs text-gray-400 mb-8">
              Tu XML se valida en tu navegador y no se almacena.{' '}
              <button
                type="button"
                onClick={() => setAboutOpen(true)}
                className="text-gray-400 hover:text-gray-300 underline underline-offset-2"
              >
                Más info
              </button>
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
                    mode === m ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-300'
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
                <span className="text-gray-400"><UploadIcon /></span>
                <div className="text-center">
                  <p className="text-sm text-gray-400">
                    Arrastra tu archivo .xml aquí o{' '}
                    <span className="text-blue-400">haz clic para explorar</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Solo archivos .xml</p>
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

            <div className="mt-5 flex items-center gap-3 flex-wrap">
              <button
                onClick={handleValidate}
                disabled={!rawXml.trim()}
                className="px-6 py-2.5 bg-white text-gray-950 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Validar
              </button>
              <span className="text-xs text-gray-400">o prueba un ejemplo:</span>
              <div className="flex items-center gap-2 flex-wrap">
                {SAMPLE_INVOICES.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => loadSample(s.xml)}
                    className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-white transition-colors"
                    style={{ border: '1px solid var(--border)', background: 'var(--bg-surface)' }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

        ) : (

          /* ──────── Results state ──────── */
          <div className="flex flex-col gap-4">

            <h1 className="sr-only">Resultados de validación</h1>

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
                <span className="text-sm text-gray-400">{parsedXml.lines.length} líneas</span>

                {/* Severity badges — only shown severities that have ≥ 1 issue */}
                {structuralCount > 0 && (
                  <>
                    <span className="text-gray-700">·</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {SEV_ORDER.map((sev) => {
                        const n = counts[sev] ?? 0
                        if (!n) return null
                        const c = SEV[sev]
                        const off = hiddenSeverities.has(sev)
                        return (
                          <button
                            key={sev}
                            type="button"
                            onClick={() => toggleSeverity(sev)}
                            aria-pressed={!off}
                            title={off ? `Mostrar ${c.labelP}` : `Ocultar ${c.labelP}`}
                            className="text-xs px-2.5 py-0.5 rounded-full flex items-center gap-1.5 cursor-pointer transition-opacity"
                            style={{
                              background: c.bg,
                              border: `1px solid ${c.color}40`,
                              color: c.text,
                              opacity: off ? 0.4 : 1,
                              textDecoration: off ? 'line-through' : 'none',
                            }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />
                            {n} {n === 1 ? c.labelS : c.labelP}
                          </button>
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

                {/* Legend toggle — reveals the severity legend in-flow (mobile-safe) */}
                <button
                  type="button"
                  onClick={() => setLegendOpen((v) => !v)}
                  aria-expanded={legendOpen}
                  aria-label="Leyenda de niveles"
                  title="Leyenda de niveles"
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] text-gray-400 hover:text-white transition-colors shrink-0"
                  style={{ border: '1px solid var(--border)' }}
                >
                  ?
                </button>
              </div>

              <button
                ref={topResetRef}
                onClick={handleReset}
                className="text-xs text-gray-400 hover:text-white transition-colors shrink-0"
              >
                ← Validar otro
              </button>
            </div>

            {/* Severity legend — revealed by the ? in the info bar; in-flow, so it never
                overflows the viewport on mobile the way a floating popover could. */}
            {legendOpen && (
              <div className="rounded-xl px-5 py-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {LEGEND.map(({ sev, meaning }) => {
                    const c = SEV[sev]
                    return (
                      <div key={sev} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                        <span className="text-xs">
                          <span className="font-medium capitalize" style={{ color: c.text }}>{c.labelS}</span>
                          <span className="text-gray-400"> — {meaning}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Split pane */}
            <div className="flex flex-col lg:flex-row gap-4 items-start">

              {/* XML viewer — left */}
              <div
                className="flex-1 min-w-0 w-full rounded-2xl overflow-hidden"
                style={{ border: '1px solid var(--border)' }}
              >
                <div
                  ref={xmlContainerRef}
                  className="overflow-auto"
                  tabIndex={0}
                  role="region"
                  aria-label="XML del documento"
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
                  {/* w-max + min-w-full: every row is as wide as the longest line, so
                      long lines scroll sideways instead of being clipped, and
                      highlighted rows stay full width. */}
                  <div className="w-max min-w-full">
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
              </div>

              {/* Error panel — right */}
              <div className="w-full lg:w-80 lg:shrink-0">
                <ErrorPanel
                  issues={allIssues}
                  activeIssueId={activeIssueId}
                  onSelect={handleSelectIssue}
                  panelRef={errorPanelRef}
                  registryPending={registryPending}
                  hiddenSeverities={hiddenSeverities}
                />
              </div>

            </div>

            {/* Floating reset — fades in once the top button scrolls off (long invoices) */}
            <button
              onClick={handleReset}
              aria-hidden={!showFloatingReset}
              tabIndex={showFloatingReset ? 0 : -1}
              className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-full text-xs font-medium text-gray-200 transition-opacity duration-200 hover:text-white ${showFloatingReset ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}
            >
              ↑ Validar otro
            </button>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer
        className="shrink-0 border-t px-6 py-4 text-xs text-gray-400 flex items-center justify-between flex-wrap gap-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <span>ECF XML Validator — Gary De la Cruz</span>
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="hover:text-gray-300 transition-colors"
        >
          Free to use · Términos
        </button>
      </footer>

      <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  )
}