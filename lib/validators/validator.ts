/**
 * Main validation entry point.
 *
 * Takes a ParsedXml object and returns all ValidationIssues found, sorted by
 * severity (red → orange → yellow → blue).
 *
 * This file orchestrates seven layers of checks:
 *  1. Required fields   — is each mandatory element present?
 *  2. Format checks     — do present fields conform to XSD patterns?
 *  3. Cross-field rules — do multiple fields agree with each other?
 *  4. Conditional checks — obligation code 2 rules (context-dependent requirements)
 *  5. Math checks       — are ITBIS calculations and totals internally consistent?
 *  6. Sequence checks   — are sections and fields in the correct XSD-defined order?
 *  7. Item checks       — are per-item fields valid and item totals consistent?
 */

import type { ParsedXml, ValidationIssue } from '../types'
import { getRequirements } from './required-fields'
import {
  resetFormatCounter,
  validateRNCEmisor,
  validateRNCComprador,
  validateRNCOtroContribuyente,
  validateEncf,
  validateFechaEmision,
  validateFechaVencimientoSecuencia,
  validateFechaHoraFirma,
  validateTelefonosEmisor,
  validateCorreoEmisor,
  validateCorreoComprador,
  validateMaxLengths,
  validateCodigoSeguridadeCF,
  validateTipoIngresos,
  validateDecimalSeparators,
  validateITBISRateValues,
  validateTipoeCF,
  validateTipoPagoValue,
  validateIndicadorMontoGravado,
  validateIndicadorEnvioDiferido,
  validateTipoCuentaPago,
  validateTipoAjuste,
  validateCodigoModificacion,
  validateFormaPagoValues,
  validateIndicadorNotaCredito,
  validateNumericPositivity,
  validateUnidadMedida,
  validateTipoMoneda,
  validateProvinciaMunicipio,
} from './format-checks'
import {
  resetCrossCounter,
  checkEncfTipoMismatch,
  checkSignaturePresence,
  checkE32RfceRequirement,
  checkRfceCodigoNote,
  checkVersion,
  checkFechaHoraFirma,
  checkForbiddenFields,
  checkIndicadorNotaCreditoDate,
  checkFechaHoraFirmaConsistency,
  checkNCFModificadoPrefix,
  checkFechaVencimientoSecuencia,
  checkFechaDesdeHasta,
  checkCodigoModificacionE33,
} from './cross-field-rules'
import {
  resetMathCounter,
  checkMontoGravadoTotal,
  checkTotalITBIS,
  checkITBISRates,
  checkMontoTotal,
  checkValorPagar,
  checkOtraMonedaTotals,
  checkTotalCif,
  checkHeaderImpuestosAdicionales,
} from './math-checks'
import {
  resetSeqCounter,
  runSequenceChecks,
} from './sequence-checks'
import {
  resetItemCounter,
  runItemChecks,
} from './item-checks'
import {
  resetCondCounter,
  checkFechaLimitePago,
  checkITBISTriplets,
  checkTotalITBISPresence,
  checkOtraMoneda,
  checkE32BuyerIdentification,
  checkFormaPagoBonos,
  checkITBISForbiddenTypes,
  checkE46ITBISRates,
  checkMontoPago,
  checkFormaPagoSum,
  checkPaginacion,
} from './conditional-checks'
import { checkForTypos, resetTypoCounter } from './typo-checks'

const SEV_ORDER = { red: 0, orange: 1, yellow: 2, blue: 3 } as const

// ── Helper ────────────────────────────────────────────────────────────────────

/** Find the first line whose content matches a pattern. */
function findLine(
  pattern: RegExp,
  lines: ParsedXml['lines']
): number | null {
  for (const l of lines) {
    if (pattern.test(l.content)) return l.number
  }
  return null
}

// ── Required field checks ─────────────────────────────────────────────────────

function runRequiredChecks(parsed: ParsedXml): ValidationIssue[] {
  const { raw: xml, lines, invoiceType } = parsed
  const requirements = getRequirements(invoiceType)
  const issues: ValidationIssue[] = []
  let reqCounter = 0

  for (const req of requirements) {
    if (!req.pattern.test(xml)) {
      issues.push({
        id: `req-${++reqCounter}`,
        severity: req.severity,
        field: req.field,
        line: null, // field is absent — no line to point to
        message: req.message,
      })
    }
  }

  return issues
}

// ── Format checks ─────────────────────────────────────────────────────────────

function runFormatChecks(parsed: ParsedXml): ValidationIssue[] {
  const { raw: xml, lines } = parsed
  const issues: ValidationIssue[] = []

  const push = (issue: ValidationIssue | null) => {
    if (issue) issues.push(issue)
  }
  const pushAll = (list: ValidationIssue[]) => issues.push(...list)

  // RNC fields
  push(validateRNCEmisor(xml, lines))
  push(validateRNCComprador(xml, lines))
  push(validateRNCOtroContribuyente(xml, lines))

  // eNCF format
  push(validateEncf(xml, lines))

  // Date fields
  push(validateFechaEmision(xml, lines))
  push(validateFechaVencimientoSecuencia(xml, lines))
  push(validateFechaHoraFirma(xml, lines))

  // Phone
  pushAll(validateTelefonosEmisor(xml, lines))

  // Email
  push(validateCorreoEmisor(xml, lines))
  push(validateCorreoComprador(xml, lines))

  // Max lengths
  pushAll(validateMaxLengths(xml, lines))

  // TipoIngresos leading-zero
  push(validateTipoIngresos(xml, lines))

  // Decimal/thousands separator in monetary fields
  pushAll(validateDecimalSeparators(xml, lines))

  // RFCE: CodigoSeguridadeCF format
  push(validateCodigoSeguridadeCF(xml, lines))

  // ITBIS rate values — fixed by law (18, 16, 0)
  pushAll(validateITBISRateValues(xml, lines))

  // Coded field enum validations
  push(validateTipoeCF(xml, lines))
  push(validateTipoPagoValue(xml, lines))
  push(validateIndicadorMontoGravado(xml, lines))
  push(validateIndicadorEnvioDiferido(xml, lines))
  push(validateTipoCuentaPago(xml, lines))
  pushAll(validateTipoAjuste(xml, lines))
  push(validateCodigoModificacion(xml, lines))
  pushAll(validateFormaPagoValues(xml, lines))
  push(validateIndicadorNotaCredito(xml, lines))
  pushAll(validateTipoMoneda(xml, lines))
  pushAll(validateProvinciaMunicipio(xml, lines))
  pushAll(validateNumericPositivity(xml, lines))
  pushAll(validateUnidadMedida(xml, lines))

  return issues
}

