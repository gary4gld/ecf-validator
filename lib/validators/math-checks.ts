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
import { validateTasaISC, ISC_ALCOHOL_CODES, VALID_ISC_CODES } from './isc-rates'

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

// ── Check 8: Header ImpuestosAdicionales — TipoImpuesto enum + TasaImpuestoAdicional ──────────

/**
 * Validates each <ImpuestoAdicional> entry in the HEADER section:
 *   Totales > ImpuestosAdicionales > ImpuestoAdicional
 *
 * (Distinct from item-level TablaImpuestoAdicional which contains only TipoImpuesto.)
 *
 * Checks:
 *   a) TipoImpuesto must be a valid code 001–039 (red if not)
 *   b) For codes 006–022 (ISC específico alcohol), TasaImpuestoAdicional must match
 *      the DGII quarterly rate for the FechaEmision period (orange if mismatch,
 *      blue informational if rate not yet confirmed in isc-rates.ts table)
 *
 * Source: PDF field 106, validation rules a-c. XSD: ImpuestosAdicionalesType.
 */
export function checkHeaderImpuestosAdicionales(
  xml:   string,
  lines: XmlLine[]
): ValidationIssue[] {
  // Only proceed if the header ImpuestosAdicionales section exists
  const headerMatch = xml.match(/<ImpuestosAdicionales>([\s\S]*?)<\/ImpuestosAdicionales>/)
  if (!headerMatch) return []

  const issues: ValidationIssue[] = []
  const headerSection  = headerMatch[1]
  const fechaEmision = (xml.match(/<FechaEmision>([^<]+)<\/FechaEmision>/) ?? [])[1]?.trim() ?? ''

  // Iterate over each ImpuestoAdicional entry (maxOccurs=20 per XSD)
  const blocks = headerSection.match(/<ImpuestoAdicional>[\s\S]*?<\/ImpuestoAdicional>/g) ?? []

  for (const block of blocks) {
    const tipoMatch = block.match(/<TipoImpuesto>([^<]+)<\/TipoImpuesto>/)
    if (!tipoMatch) continue

    const tipo = tipoMatch[1].trim()

    // a) TipoImpuesto enum: must be 001–039
    if (!VALID_ISC_CODES.has(tipo)) {
      issues.push({
        id: nextId(), severity: 'red',
        field: 'TipoImpuesto',
        line: findLine(/<TipoImpuesto>/, lines),
        message: `TipoImpuesto "${tipo}" en la sección ImpuestosAdicionales (Totales) es inválido. Los valores aceptados son 001–039 según la Tabla I del Formato eCF.`,
      })
      continue
    }

    // b) TasaImpuestoAdicional rate check for ISC alcohol codes 006–022
    const tasaMatch = block.match(/<TasaImpuestoAdicional>([^<]+)<\/TasaImpuestoAdicional>/)
    if (!tasaMatch || !ISC_ALCOHOL_CODES.has(tipo)) continue

    const tasaDeclared = parseFloat(tasaMatch[1].trim())
    if (isNaN(tasaDeclared)) continue

    const result = validateTasaISC(tipo, tasaDeclared, fechaEmision)

    if (result.status === 'mismatch') {
      issues.push({
        id: nextId(), severity: 'orange',
        field: 'TasaImpuestoAdicional',
        line: findLine(/<TasaImpuestoAdicional>/, lines),
        message: `TasaImpuestoAdicional (${fmt(tasaDeclared)}) para TipoImpuesto ${tipo} no coincide con la tasa vigente según ${result.resolution}: se esperan ${fmt(result.expected)} RD$/L. Esta tasa varía trimestralmente por inflación (resoluciones DDG-AR1, dgii.gov.do/legislacion/resoluciones/).`,
      })
    } else if (result.status === 'unconfirmed') {
      issues.push({
        id: nextId(), severity: 'blue',
        field: 'TasaImpuestoAdicional',
        line: findLine(/<TasaImpuestoAdicional>/, lines),
        message: `TasaImpuestoAdicional: la tasa ISC para el período ${result.key} (${result.resolution}) no está confirmada en nuestra tabla. Verifica contra la resolución DDG-AR1 vigente en dgii.gov.do/legislacion/resoluciones/.`,
      })
    } else if (result.status === 'period_unknown') {
      issues.push({
        id: nextId(), severity: 'blue',
        field: 'TasaImpuestoAdicional',
        line: findLine(/<TasaImpuestoAdicional>/, lines),
        message: `TasaImpuestoAdicional: no se encontró tasa ISC para el período derivado de la FechaEmision. Verifica la resolución DDG-AR1 correspondiente en dgii.gov.do/legislacion/resoluciones/.`,
      })
    }
  }

  return issues
}

