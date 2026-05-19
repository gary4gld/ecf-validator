/**
 * Format validation for individual fields.
 *
 * Each function:
 *  1. Looks for the field in the XML string
 *  2. If found, validates its format against the XSD pattern
 *  3. Returns a ValidationIssue if the format is wrong, null if valid or absent
 *
 * "Absent" is intentionally not flagged here — missing required fields are
 * handled separately by required-fields.ts to avoid duplicate messages.
 */

import type { ValidationIssue, XmlLine } from '../types'
import { PATTERNS, MAX_LENGTHS } from './schema-types'

// ── Helpers ───────────────────────────────────────────────────────────────────

let _issueCounter = 0
function nextId(): string {
  return `fmt-${++_issueCounter}`
}

/** Returns the first line number whose content matches the pattern, or null. */
function findLine(pattern: RegExp, lines: XmlLine[]): number | null {
  for (const l of lines) {
    if (pattern.test(l.content)) return l.number
  }
  return null
}

/** Extracts the text content of a field from raw XML. */
function getValue(field: string, xml: string): string | null {
  const m = xml.match(new RegExp(`<${field}[^>]*>([^<]+)</${field}>`))
  return m ? m[1].trim() : null
}

/** Extracts all values of a repeated field (e.g. TelefonoEmisor). */
function getValues(field: string, xml: string): string[] {
  const re = new RegExp(`<${field}[^>]*>([^<]+)</${field}>`, 'g')
  const results: string[] = []
  let m
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim())
  return results
}

// ── RNC format ────────────────────────────────────────────────────────────────

function checkRnc(
  field: string,
  value: string,
  line: number | null
): ValidationIssue | null {
  if (!PATTERNS.RNC.test(value)) {
    return {
      id: nextId(),
      severity: 'red',
      field,
      line,
      message: `${field} tiene formato inválido: "${value}". Debe ser 9 u 11 dígitos numéricos.`,
    }
  }
  return null
}

export function validateRNCEmisor(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('RNCEmisor', xml)
  if (!v) return null
  return checkRnc('RNCEmisor', v, findLine(/<RNCEmisor>/, lines))
}

export function validateRNCComprador(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('RNCComprador', xml)
  if (!v) return null
  return checkRnc('RNCComprador', v, findLine(/<RNCComprador>/, lines))
}

export function validateRNCOtroContribuyente(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('RNCOtroContribuyente', xml)
  if (!v) return null
  return checkRnc('RNCOtroContribuyente', v, findLine(/<RNCOtroContribuyente>/, lines))
}

// ── eNCF format ───────────────────────────────────────────────────────────────

export function validateEncf(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('eNCF', xml)
  if (!v) return null
  if (!PATTERNS.eNCF.test(v)) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'eNCF',
      line: findLine(/<eNCF>/, lines),
      message: `eNCF tiene formato inválido: "${v}". Debe ser exactamente 13 caracteres alfanuméricos (ej. E310000000001).`,
    }
  }
  return null
}

// ── Date format ───────────────────────────────────────────────────────────────

function checkFecha(
  field: string,
  value: string,
  line: number | null
): ValidationIssue | null {
  if (!PATTERNS.Fecha.test(value)) {
    return {
      id: nextId(),
      severity: 'red',
      field,
      line,
      message: `${field} tiene formato inválido: "${value}". El formato requerido por DGII es DD-MM-YYYY (ej. 15-03-2025), no ISO 8601.`,
    }
  }
  return null
}

export function validateFechaEmision(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('FechaEmision', xml)
  if (!v) return null
  return checkFecha('FechaEmision', v, findLine(/<FechaEmision>/, lines))
}

export function validateFechaVencimientoSecuencia(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('FechaVencimientoSecuencia', xml)
  if (!v) return null
  return checkFecha('FechaVencimientoSecuencia', v, findLine(/<FechaVencimientoSecuencia>/, lines))
}

export function validateFechaHoraFirma(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('FechaHoraFirma', xml)
  if (!v) return null
  if (!PATTERNS.DateTime.test(v)) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'FechaHoraFirma',
      line: findLine(/<FechaHoraFirma>/, lines),
      message: `FechaHoraFirma tiene formato inválido: "${v}". El formato requerido es DD-MM-YYYY HH:MM:SS (ej. 15-03-2025 14:30:00).`,
    }
  }
  return null
}

// ── Phone format ──────────────────────────────────────────────────────────────

export function validateTelefonosEmisor(xml: string, lines: XmlLine[]): ValidationIssue[] {
  const values = getValues('TelefonoEmisor', xml)
  const issues: ValidationIssue[] = []
  for (const v of values) {
    if (!PATTERNS.Telefono.test(v)) {
      issues.push({
        id: nextId(),
        severity: 'yellow',
        field: 'TelefonoEmisor',
        line: findLine(new RegExp(`>${v}<`), lines),
        message: `TelefonoEmisor tiene formato inválido: "${v}". El formato requerido es NNN-NNN-NNNN con guiones (ej. 809-555-1234).`,
      })
    }
  }
  return issues
}

// ── Email format ──────────────────────────────────────────────────────────────

function checkEmail(
  field: string,
  value: string,
  line: number | null
): ValidationIssue | null {
  if (!PATTERNS.Email.test(value)) {
    return {
      id: nextId(),
      severity: 'yellow',
      field,
      line,
      message: `${field} tiene formato inválido: "${value}". Debe ser una dirección de correo electrónico válida con máximo 80 caracteres.`,
    }
  }
  if (value.length > 80) {
    return {
      id: nextId(),
      severity: 'yellow',
      field,
      line,
      message: `${field} excede el máximo de 80 caracteres (actual: ${value.length}).`,
    }
  }
  return null
}

