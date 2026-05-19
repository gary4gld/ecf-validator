/**
 * Math validation — ITBIS calculations and total consistency.
 *
 * Severity: orange — the document will likely be accepted by DGII's XSD
 * validator (the numbers are numeric, in range, etc.) but the fiscal math
 * is wrong, meaning the invoice misrepresents the transaction or will trigger
 * an audit flag.
 *
 * Formulas from Formato Comprobante Fiscal Electrónico eCF V1.0.pdf:
 *
 *   MontoTotal        = MontoGravadoTotal + MontoExento + TotalITBIS + MontoImpuestoAdicional
 *   MontoGravadoTotal = MontoGravadoI1 + MontoGravadoI2 + MontoGravadoI3
 *   TotalITBIS        = TotalITBIS1 + TotalITBIS2 + TotalITBIS3
 *   TotalITBIS1       = MontoGravadoI1 × (ITBIS1 / 100)   [ITBIS1 stores 18, not 0.18]
 *   TotalITBIS2       = MontoGravadoI2 × (ITBIS2 / 100)
 *   TotalITBIS3       = MontoGravadoI3 × (ITBIS3 / 100)
 *
 * TOLERANCE:
 * The DGII specifies rounding rules per item, so accumulated rounding across
 * multiple line items can produce small discrepancies in header totals.
 * We use a tolerance of ±0.02 DOP (2 centavos) for all comparisons.
 * For large invoices with many items, rounding drift can exceed this — such
 * false positives are a known limitation until item-level parsing is added.
 *
 * SCOPE:
 * All checks operate on Totales header fields only. Item-level math (verifying
 * that sum(MontoItem) = MontoGravadoTotal + MontoExento) requires DOM-based
 * item parsing and is tracked in VALIDATION_LIMITATIONS.md.
 */

import type { ValidationIssue, XmlLine } from '../types'

// ── Internals ─────────────────────────────────────────────────────────────────

let _mathCounter = 0
function nextId(): string {
  return `math-${++_mathCounter}`
}

function findLine(pattern: RegExp, lines: XmlLine[]): number | null {
  for (const l of lines) {
    if (pattern.test(l.content)) return l.number
  }
  return null
}

/** Extract a numeric field value from XML, returns null if absent or not a number. */
function getNum(field: string, xml: string): number | null {
  const m = xml.match(new RegExp(`<${field}[^>]*>([^<]+)</${field}>`))
  if (!m) return null
  const n = parseFloat(m[1].trim())
  return isNaN(n) ? null : n
}

/** Round to 2 decimal places (same precision as all DGII monetary fields). */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Tolerance in DOP for floating-point rounding across line items. */
const TOLERANCE = 0.02

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE
}

function fmt(n: number): string {
  return n.toFixed(2)
}

// ── Check 1: MontoGravadoTotal = MontoGravadoI1 + MontoGravadoI2 + MontoGravadoI3 ─

/**
 * Validates that MontoGravadoTotal equals the sum of the three taxed-amount
 * sub-fields when all four are present.
 *
 * The document states: "Valor de la sumatoria del total Monto gravado ITBIS
 * Tasa1 + Monto gravado ITBIS Tasa 2 + Monto gravado ITBIS Tasa3."
 */
export function checkMontoGravadoTotal(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  const total = getNum('MontoGravadoTotal', xml)
  const i1    = getNum('MontoGravadoI1', xml)
  const i2    = getNum('MontoGravadoI2', xml)
  const i3    = getNum('MontoGravadoI3', xml)

  // Only validate if all four are present — if some are absent, the partial
  // sub-totals are a separate concern (conditional field checks)
  if (total === null || (i1 === null && i2 === null && i3 === null)) return null

  const sum = round2((i1 ?? 0) + (i2 ?? 0) + (i3 ?? 0))

  if (!approxEqual(total, sum)) {
    return {
      id: nextId(),
      severity: 'orange',
      field: 'MontoGravadoTotal',
      line: findLine(/<MontoGravadoTotal>/, lines),
      message: `MontoGravadoTotal (${fmt(total)}) no coincide con la sumatoria de los montos gravados por tasa: MontoGravadoI1 (${fmt(i1 ?? 0)}) + MontoGravadoI2 (${fmt(i2 ?? 0)}) + MontoGravadoI3 (${fmt(i3 ?? 0)}) = ${fmt(sum)}. Diferencia: ${fmt(Math.abs(total - sum))} DOP.`,
    }
  }
  return null
}

