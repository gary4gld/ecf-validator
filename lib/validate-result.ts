/**
 * Shapes the internal ValidationIssue list into the public API response.
 *
 * This is the frozen v1 contract: fields may be *added* in future, never
 * renamed or removed. Severities are exposed as stable semantic labels rather
 * than the UI's internal colour names (red/orange/...), so the API doesn't leak
 * presentation details and stays stable if the UI palette changes.
 */
import type { ParsedXml, Severity, ValidationIssue } from './types'

export const SCHEMA_VERSION = '1.0'

export type ApiSeverity = 'error' | 'discrepancy' | 'warning' | 'info' | 'advisory'

/** Internal colour severity → public semantic label. */
const SEVERITY_LABEL: Record<Severity, ApiSeverity> = {
  red: 'error', // DGII rejection
  orange: 'discrepancy', // amounts/totals that don't add up
  yellow: 'warning', // possible issue, worth reviewing
  blue: 'info', // informational (e.g. pre-signature document)
  advisory: 'advisory', // non-blocking consideration
}

export interface ApiFinding {
  severity: ApiSeverity
  field: string
  line: number | null
  message: string
}

export interface ValidationResult {
  schemaVersion: string
  /** True when there are no error- or discrepancy-level findings. A structural
   *  pre-check — NOT a guarantee that DGII will accept the document. */
  valid: boolean
  invoiceType: string | null
  hasSignature: boolean
  counts: Record<ApiSeverity, number>
  findings: ApiFinding[]
}

export function buildValidationResult(
  parsed: ParsedXml,
  issues: ValidationIssue[],
): ValidationResult {
  const findings: ApiFinding[] = issues.map((i) => ({
    severity: SEVERITY_LABEL[i.severity],
    field: i.field,
    line: i.line,
    message: i.message,
  }))

  const counts: Record<ApiSeverity, number> = {
    error: 0,
    discrepancy: 0,
    warning: 0,
    info: 0,
    advisory: 0,
  }
  for (const f of findings) counts[f.severity]++

  return {
    schemaVersion: SCHEMA_VERSION,
    valid: counts.error === 0 && counts.discrepancy === 0,
    invoiceType: parsed.invoiceType === 'unknown' ? null : parsed.invoiceType,
    hasSignature: parsed.hasSignature,
    counts,
    findings,
  }
}