export function validateCorreoEmisor(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('CorreoEmisor', xml)
  if (!v) return null
  return checkEmail('CorreoEmisor', v, findLine(/<CorreoEmisor>/, lines))
}

export function validateCorreoComprador(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('CorreoComprador', xml)
  if (!v) return null
  return checkEmail('CorreoComprador', v, findLine(/<CorreoComprador>/, lines))
}

// ── Max length checks ─────────────────────────────────────────────────────────

export function validateMaxLengths(xml: string, lines: XmlLine[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const [field, max] of Object.entries(MAX_LENGTHS)) {
    const v = getValue(field, xml)
    if (v && v.length > max) {
      issues.push({
        id: nextId(),
        severity: 'yellow',
        field,
        line: findLine(new RegExp(`<${field}>`), lines),
        message: `${field} excede el máximo de ${max} caracteres (actual: ${v.length}). Esto puede causar un rechazo "Aceptado Condicional" por DGII.`,
      })
    }
  }

  return issues
}

// ── RFCE: CodigoSeguridadeCF ──────────────────────────────────────────────────

export function validateCodigoSeguridadeCF(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('CodigoSeguridadeCF', xml)
  if (!v) return null
  if (!PATTERNS.CodigoSeguridad.test(v)) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'CodigoSeguridadeCF',
      line: findLine(/<CodigoSeguridadeCF>/, lines),
      message: `CodigoSeguridadeCF tiene longitud inválida: "${v}" (${v.length} chars). Debe tener exactamente 6 caracteres — los primeros 6 de la firma digital de la factura de consumo original.`,
    }
  }
  return null
}

/** Reset the issue ID counter (call at start of each validation run). */
export function resetFormatCounter(): void {
  _issueCounter = 0
}

// ── TipoIngresos leading-zero check ──────────────────────────────────────────

/**
 * TipoIngresos must be reported with a leading zero: "01" through "06".
 * Sending "1" through "6" (without the zero) fails XSD validation at DGII.
 * This is explicitly confirmed in the DGII FAQ: "Debe reportarse con el
 * cero (0) incluido, por ejemplo: '01'."
 */
export function validateTipoIngresos(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('TipoIngresos', xml)
  if (!v) return null

  // Valid: "01" through "06" — two chars with leading zero
  if (/^0[1-6]$/.test(v)) return null

  // Common mistake: "1" through "6" without leading zero
  if (/^[1-6]$/.test(v)) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'TipoIngresos',
      line: findLine(/<TipoIngresos>/, lines),
      message: `TipoIngresos tiene formato inválido: "${v}". Según la DGII, debe reportarse con el cero incluido (ej. "01", no "1"). Esto genera un error de validación en DGII.`,
    }
  }

  // Value out of range entirely
  return {
    id: nextId(),
    severity: 'red',
    field: 'TipoIngresos',
    line: findLine(/<TipoIngresos>/, lines),
    message: `TipoIngresos tiene valor inválido: "${v}". Los valores válidos son: 01 (operaciones), 02 (financieros), 03 (extraordinarios), 04 (arrendamientos), 05 (venta de activos), 06 (otros).`,
  }
}

// ── Decimal separator / thousands separator check ────────────────────────────

/**
 * DGII requires:
 *  - Decimals separated with period (.), NOT comma (,)
 *  - Thousands NOT separated (no 1,000 — just 1000)
 *
 * A common mistake is submitting amounts formatted for display (e.g. "1,500.00"
 * or European style "1.500,00"), which will fail XSD decimal pattern matching.
 *
 * We check all the monetary total fields in the Totales section.
 */
export function validateDecimalSeparators(xml: string, lines: XmlLine[]): ValidationIssue[] {
  const MONETARY_FIELDS = [
    'MontoTotal',
    'MontoGravadoTotal',
    'MontoGravadoI1',
    'MontoGravadoI2',
    'MontoGravadoI3',
    'MontoExento',
    'TotalITBIS',
    'TotalITBIS1',
    'TotalITBIS2',
    'TotalITBIS3',
    'ValorPagar',
    'MontoAvancePago',
    'MontoNoFacturable',
    'MontoPeriodo',
    'SaldoAnterior',
    'TotalITBISRetenido',
    'TotalISRRetencion',
  ]

  const issues: ValidationIssue[] = []

  for (const field of MONETARY_FIELDS) {
    const v = getValue(field, xml)
    if (!v) continue

    // Detect thousands separator with commas: "1,500" or "1,500.00"
    if (/\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field,
        line: findLine(new RegExp(`<${field}>`), lines),
        message: `${field} usa coma como separador de miles: "${v}". La DGII requiere que los montos NO lleven separador de miles (ej. 1500.00 en lugar de 1,500.00).`,
      })
      continue
    }

    // Detect European-style comma as decimal: "1500,00"
    if (/^\d+,\d{1,2}$/.test(v)) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field,
        line: findLine(new RegExp(`<${field}>`), lines),
        message: `${field} usa coma como separador decimal: "${v}". La DGII requiere punto como separador decimal (ej. 1500.00 en lugar de 1500,00).`,
      })
    }
  }

  return issues
}