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
import { PATTERNS, MAX_LENGTHS, REQUIRED_MAX_LENGTH_FIELDS } from './schema-types'

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

/** Combined RNC validity check used by both format-checks and registry-checks. */
export function isValidRNC(rnc: string): boolean {
  if (rnc.length === 9)  return validateRNC9Checksum(rnc)
  if (rnc.length === 11) return validateLuhn(rnc)
  return false
}

// ── RNC format ────────────────────────────────────────────────────────────────

/**
 * Validates a 9-digit RNC (Persona Jurídica) using the DGII checksum algorithm.
 *
 * Algorithm (confirmed from DGII documentation):
 *   Weights: [7, 9, 8, 6, 5, 4, 3, 2] applied to digits 1–8
 *   Sum = Σ(digit × weight)
 *   R   = Sum mod 11
 *   Check digit = 11 - R
 *     → If check digit = 10: actual check digit is 1
 *     → If check digit = 11: actual check digit is 0
 *   The 9th digit must equal the computed check digit.
 */
function validateRNC9Checksum(rnc: string): boolean {
  const weights = [7, 9, 8, 6, 5, 4, 3, 2]
  const digits = rnc.split('').map(Number)
  const sum = digits.slice(0, 8).reduce((acc, d, i) => acc + d * weights[i], 0)
  const r = sum % 11
  let check = 11 - r
  if (check === 10) check = 1
  if (check === 11) check = 0
  return digits[8] === check
}

/**
 * Validates an 11-digit RNC (Persona Física / Cédula) using the Luhn algorithm (mod 10).
 *
 * Standard Luhn:
 *   Starting from the rightmost digit, double every second digit.
 *   If doubling produces > 9, subtract 9.
 *   Sum all digits — if divisible by 10, the number is valid.
 */
function validateLuhn(number: string): boolean {
  let sum = 0
  let isEven = false
  for (let i = number.length - 1; i >= 0; i--) {
    let digit = parseInt(number[i], 10)
    if (isEven) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    isEven = !isEven
  }
  return sum % 10 === 0
}

