/**
 * Conditional field checks — obligation code 2 rules.
 *
 * These rules capture the "Dato Condicional" (code 2) cases from the DGII
 * Formato PDF, plus important rules hidden in footnotes that are easy to miss.
 *
 * Source: Formato_Comprobante_Fiscal_Electrónico_eCF_V1_0.pdf
 *
 * Severity guide:
 *   Red    — field combination is structurally invalid (DGII rejects)
 *   Yellow — field is expected but its absence may produce Aceptado Condicional
 *   Blue   — informational / reminder
 *
 * Note on IndicadorFacturacion type-specific rules (footnotes 50 & 51):
 *   Implicit enforcement here via checkITBISForbiddenTypes — when all items must be
 *   Exento, the corresponding ITBIS amount fields must be absent from Totales.
 *   Explicit per-item enum enforcement (IndicadorFacturacion value per item) is in
 *   item-checks.ts (checkIndicadorFacturacion) via DOM parsing.
 */

import type { InvoiceType, ValidationIssue, XmlLine } from '../types'

// ── Internals ─────────────────────────────────────────────────────────────────

let _condCounter = 0
function nextId(): string {
  return `cond-${++_condCounter}`
}

function findLine(pattern: RegExp, lines: XmlLine[]): number | null {
  for (const l of lines) {
    if (pattern.test(l.content)) return l.number
  }
  return null
}

function getValue(field: string, xml: string): string | null {
  const m = xml.match(new RegExp(`<${field}[^>]*>([^<]+)</${field}>`))
  return m ? m[1].trim() : null
}

function getNum(field: string, xml: string): number | null {
  const v = getValue(field, xml)
  if (!v) return null
  const n = parseFloat(v.replace(/,/g, ''))
  return isNaN(n) ? null : n
}

function present(field: string, xml: string): boolean {
  return new RegExp(`<${field}[\\s/>]`).test(xml)
}

// ── Rule 1: FechaLimitePago when TipoPago = 2 (crédito) ──────────────────────

/**
 * FechaLimitePago is conditional to TipoPago=2.
 * Applicable to E-31/32/33/34/41/44/45/46. Code 0 for E-43, code 3 for E-47.
 */
export function checkFechaLimitePago(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue | null {
  // Not applicable for E-43 (no TipoPago) and optional for E-47
  if (invoiceType === 'E-43' || invoiceType === 'E-47' || invoiceType === 'E-32-R') return null

  const tipoPago = getValue('TipoPago', xml)
  if (tipoPago !== '2') return null // only required when credit

  if (!present('FechaLimitePago', xml)) {
    return {
      id: nextId(),
      severity: 'yellow',
      field: 'FechaLimitePago',
      line: findLine(/<TipoPago>/, lines),
      message: 'TipoPago=2 (Crédito) pero FechaLimitePago está ausente. Este campo es condicional cuando el tipo de pago es crédito. Formato: DD-MM-YYYY. La fecha debe ser ≥ FechaEmision.',
    }
  }
  return null
}

// ── Rule 2: ITBIS triplet consistency ─────────────────────────────────────────

/**
 * The three ITBIS-related fields for each rate form a triplet that must
 * appear together: MontoGravadoIn, ITBISn, TotalITBISn.
 * If any one of them is present, the other two should be as well.
 *
 * Source: TotalITBIS1 = "Condicional a que exista Monto Gravado tasa 1 y tasa ITBIS 1"
 */
export function checkITBISTriplets(
  xml: string,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const triplets = [
    { base: 'MontoGravadoI1', rate: 'ITBIS1', total: 'TotalITBIS1', label: 'tasa 1 (18%)' },
    { base: 'MontoGravadoI2', rate: 'ITBIS2', total: 'TotalITBIS2', label: 'tasa 2 (16%)' },
    { base: 'MontoGravadoI3', rate: 'ITBIS3', total: 'TotalITBIS3', label: 'tasa 3 (0%)' },
  ] as const

  for (const { base, rate, total, label } of triplets) {
    const hasBase  = present(base, xml)
    const hasRate  = present(rate, xml)
    const hasTotal = present(total, xml)
    const anyPresent = hasBase || hasRate || hasTotal

    if (!anyPresent) continue

    const missing: string[] = []
    if (!hasBase)  missing.push(base)
    if (!hasRate)  missing.push(rate)
    if (!hasTotal) missing.push(total)

    if (missing.length > 0) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field: missing[0],
        line: findLine(new RegExp(`<${hasBase ? base : hasRate ? rate : total}>`), lines),
        message: `Los campos ITBIS ${label} deben aparecer juntos: ${base}, ${rate} y ${total}. Faltan: ${missing.join(', ')}. Si alguno de los tres está presente, los otros dos también son requeridos.`,
      })
    }
  }

  return issues
}