// ── Check 2: TotalITBIS = TotalITBIS1 + TotalITBIS2 + TotalITBIS3 ────────────

/**
 * Validates that TotalITBIS equals the sum of the three per-rate ITBIS amounts.
 *
 * The document states: "Suma de Total ITBIS Tasa 1 + Total ITBIS Tasa 2 +
 * Total ITBIS Tasa 3."
 */
export function checkTotalITBIS(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  const total = getNum('TotalITBIS', xml)
  const t1    = getNum('TotalITBIS1', xml)
  const t2    = getNum('TotalITBIS2', xml)
  const t3    = getNum('TotalITBIS3', xml)

  if (total === null || (t1 === null && t2 === null && t3 === null)) return null

  const sum = round2((t1 ?? 0) + (t2 ?? 0) + (t3 ?? 0))

  if (!approxEqual(total, sum)) {
    return {
      id: nextId(),
      severity: 'orange',
      field: 'TotalITBIS',
      line: findLine(/<TotalITBIS>/, lines),
      message: `TotalITBIS (${fmt(total)}) no coincide con la sumatoria por tasa: TotalITBIS1 (${fmt(t1 ?? 0)}) + TotalITBIS2 (${fmt(t2 ?? 0)}) + TotalITBIS3 (${fmt(t3 ?? 0)}) = ${fmt(sum)}. Diferencia: ${fmt(Math.abs(total - sum))} DOP.`,
    }
  }
  return null
}

// ── Check 3: TotalITBISn = MontoGravadoIn × (ITBISn / 100) ───────────────────

/**
 * Validates each per-rate ITBIS amount against the rate applied to the taxable base.
 *
 * The document states:
 *   "Total ITBIS Tasa1 = Monto Gravado ITBIS tasa1 × ITBIS tasa"
 *
 * Important: ITBIS1/2/3 fields store the RATE as an INTEGER (e.g. 18 for 18%),
 * not as a decimal (not 0.18). Division by 100 is required.
 *
 * Note: Additional selective consumption taxes (ISC codes 006–039) may be
 * included in the taxable ITBIS base per the spec, but this cannot be verified
 * without item-level parsing. We validate the simpler case only.
 */
export function checkITBISRates(
  xml: string,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const checks = [
    { base: 'MontoGravadoI1', rate: 'ITBIS1', total: 'TotalITBIS1' },
    { base: 'MontoGravadoI2', rate: 'ITBIS2', total: 'TotalITBIS2' },
    { base: 'MontoGravadoI3', rate: 'ITBIS3', total: 'TotalITBIS3' },
  ] as const

  for (const { base, rate, total } of checks) {
    const baseVal  = getNum(base, xml)
    const rateVal  = getNum(rate, xml)
    const totalVal = getNum(total, xml)

    // All three must be present for this check to fire
    if (baseVal === null || rateVal === null || totalVal === null) continue

    const expected = round2(baseVal * (rateVal / 100))

    if (!approxEqual(totalVal, expected)) {
      issues.push({
        id: nextId(),
        severity: 'orange',
        field: total,
        line: findLine(new RegExp(`<${total}>`), lines),
        message: `${total} (${fmt(totalVal)}) no coincide con ${base} × (${rate}/100): ${fmt(baseVal)} × ${rateVal}% = ${fmt(expected)}. Diferencia: ${fmt(Math.abs(totalVal - expected))} DOP.`,
      })
    }
  }

  return issues
}

// ── Check 4: MontoTotal = MontoGravadoTotal + MontoExento + TotalITBIS + MontoImpuestoAdicional ─

/**
 * Validates MontoTotal against the official formula.
 *
 * The document states: "Monto Gravado Total + Monto exento + Total ITBIS +
 * Monto del Impuesto adicional."
 *
 * Note: If DescuentosORecargos (global discounts/surcharges) are present,
 * those also affect MontoTotal, but calculating that requires item-level
 * data. We only fire this check when the simpler version applies
 * (no global discounts or surcharges section detected).
 */