function checkRnc(
  field: string,
  value: string,
  line: number | null
): ValidationIssue | null {
  // Pre-check: XSD pattern is [0-9]{9}|[0-9]{11} — digits only, no hyphens or spaces.
  // People often write RNCs with hyphens (131-880-681) but the XML schema rejects them.
  if (/[^0-9]/.test(value)) {
    return {
      id: nextId(), severity: 'red', field, line,
      message: `${field} "${value}" contiene caracteres inválidos. El esquema XSD requiere exactamente 9 u 11 dígitos numéricos sin guiones ni espacios (ej. "131880681", no "131-880-681"). DGII rechazará el documento.`,
    }
  }

  // Structural check (9 or 11 digits)
  if (!PATTERNS.RNC.test(value)) {
    return {
      id: nextId(),
      severity: 'red',
      field,
      line,
      message: `${field} tiene formato inválido: "${value}". Debe ser 9 u 11 dígitos numéricos.`,
    }
  }

  // Checksum check
  const isValid = value.length === 9
    ? validateRNC9Checksum(value)
    : validateLuhn(value)

  if (!isValid) {
    const type = value.length === 9 ? 'RNC de Persona Jurídica (9 dígitos)' : 'Cédula de Persona Física (11 dígitos)'
    const algo = value.length === 9 ? 'pesos DGII [7,9,8,6,5,4,3,2] mod 11' : 'algoritmo Luhn mod 10'
    return {
      id: nextId(),
      severity: 'red',
      field,
      line,
      message: `${field} "${value}" tiene dígito verificador inválido (${type}). El número no supera la validación de ${algo}. Verifica que no haya dígitos transpuestos o errores de tipeo.`,
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
      // Required fields (minOccurs=1 in all types): max-length violation causes
      // outright DGII rejection. Optional fields: "Aceptado Condicional" only.
      const isRequired = REQUIRED_MAX_LENGTH_FIELDS.has(field)
      const severity = isRequired ? 'red' : 'yellow'
      const consequence = isRequired
        ? 'DGII rechazará el documento con error de estructura XML.'
        : 'Esto puede causar un rechazo "Aceptado Condicional" por DGII.'

      issues.push({
        id: nextId(),
        severity,
        field,
        line: findLine(new RegExp(`<${field}>`), lines),
        message: `${field} excede el máximo de ${max} caracteres (actual: ${v.length}). ${consequence}`,
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

// ── ITBIS rate value checks ───────────────────────────────────────────────────

/**
 * ITBIS1, ITBIS2, ITBIS3 are fixed by Dominican tax law — they are not
 * configurable by the emitter. The XSD only constrains them to 1-2 digit
 * integers; the fixed-value rule is enforced at the DGII application layer.
 *
 *   ITBIS1 = 18  (tasa general 18%)
 *   ITBIS2 = 16  (tasa reducida 16%)
 *   ITBIS3 = 0   (tasa cero 0%)
 *
 * A wrong value produces incorrect TotalITBIS math AND signals a misunderstanding
 * of the tax structure. We flag the root cause directly rather than just the
 * downstream math discrepancy.
 */
export function validateITBISRateValues(xml: string, lines: XmlLine[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const checks: Array<{ field: string; expected: number; label: string }> = [
    { field: 'ITBIS1', expected: 18, label: 'tasa general (18%)' },
    { field: 'ITBIS2', expected: 16, label: 'tasa reducida (16%)' },
    { field: 'ITBIS3', expected: 0,  label: 'tasa cero (0%)' },
  ]

  for (const { field, expected, label } of checks) {
    const v = getValue(field, xml)
    if (!v) continue
    const n = parseInt(v, 10)
    if (isNaN(n) || n !== expected) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field,
        line: findLine(new RegExp(`<${field}>`), lines),
        message: `${field} tiene valor inválido: "${v}". Este campo representa la ${label} del ITBIS, la cual está fijada por ley y debe ser siempre ${expected}. No es un valor configurable por el emisor.`,
      })
    }
  }

  return issues
}

// ── Coded field enum validations ──────────────────────────────────────────────

/**
 * TipoeCF must be one of the 10 valid invoice type codes.
 * An invalid code means the document cannot be routed or processed by DGII.
 * Note: type detection already marks this as "unknown" in the UI badge,
 * but we also need an explicit validation error card.
 */
export function validateTipoeCF(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('TipoeCF', xml)
  if (!v) return null
  const valid = new Set(['31','32','33','34','41','43','44','45','46','47'])
  if (!valid.has(v.trim())) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'TipoeCF',
      line: findLine(/<TipoeCF>/, lines),
      message: `TipoeCF tiene un valor inválido: "${v}". Los únicos valores permitidos son: 31, 32, 33, 34, 41, 43, 44, 45, 46, 47.`,
    }
  }
  return null
}

/**
 * TipoPago must be 1 (Contado), 2 (Crédito), or 3 (Gratuito).
 * Note: facturas gratuitas (código 3) no son válidas para crédito fiscal.
 */
export function validateTipoPagoValue(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('TipoPago', xml)
  if (!v) return null
  if (!['1','2','3'].includes(v.trim())) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'TipoPago',
      line: findLine(/<TipoPago>/, lines),
      message: `TipoPago tiene valor inválido: "${v}". Valores válidos: 1 (Contado), 2 (Crédito), 3 (Gratuito).`,
    }
  }
  return null
}

/**
 * IndicadorMontoGravado must be 0 or 1.
 *   0: item prices do NOT include ITBIS
 *   1: item prices already include ITBIS
 */
export function validateIndicadorMontoGravado(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('IndicadorMontoGravado', xml)
  if (!v) return null
  if (!['0','1'].includes(v.trim())) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'IndicadorMontoGravado',
      line: findLine(/<IndicadorMontoGravado>/, lines),
      message: `IndicadorMontoGravado tiene valor inválido: "${v}". Valores válidos: 0 (precios sin ITBIS incluido), 1 (precios con ITBIS incluido).`,
    }
  }
  return null
}