// ── Cross-field checks ────────────────────────────────────────────────────────

function runCrossFieldChecks(parsed: ParsedXml): ValidationIssue[] {
  const { raw: xml, lines, invoiceType } = parsed
  const issues: ValidationIssue[] = []

  const push = (issue: ValidationIssue | null) => {
    if (issue) issues.push(issue)
  }
  const pushAll = (list: ValidationIssue[]) => issues.push(...list)
  push(checkVersion(xml, lines))
  push(checkEncfTipoMismatch(xml, lines))
  push(checkFechaHoraFirma(xml, invoiceType, lines))
  push(checkSignaturePresence(xml, lines))
  push(checkE32RfceRequirement(xml, invoiceType, lines))
  push(checkRfceCodigoNote(xml, invoiceType, lines))
  pushAll(checkForbiddenFields(xml, invoiceType, lines))
  push(checkIndicadorNotaCreditoDate(xml, invoiceType, lines))
  push(checkFechaHoraFirmaConsistency(xml, lines))
  push(checkNCFModificadoPrefix(xml, invoiceType, lines))
  push(checkFechaVencimientoSecuencia(xml, lines))
  push(checkFechaDesdeHasta(xml, lines))
  push(checkCodigoModificacionE33(xml, invoiceType, lines))

  return issues
}

// ── Conditional field checks ──────────────────────────────────────────────────

function runConditionalChecks(parsed: ParsedXml): ValidationIssue[] {
  const { raw: xml, lines, invoiceType } = parsed
  const issues: ValidationIssue[] = []

  const push = (issue: ValidationIssue | null) => { if (issue) issues.push(issue) }
  const pushAll = (list: ValidationIssue[]) => issues.push(...list)

  push(checkFechaLimitePago(xml, invoiceType, lines))
  pushAll(checkITBISTriplets(xml, lines))
  push(checkTotalITBISPresence(xml, lines))
  pushAll(checkOtraMoneda(xml, lines))
  pushAll(checkE32BuyerIdentification(xml, invoiceType, lines))
  push(checkFormaPagoBonos(xml, invoiceType, lines))
  pushAll(checkITBISForbiddenTypes(xml, invoiceType, lines))
  pushAll(checkE46ITBISRates(xml, invoiceType, lines))
  push(checkMontoPago(xml, lines))
  push(checkFormaPagoSum(xml, lines))
  pushAll(checkPaginacion(xml, lines))

  return issues
}

// ── Math checks ───────────────────────────────────────────────────────────────

function runMathChecks(parsed: ParsedXml): ValidationIssue[] {
  const { raw: xml, lines } = parsed
  const issues: ValidationIssue[] = []

  const push = (issue: ValidationIssue | null) => { if (issue) issues.push(issue) }
  const pushAll = (list: ValidationIssue[]) => issues.push(...list)

  push(checkMontoGravadoTotal(xml, lines))
  push(checkTotalITBIS(xml, lines))
  pushAll(checkITBISRates(xml, lines))
  push(checkMontoTotal(xml, lines))
  push(checkValorPagar(xml, lines))
  pushAll(checkOtraMonedaTotals(xml, lines))
  // Only check TotalCif math for E-46 — for other types the cross-field check
  // already fires a red "forbidden field" error; a second orange math error
  // for the same field would be redundant noise.
  if (parsed.invoiceType === 'E-46') {
    pushAll(checkTotalCif(xml, lines))
  }
  pushAll(checkHeaderImpuestosAdicionales(xml, lines))

  return issues
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Validate an e-CF or RFCE document.
 * Returns all issues sorted red → orange → yellow → blue.
 */
export function validate(parsed: ParsedXml): ValidationIssue[] {
  // Reset ID counters so IDs are stable across runs
  resetFormatCounter()
  resetCrossCounter()
  resetMathCounter()
  resetCondCounter()
  resetSeqCounter()
  resetItemCounter()
  resetTypoCounter()

  const { raw, invoiceType, lines } = parsed

  const issues: ValidationIssue[] = [
    ...runRequiredChecks(parsed),
    ...runFormatChecks(parsed),
    ...checkForTypos(raw, lines),       // misspelled field detection (format layer)
    ...runCrossFieldChecks(parsed),
    ...runConditionalChecks(parsed),
    ...runMathChecks(parsed),
    ...runSequenceChecks(raw, invoiceType, lines),
    ...runItemChecks(raw, invoiceType, lines),
  ]

  // Deduplicate by field+message (in case a field triggers both required and format)
  const seen = new Set<string>()
  const unique = issues.filter(i => {
    const key = `${i.field}:${i.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return unique.sort(
    (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]
  )
}