export function checkMontoTotal(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  const montoTotal    = getNum('MontoTotal', xml)
  if (montoTotal === null) return null

  // If DescuentosORecargos is present, the formula becomes more complex —
  // skip the check since we cannot calculate it without item-level parsing
  if (/<DescuentosORecargos>/.test(xml)) return null

  const gravadoTotal  = getNum('MontoGravadoTotal', xml) ?? 0
  const exento        = getNum('MontoExento', xml) ?? 0
  const totalITBIS    = getNum('TotalITBIS', xml) ?? 0
  const impAdicional  = getNum('MontoImpuestoAdicional', xml) ?? 0

  // Only check when at least one of the contributing fields is explicitly present
  const anyPresent = [
    getNum('MontoGravadoTotal', xml),
    getNum('MontoExento', xml),
    getNum('TotalITBIS', xml),
    getNum('MontoImpuestoAdicional', xml),
  ].some(v => v !== null)

  if (!anyPresent) return null

  const expected = round2(gravadoTotal + exento + totalITBIS + impAdicional)

  if (!approxEqual(montoTotal, expected)) {
    const parts: string[] = []
    if (getNum('MontoGravadoTotal', xml) !== null) parts.push(`MontoGravadoTotal (${fmt(gravadoTotal)})`)
    if (getNum('MontoExento', xml) !== null)        parts.push(`MontoExento (${fmt(exento)})`)
    if (getNum('TotalITBIS', xml) !== null)         parts.push(`TotalITBIS (${fmt(totalITBIS)})`)
    if (getNum('MontoImpuestoAdicional', xml) !== null) parts.push(`MontoImpuestoAdicional (${fmt(impAdicional)})`)

    return {
      id: nextId(),
      severity: 'orange',
      field: 'MontoTotal',
      line: findLine(/<MontoTotal>/, lines),
      message: `MontoTotal (${fmt(montoTotal)}) no coincide con la fórmula DGII: ${parts.join(' + ')} = ${fmt(expected)}. Diferencia: ${fmt(Math.abs(montoTotal - expected))} DOP.`,
    }
  }
  return null
}

// ── Check 5: ValorPagar consistency ──────────────────────────────────────────

/**
 * Validates ValorPagar when present.
 *
 * ValorPagar = MontoTotal + SaldoAnterior - MontoAvancePago
 *            - TotalITBISRetenido - TotalISRRetencion
 *
 * All adjustment fields are optional — we sum whichever are present.
 */
export function checkValorPagar(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  const valorPagar = getNum('ValorPagar', xml)
  if (valorPagar === null) return null

  const montoTotal    = getNum('MontoTotal', xml) ?? 0
  const saldoAnterior = getNum('SaldoAnterior', xml) ?? 0
  const avancePago    = getNum('MontoAvancePago', xml) ?? 0

  // Formula from DGII Formato PDF page 26, field 115:
  //   ValorPagar = MontoTotal - MontoAvancePago ± SaldoAnterior
  // SaldoAnterior type is NegativoPositivo, so adding it as-is handles both signs.
  // TotalITBISRetenido and TotalISRRetencion are NOT part of this formula per DGII.
  const expected = round2(montoTotal - avancePago + saldoAnterior)

  if (!approxEqual(valorPagar, expected)) {
    return {
      id: nextId(),
      severity: 'orange',
      field: 'ValorPagar',
      line: findLine(/<ValorPagar>/, lines),
      message: `ValorPagar (${fmt(valorPagar)}) no coincide con la fórmula DGII: MontoTotal (${fmt(montoTotal)}) - MontoAvancePago (${fmt(avancePago)}) + SaldoAnterior (${fmt(saldoAnterior)}) = ${fmt(expected)}. Diferencia: ${fmt(Math.abs(valorPagar - expected))} DOP.`,
    }
  }
  return null
}

/** Reset the math issue ID counter (call at start of each validation run). */
export function resetMathCounter(): void {
  _mathCounter = 0
}