/**
 * IndicadorEnvioDiferido only accepts value 1 — there is no other valid value.
 * If present, the emitter must be authorized for deferred submissions.
 */
export function validateIndicadorEnvioDiferido(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('IndicadorEnvioDiferido', xml)
  if (!v) return null
  if (v.trim() !== '1') {
    return {
      id: nextId(),
      severity: 'red',
      field: 'IndicadorEnvioDiferido',
      line: findLine(/<IndicadorEnvioDiferido>/, lines),
      message: `IndicadorEnvioDiferido tiene valor inválido: "${v}". El único valor permitido es 1 (envío diferido autorizado). Solo aplica a emisores expresamente autorizados por DGII.`,
    }
  }
  return null
}

/**
 * TipoCuentaPago must be CT (Corriente), AH (Ahorro), or OT (Otra).
 */
export function validateTipoCuentaPago(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('TipoCuentaPago', xml)
  if (!v) return null
  if (!['CT','AH','OT'].includes(v.trim().toUpperCase())) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'TipoCuentaPago',
      line: findLine(/<TipoCuentaPago>/, lines),
      message: `TipoCuentaPago tiene valor inválido: "${v}". Valores válidos: CT (Cuenta Corriente), AH (Ahorro), OT (Otra).`,
    }
  }
  return null
}

/**
 * TipoAjuste must be D (Descuento) or R (Recargo).
 */
export function validateTipoAjuste(xml: string, lines: XmlLine[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const re = /<TipoAjuste>([^<]+)<\/TipoAjuste>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const v = m[1].trim()
    if (!['D','R'].includes(v.toUpperCase())) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field: 'TipoAjuste',
        line: findLine(new RegExp(`<TipoAjuste>${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), lines),
        message: `TipoAjuste tiene valor inválido: "${v}". Valores válidos: D (Descuento), R (Recargo).`,
      })
    }
  }
  return issues
}

/**
 * CodigoModificacion must be 1–5 (only present in E-33 and E-34).
 *   1: Anula el NCF modificado
 *   2: Corrige texto
 *   3: Corrige montos
 *   4: Reemplaza NCF emitido en contingencia
 *   5: Referencia factura consumo electrónica
 */
export function validateCodigoModificacion(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('CodigoModificacion', xml)
  if (!v) return null
  if (!['1','2','3','4','5'].includes(v.trim())) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'CodigoModificacion',
      line: findLine(/<CodigoModificacion>/, lines),
      message: `CodigoModificacion tiene valor inválido: "${v}". Valores válidos: 1 (Anula), 2 (Corrige texto), 3 (Corrige montos), 4 (Reemplaza contingencia), 5 (Referencia factura consumo).`,
    }
  }
  return null
}

/**
 * IndicadorNotaCredito is exclusive to E-34 and must be 0 or 1.
 *   0: la fecha del e-CF afectado es ≤ 30 días calendario (nota reciente — con derecho a rebajar ITBIS)
 *   1: la fecha del e-CF afectado es > 30 días calendario (nota tardía — sin derecho a rebajar ITBIS)
 */
export function validateIndicadorNotaCredito(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('IndicadorNotaCredito', xml)
  if (!v) return null
  if (!['0','1'].includes(v.trim())) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'IndicadorNotaCredito',
      line: findLine(/<IndicadorNotaCredito>/, lines),
      message: `IndicadorNotaCredito tiene valor inválido: "${v}". Valores válidos: 0 (fecha de emisión del e-CF afectado ≤ 30 días — puede rebajar ITBIS), 1 (> 30 días — no tiene derecho a rebajar ITBIS).`,
    }
  }
  return null
}

/**
 * Note: FormaPago=5 type restriction (E-32 only) is handled in conditional-checks.ts.
 */
export function validateFormaPagoValues(xml: string, lines: XmlLine[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!/<TablaFormasPago>/.test(xml)) return issues

  const re = /<FormaPago>([^<]+)<\/FormaPago>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const v = m[1].trim()
    if (!['1','2','3','4','5','6','7','8'].includes(v)) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field: 'FormaPago',
        line: findLine(new RegExp(`<FormaPago>${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), lines),
        message: `FormaPago tiene valor inválido: "${v}". Valores válidos: 1 (Efectivo), 2 (Cheque/Transferencia/Depósito), 3 (Tarjeta Débito/Crédito), 4 (Venta a Crédito), 5 (Bonos/Certificados), 6 (Permuta), 7 (Nota de crédito), 8 (Otras).`,
      })
    }
  }
  return issues
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