// ── Rule 3: TotalITBIS when any TotalITBISn present ──────────────────────────

/**
 * TotalITBIS is conditional when at least one of TotalITBIS1/2/3 exists.
 * Source: "Condicional a que exista Total ITBIS Tasa 1, y/o Total ITBIS Tasa 2 y/o Total ITBIS Tasa 3."
 */
export function checkTotalITBISPresence(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  const anySubTotal =
    present('TotalITBIS1', xml) ||
    present('TotalITBIS2', xml) ||
    present('TotalITBIS3', xml)

  if (!anySubTotal) return null
  if (present('TotalITBIS', xml)) return null

  return {
    id: nextId(),
    severity: 'red',
    field: 'TotalITBIS',
    line: null,
    message: 'TotalITBIS está ausente pero existen TotalITBIS1/2/3. TotalITBIS es requerido cuando existe al menos uno de los totales ITBIS por tasa.',
  }
}

// ── Rule 4: OtraMoneda section completeness ───────────────────────────────────

/**
 * When <OtraMoneda> section is present, TipoMoneda and TipoCambio are required.
 * Source: TipoCambio "Condicional a que existan datos en código otra moneda."
 */
export function checkOtraMoneda(
  xml: string,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!present('OtraMoneda', xml)) return issues

  if (!present('TipoMoneda', xml)) {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: 'TipoMoneda',
      line: findLine(/<OtraMoneda>/, lines),
      message: 'La sección OtraMoneda está presente pero falta TipoMoneda. Este campo es requerido cuando se factura en moneda extranjera. Usar código ISO 4217 (ej. "USD", "EUR").',
    })
  }

  if (!present('TipoCambio', xml)) {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: 'TipoCambio',
      line: findLine(/<OtraMoneda>/, lines),
      message: 'La sección OtraMoneda está presente pero falta TipoCambio. El factor de conversión es requerido cuando se factura en moneda extranjera. Formato: 3 enteros y 4 decimales, > 0.',
    })
  }

  return issues
}

// ── Rule 5 & 6: E-32 buyer identification above RD$250,000 ───────────────────

/**
 * For E-32 with MontoTotal ≥ RD$250,000:
 *   - RazonSocialComprador is required (obligation code 2 becomes mandatory)
 *   - If RNCComprador is absent, IdentificadorExtranjero is required
 *
 * The same rules apply to E-33 and E-34 that modify an E-32 ≥ RD$250,000,
 * but we cannot verify the original invoice amount without external data.
 * For E-33/34, we note the rule as informational.
 *
 * Source: PDF page 13, fields 39 and 40 + footnotes 7 and 8.
 */