// ── Check 6: OtraMoneda section totals ────────────────────────────────────────

/**
 * Validates internal consistency of the <OtraMoneda> section when present.
 * All fields are optional (minOccurs=0), so each check only fires when the
 * relevant fields are actually present in the document.
 *
 * Formulas (from PDF field definitions 123-135):
 *   MontoGravadoTotalOtraMoneda = MontoGravado1 + MontoGravado2 + MontoGravado3
 *   TotalITBISOtraMoneda        = TotalITBIS1   + TotalITBIS2   + TotalITBIS3
 *   MontoTotalOtraMoneda        = MontoGravadoTotalOtraMoneda + MontoExentoOtraMoneda + TotalITBISOtraMoneda + MontoImpuestoAdicionalOtraMoneda
 *   Cross-check (informational): MontoTotalOtraMoneda ≈ MontoTotal / TipoCambio
 */
export function checkOtraMonedaTotals(
  xml:   string,
  lines: XmlLine[]
): ValidationIssue[] {
  if (!/<OtraMoneda>/.test(xml)) return []
  const issues: ValidationIssue[] = []

  // Convenience alias — already handles null/NaN
  const g = (field: string): number | null => getNum(field, xml)

  // ── MontoGravadoTotalOtraMoneda = MontoGravado1 + MontoGravado2 + MontoGravado3
  const g1    = g('MontoGravado1OtraMoneda')
  const g2    = g('MontoGravado2OtraMoneda')
  const g3    = g('MontoGravado3OtraMoneda')
  const gTot  = g('MontoGravadoTotalOtraMoneda')
  if (gTot !== null && (g1 !== null || g2 !== null || g3 !== null)) {
    const expected = round2((g1 ?? 0) + (g2 ?? 0) + (g3 ?? 0))
    if (Math.abs(gTot - expected) > TOLERANCE) {
      issues.push({
        id: nextId(), severity: 'orange',
        field: 'MontoGravadoTotalOtraMoneda',
        line: findLine(/<MontoGravadoTotalOtraMoneda>/, lines),
        message: `MontoGravadoTotalOtraMoneda (${fmt(gTot)}) no coincide con MontoGravado1 + MontoGravado2 + MontoGravado3 OtraMoneda: ${fmt(expected)}. Diferencia: ${fmt(Math.abs(gTot - expected))}.`,
      })
    }
  }

  // ── TotalITBISOtraMoneda = TotalITBIS1 + TotalITBIS2 + TotalITBIS3
  const i1    = g('TotalITBIS1OtraMoneda')
  const i2    = g('TotalITBIS2OtraMoneda')
  const i3    = g('TotalITBIS3OtraMoneda')
  const iTot  = g('TotalITBISOtraMoneda')
  if (iTot !== null && (i1 !== null || i2 !== null || i3 !== null)) {
    const expected = round2((i1 ?? 0) + (i2 ?? 0) + (i3 ?? 0))
    if (Math.abs(iTot - expected) > TOLERANCE) {
      issues.push({
        id: nextId(), severity: 'orange',
        field: 'TotalITBISOtraMoneda',
        line: findLine(/<TotalITBISOtraMoneda>/, lines),
        message: `TotalITBISOtraMoneda (${fmt(iTot)}) no coincide con TotalITBIS1 + TotalITBIS2 + TotalITBIS3 OtraMoneda: ${fmt(expected)}. Diferencia: ${fmt(Math.abs(iTot - expected))}.`,
      })
    }
  }

  // ── MontoTotalOtraMoneda = MontoGravadoTotalOtraMoneda + MontoExentoOtraMoneda + TotalITBISOtraMoneda + MontoImpuestoAdicionalOtraMoneda
  const exento    = g('MontoExentoOtraMoneda')
  const impAdicOM = g('MontoImpuestoAdicionalOtraMoneda')
  const mTot      = g('MontoTotalOtraMoneda')
  if (mTot !== null && gTot !== null && iTot !== null) {
    const expected = round2(gTot + (exento ?? 0) + iTot + (impAdicOM ?? 0))
    if (Math.abs(mTot - expected) > TOLERANCE) {
      issues.push({
        id: nextId(), severity: 'orange',
        field: 'MontoTotalOtraMoneda',
        line: findLine(/<MontoTotalOtraMoneda>/, lines),
        message: `MontoTotalOtraMoneda (${fmt(mTot)}) no coincide con MontoGravadoTotalOtraMoneda + MontoExentoOtraMoneda + TotalITBISOtraMoneda + MontoImpuestoAdicionalOtraMoneda: ${fmt(expected)}. Diferencia: ${fmt(Math.abs(mTot - expected))}.`,
      })
    }
  }

  // ── Cross-check: MontoTotalOtraMoneda ≈ MontoTotal / TipoCambio
  const montoTotal = g('MontoTotal')
  const tipoCambio = g('TipoCambio')
  if (mTot !== null && montoTotal !== null && tipoCambio !== null && tipoCambio > 0) {
    const expected = round2(montoTotal / tipoCambio)
    const tol = Math.max(0.50, round2(mTot * 0.01))
    if (Math.abs(mTot - expected) > tol) {
      issues.push({
        id: nextId(), severity: 'yellow',
        field: 'MontoTotalOtraMoneda',
        line: findLine(/<MontoTotalOtraMoneda>/, lines),
        message: `MontoTotalOtraMoneda (${fmt(mTot)}) difiere significativamente de MontoTotal (${fmt(montoTotal)}) ÷ TipoCambio (${tipoCambio}): ${fmt(expected)}. Diferencia: ${fmt(Math.abs(mTot - expected))}. Verifica la consistencia del tipo de cambio y los montos en otra moneda.`,
      })
    }

    // Per-rate cross-checks: MontoGravadoTotalOtraMoneda ≈ MontoGravadoTotal / TipoCambio
    //                         TotalITBISOtraMoneda       ≈ TotalITBIS / TipoCambio
    // Yellow (informational) — exchange rate rounding legitimately causes small differences.
    const mGravadoTotal = g('MontoGravadoTotal')
    if (gTot !== null && mGravadoTotal !== null) {
      const exp = round2(mGravadoTotal / tipoCambio)
      const t   = Math.max(0.50, round2(gTot * 0.01))
      if (Math.abs(gTot - exp) > t) {
        issues.push({
          id: nextId(), severity: 'yellow',
          field: 'MontoGravadoTotalOtraMoneda',
          line: findLine(/<MontoGravadoTotalOtraMoneda>/, lines),
          message: `MontoGravadoTotalOtraMoneda (${fmt(gTot)}) difiere de MontoGravadoTotal (${fmt(mGravadoTotal)}) ÷ TipoCambio (${tipoCambio}): ${fmt(exp)}. Diferencia: ${fmt(Math.abs(gTot - exp))}.`,
        })
      }
    }

    const totalITBIS = g('TotalITBIS')
    if (iTot !== null && totalITBIS !== null) {
      const exp = round2(totalITBIS / tipoCambio)
      const t   = Math.max(0.50, round2(iTot * 0.01))
      if (Math.abs(iTot - exp) > t) {
        issues.push({
          id: nextId(), severity: 'yellow',
          field: 'TotalITBISOtraMoneda',
          line: findLine(/<TotalITBISOtraMoneda>/, lines),
          message: `TotalITBISOtraMoneda (${fmt(iTot)}) difiere de TotalITBIS (${fmt(totalITBIS)}) ÷ TipoCambio (${tipoCambio}): ${fmt(exp)}. Diferencia: ${fmt(Math.abs(iTot - exp))}.`,
        })
      }
    }
  }

  return issues
}