// ── Numeric positivity checks ─────────────────────────────────────────────────

/**
 * CantidadItem must be > 0 (MayorCero in XSD).
 * MontoItem must be >= 0 (MayorIgualCero).
 * PrecioUnitarioItem must be >= 0 (MayorIgualCero).
 * Checks ALL occurrences since these repeat per item.
 */
export function validateNumericPositivity(xml: string, lines: XmlLine[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const checks: Array<{ field: string; allowZero: boolean }> = [
    { field: 'CantidadItem',       allowZero: false },
    { field: 'MontoItem',          allowZero: true  },
    { field: 'PrecioUnitarioItem', allowZero: true  },
  ]

  for (const { field, allowZero } of checks) {
    const re = new RegExp(`<${field}>([^<]+)</${field}>`, 'g')
    let m
    while ((m = re.exec(xml)) !== null) {
      const n = parseFloat(m[1].trim())
      if (isNaN(n)) continue
      const invalid = allowZero ? n < 0 : n <= 0
      if (invalid) {
        const rule = allowZero ? '>= 0' : '> 0'
        const escaped = m[1].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        issues.push({
          id: nextId(),
          severity: 'red',
          field,
          line: findLine(new RegExp(`<${field}>${escaped}`), lines),
          message: `${field} tiene valor inválido: "${m[1].trim()}". Debe ser ${rule} — ${allowZero ? 'no puede ser negativo' : 'debe ser mayor que cero'}.`,
        })
      }
    }
  }

  return issues
}

// ── UnidadMedida valid codes ──────────────────────────────────────────────────

/**
 * UnidadMedida must be a valid code from DGII's measurement unit table (1–62).
 * Checks all occurrences: items, Transporte section (UnidadBulto, UnidadVolumen).
 * Codes confirmed from UnidadMedidaType enumeration in all XSD schemas.
 */
export function validateUnidadMedida(xml: string, lines: XmlLine[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const validSet = new Set([
     1, 2, 3, 4, 5, 6, 7, 8, 9,10,
    11,12,13,14,15,16,17,18,19,20,
    21,22,23,24,25,26,27,28,29,30,
    31,32,33,34,35,36,37,38,39,40,
    41,42,43,44,45,46,47,48,49,50,
    51,52,53,54,55,56,57,58,59,60,
    61,62,
  ])

  // Fields that use UnidadMedidaType (codes 1-62):
  // UnidadReferencia is validated per-item in checkISCProductFields (item-checks.ts)
  // to avoid duplicate errors on ISC-product items.
  const fields = ['UnidadMedida', 'CodigoSubcantidad']

  for (const field of fields) {
    const re = new RegExp(`<${field}>([^<]+)</${field}>`, 'g')
    let m
    while ((m = re.exec(xml)) !== null) {
      const v = m[1].trim()
      const n = parseInt(v, 10)
      if (!isNaN(n) && !validSet.has(n)) {
        const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        issues.push({
          id: nextId(),
          severity: 'red',
          field,
          line: findLine(new RegExp(`<${field}>${escaped}`), lines),
          message: `${field} tiene código inválido: "${v}". Debe ser un valor entre 1 y 62 de la Tabla IV de DGII. Ejemplos: 6 (Caja), 14 (Fardo), 15 (Galones), 21 (Kg), 31 (Paquete), 43 (Unidad), 46 (Saco).`,
        })
      }
    }
  }

  return issues
}