export function checkE32BuyerIdentification(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (invoiceType !== 'E-32' && invoiceType !== 'E-33' && invoiceType !== 'E-34') return issues

  const montoTotal = getNum('MontoTotal', xml)
  if (montoTotal === null) return issues

  const THRESHOLD = 250_000

  if (invoiceType === 'E-32' && montoTotal >= THRESHOLD) {
    // RazonSocialComprador required
    if (!present('RazonSocialComprador', xml)) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field: 'RazonSocialComprador',
        line: findLine(/<MontoTotal>/, lines),
        message: `E-32 con MontoTotal ≥ RD$${THRESHOLD.toLocaleString()}: RazonSocialComprador es obligatorio. Debe incluir el nombre o razón social del comprador.`,
      })
    }

    // If RNCComprador is absent, IdentificadorExtranjero required
    if (!present('RNCComprador', xml) && !present('IdentificadorExtranjero', xml)) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field: 'IdentificadorExtranjero',
        line: findLine(/<MontoTotal>/, lines),
        message: `E-32 con MontoTotal ≥ RD$${THRESHOLD.toLocaleString()} y sin RNCComprador: IdentificadorExtranjero es obligatorio para identificar al comprador extranjero. Cuando existe IdentificadorExtranjero, no debe completarse RNCComprador.`,
      })
    }
  }

  // Informational note for E-33/34 since we can't verify the original E-32 amount
  if ((invoiceType === 'E-33' || invoiceType === 'E-34') && montoTotal >= THRESHOLD) {
    if (!present('RazonSocialComprador', xml)) {
      issues.push({
        id: nextId(),
        severity: 'blue',
        field: 'RazonSocialComprador',
        line: findLine(/<MontoTotal>/, lines),
        message: `${invoiceType} con MontoTotal ≥ RD$${THRESHOLD.toLocaleString()}: si esta nota modifica un e-CF tipo 32 cuyo monto original fue ≥ RD$${THRESHOLD.toLocaleString()}, RazonSocialComprador es obligatorio.`,
      })
    }
  }

  return issues
}

// ── Rule 7: FormaPago=5 only valid for E-32 ───────────────────────────────────

/**
 * FormaPago value 5 (Bonos o Certificados de regalo) is only valid on E-32.
 * Source: PDF page 9, field 12, footnote:
 *   "Si la forma de pago corresponde al tipo 5 el e-CF debe ser tipo 32."
 */
export function checkFormaPagoBonos(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue | null {
  if (invoiceType === 'E-32' || invoiceType === 'E-32-R') return null

  // Check if value 5 appears inside TablaFormasPago
  const formasPagoMatch = xml.match(/<TablaFormasPago>[\s\S]*?<\/TablaFormasPago>/)
  if (!formasPagoMatch) return null

  const hasFormaPago5 = /<FormaPago>\s*5\s*<\/FormaPago>/.test(formasPagoMatch[0])
  if (!hasFormaPago5) return null

  return {
    id: nextId(),
    severity: 'red',
    field: 'FormaPago',
    line: findLine(/<FormaPago>\s*5\s*<\/FormaPago>/, lines),
    message: `FormaPago=5 (Bonos o Certificados de regalo) solo es válido para facturas de consumo (E-32). Este documento es tipo ${invoiceType}. DGII rechazará esta combinación.`,
  }
}

// ── Rule 8: ITBIS header fields forbidden in E-43, E-44, E-47 ────────────────

/**
 * Footnote 50, PDF page 36:
 *   "El valor del indicador de facturación para los tipos de e-CF 43, 44 y 47
 *    debe ser igual a 4 (Exento)."
 *
 * Since ALL items are Exento in these types, no ITBIS amounts should appear
 * in the Totales section. Their presence indicates a structural error.
 * These fields have obligation code 0 (no corresponde) for these types.
 */
export function checkITBISForbiddenTypes(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!['E-43', 'E-44', 'E-47'].includes(invoiceType)) return issues

  const forbidden = [
    'MontoGravadoTotal', 'MontoGravadoI1', 'MontoGravadoI2', 'MontoGravadoI3',
    'ITBIS1', 'ITBIS2', 'ITBIS3',
    'TotalITBIS', 'TotalITBIS1', 'TotalITBIS2', 'TotalITBIS3',
  ]

  for (const field of forbidden) {
    if (present(field, xml)) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field,
        line: findLine(new RegExp(`<${field}>`), lines),
        message: `${field} no debe estar presente en ${invoiceType}. Todos los ítems de este tipo de comprobante deben tener IndicadorFacturacion=4 (Exento), por lo que no aplican campos de ITBIS en los totales (código 0 = no corresponde).`,
      })
    }
  }

  return issues
}

// ── Rule 9: ITBIS rate 1 and 2 fields forbidden in E-46 ──────────────────────