// ── Check 7: TotalCif = TotalFob + Seguro + Flete + OtrosGastos (E-46) ────────

/**
 * When TotalCif is present alongside at least one of its components, validates
 * that TotalCif = TotalFob + Seguro + Flete + OtrosGastos (absent fields = 0).
 * Applies to all types since the fields are in InformacionesAdicionales, but in
 * practice only E-46 invoices will ever have these fields.
 */
export function checkTotalCif(
  xml:   string,
  lines: XmlLine[]
): ValidationIssue[] {
  const totalCif = getNum('TotalCif', xml)
  if (totalCif === null) return []

  const g = (f: string): number => getNum(f, xml) ?? 0

  const fob    = g('TotalFob')
  const seguro = g('Seguro')
  const flete  = g('Flete')
  const otros  = g('OtrosGastos')

  const expected = round2(fob + seguro + flete + otros)
  if (Math.abs(totalCif - expected) > TOLERANCE) {
    return [{
      id: nextId(), severity: 'orange',
      field: 'TotalCif',
      line: findLine(/<TotalCif>/, lines),
      message: `TotalCif (${fmt(totalCif)}) no coincide con TotalFob (${fmt(fob)}) + Seguro (${fmt(seguro)}) + Flete (${fmt(flete)}) + OtrosGastos (${fmt(otros)}) = ${fmt(expected)}. Diferencia: ${fmt(Math.abs(totalCif - expected))} DOP.`,
    }]
  }
  return []
}