/**
 * Footnote 51, PDF page 36:
 *   "El valor del indicador de facturación para el tipo de e-CF 46 debe ser
 *    igual a 3 (ITBIS tasa cero)."
 *
 * E-46 (Exportaciones) uses IndicadorFacturacion=3 (ITBIS 0%), NOT 4 (Exento)
 * and NOT 0 (No Facturable). Only rate-3 fields are valid in Totales.
 * Fields for rates 1 and 2 have obligation code 0 (no corresponde) for E-46.
 */
export function checkE46ITBISRates(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (invoiceType !== 'E-46') return issues

  const forbidden = [
    'MontoGravadoI1', 'MontoGravadoI2',
    'ITBIS1', 'ITBIS2',
    'TotalITBIS1', 'TotalITBIS2',
  ]

  for (const field of forbidden) {
    if (present(field, xml)) {
      issues.push({
        id: nextId(),
        severity: 'red',
        field,
        line: findLine(new RegExp(`<${field}>`), lines),
        message: `${field} no debe estar presente en E-46 (Exportaciones). Todos los ítems deben tener IndicadorFacturacion=3 (ITBIS tasa 0%). Solo los campos MontoGravadoI3, ITBIS3 y TotalITBIS3 son válidos para este tipo.`,
      })
    }
  }

  return issues
}

// ── Rule 10: MontoPago within TablaFormasPago ─────────────────────────────────

/**
 * When TablaFormasPago is present, each FormaDePago entry needs MontoPago.
 * Source: MontoPago "Condicional a que exista una forma de pago."
 * We do a simple check: if FormaPago tags exist but MontoPago tags are fewer.
 */
export function checkMontoPago(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  if (!present('TablaFormasPago', xml)) return null

  const formaPagoCount = (xml.match(/<FormaPago>/g) || []).length
  const montoPagoCount = (xml.match(/<MontoPago>/g) || []).length

  if (formaPagoCount > 0 && montoPagoCount < formaPagoCount) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'MontoPago',
      line: findLine(/<TablaFormasPago>/, lines),
      message: `TablaFormasPago tiene ${formaPagoCount} FormaPago pero solo ${montoPagoCount} MontoPago. Cada entrada de FormaDePago requiere su MontoPago correspondiente.`,
    }
  }

  return null
}

/** Reset the conditional check ID counter (call at start of each validation run). */
export function resetCondCounter(): void {
  _condCounter = 0
}

// ── TablaFormasPago sum = ValorPagar ──────────────────────────────────────────

/**
 * The sum of all MontoPago entries in TablaFormasPago must equal ValorPagar.
 * If ValorPagar is absent, compare against MontoTotal instead.
 *
 * The payment breakdown must account for the full amount payable — a discrepancy
 * means the forms of payment don't add up to what the customer actually owes.
 */
export function checkFormaPagoSum(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  if (!present('TablaFormasPago', xml)) return null

  // Sum all MontoPago occurrences
  const re = /<MontoPago>([^<]+)<\/MontoPago>/g
  let sum = 0
  let count = 0
  let m
  while ((m = re.exec(xml)) !== null) {
    const n = parseFloat(m[1].trim())
    if (!isNaN(n)) { sum += n; count++ }
  }
  if (count === 0) return null

  sum = Math.round(sum * 100) / 100

  // Compare against ValorPagar, fall back to MontoTotal
  const referenceField = getNum('ValorPagar', xml) !== null ? 'ValorPagar' : 'MontoTotal'
  const reference = getNum(referenceField, xml)
  if (reference === null) return null

  const diff = Math.abs(sum - reference)
  if (diff > 0.02) {
    return {
      id: nextId(),
      severity: 'orange',
      field: 'MontoPago',
      line: findLine(/<TablaFormasPago>/, lines),
      message: `La suma de MontoPago en TablaFormasPago (${sum.toFixed(2)}) no coincide con ${referenceField} (${reference.toFixed(2)}). Diferencia: ${diff.toFixed(2)} DOP. Las formas de pago deben sumar el total a pagar.`,
    }
  }
  return null
}