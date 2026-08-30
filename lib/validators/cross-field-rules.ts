/**
 * Cross-field validation rules.
 *
 * These rules require looking at multiple fields simultaneously and cannot
 * be expressed as simple per-field format checks. They capture business
 * logic from the DGII documentation that goes beyond what the XSD schemas
 * can enforce structurally.
 */

import type { InvoiceType, ValidationIssue, XmlLine } from '../types'
import { ENCF_PREFIXES, E32_RFCE_THRESHOLD } from './schema-types'

let _crossCounter = 0
function nextId(): string {
  return `cross-${++_crossCounter}`
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

// ── eNCF prefix vs TipoeCF ────────────────────────────────────────────────────

/**
 * The first 3 characters of the eNCF must match the document type.
 * E.g. TipoeCF = 31 → eNCF must start with "E31".
 * This is a DGII business rule, not enforced in the XSD schema itself.
 */
export function checkEncfTipoMismatch(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  const tipo = getValue('TipoeCF', xml)
  const encf = getValue('eNCF', xml)
  if (!tipo || !encf || encf.length < 3) return null

  const expectedPrefix = ENCF_PREFIXES[tipo]
  if (!expectedPrefix) return null // unknown type

  const actualPrefix = encf.substring(0, 3).toUpperCase()
  if (actualPrefix !== expectedPrefix) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'eNCF',
      line: findLine(/<eNCF>/, lines),
      message: `eNCF no coincide con TipoeCF: el documento es tipo ${tipo} pero el eNCF comienza con "${encf.substring(0, 3)}" en lugar de "${expectedPrefix}". DGII rechazará esta combinación.`,
    }
  }
  return null
}

// ── Digital signature notes ───────────────────────────────────────────────────

/**
 * Checks whether a digital signature block is present.
 * Missing signature is informational — the document may be pre-signing.
 * We look for common signature element names used in the Dominican PKI.
 */
export function checkSignaturePresence(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  const hasSignature =
    xml.includes('<ds:Signature') ||
    xml.includes('<Signature ') ||
    xml.includes('<FirmaDigital') ||
    xml.includes('<SignatureValue')

  if (!hasSignature) {
    return {
      id: nextId(),
      severity: 'blue',
      field: 'Firma digital',
      line: null,
      message:
        'No se detectó un bloque de firma digital. Si este documento va a ser enviado a DGII, debe estar firmado con un certificado digital válido emitido por un PSC autorizado.',
    }
  }
  return null
}

// ── E-32 RFCE threshold note ──────────────────────────────────────────────────

/**
 * E-32 invoices with MontoTotal below RD$250,000 must also submit an RFCE
 * (Resumen de Factura de Consumo Electrónica) to fc.dgii.gov.do.
 */
export function checkE32RfceRequirement(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue | null {
  if (invoiceType !== 'E-32') return null

  const montoStr = getValue('MontoTotal', xml)
  if (!montoStr) return null

  const monto = parseFloat(montoStr.replace(/,/g, ''))
  if (isNaN(monto)) return null

  if (monto < E32_RFCE_THRESHOLD) {
    return {
      id: nextId(),
      severity: 'blue',
      field: 'MontoTotal',
      line: findLine(/<MontoTotal>/, lines),
      message: `MontoTotal (${montoStr}) es menor a RD$${E32_RFCE_THRESHOLD.toLocaleString()}. Esta factura de consumo requiere un RFCE (Resumen de Factura de Consumo Electrónica) adicional, que debe enviarse a fc.dgii.gov.do después de recibir respuesta de ecf.dgii.gov.do.`,
    }
  }
  return null
}

// ── RFCE: CodigoSeguridadeCF source reminder ──────────────────────────────────

/**
 * Informational note reminding how the CodigoSeguridadeCF should be derived.
 * Only shown when the field is present (format errors are handled separately).
 */
export function checkRfceCodigoNote(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue | null {
  if (invoiceType !== 'E-32-R') return null

  const codigo = getValue('CodigoSeguridadeCF', xml)
  if (!codigo) return null // missing is caught by required-fields

  return {
    id: nextId(),
    severity: 'blue',
    field: 'CodigoSeguridadeCF',
    line: findLine(/<CodigoSeguridadeCF>/, lines),
    message: `CodigoSeguridadeCF detectado (${codigo.length} chars). Recuerda: este valor debe ser los primeros 6 caracteres del SignatureValue de la firma del e-CF de consumo original, no del RFCE.`,
  }
}

// ── FechaHoraFirma — conditional on signature ─────────────────────────────────

/**
 * FechaHoraFirma is required on all final signed documents, but for a
 * pre-signature XML it won't exist yet. The check is therefore conditional:
 *
 *   No signature + no FechaHoraFirma → blue note (expected for pre-signing)
 *   Signature present + no FechaHoraFirma → red error (must be set before signing)
 *   FechaHoraFirma present → format is validated separately in format-checks.ts
 */
export function checkFechaHoraFirma(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue | null {
  // RFCE documents do not have a FechaHoraFirma element in their schema
  if (invoiceType === 'E-32-R') return null

  const hasFecha = /<FechaHoraFirma>/.test(xml)
  if (hasFecha) return null // format validated separately

  const hasSig =
    xml.includes('<ds:Signature') ||
    xml.includes('<Signature ') ||
    xml.includes('<FirmaDigital') ||
    xml.includes('<SignatureValue')

  if (hasSig) {
    // Signed document without the timestamp — real error
    return {
      id: nextId(),
      severity: 'red',
      field: 'FechaHoraFirma',
      line: null,
      message:
        'FechaHoraFirma está ausente en un documento que ya tiene firma digital. Este campo es obligatorio y debe indicar la fecha/hora en que se aplicó la firma (formato: DD-MM-YYYY HH:MM:SS, zona GMT-4).',
    }
  } else {
    // Pre-signature — informational only
    return {
      id: nextId(),
      severity: 'blue',
      field: 'FechaHoraFirma',
      line: null,
      message:
        'FechaHoraFirma no está presente. Esto es esperado en documentos pre-firma. Antes de firmar, debes agregar la fecha y hora exacta de la firma en formato DD-MM-YYYY HH:MM:SS (zona horaria GMT-4).',
    }
  }
}



/** The only valid version value in all DGII schemas is "1.0". */
export function checkVersion(xml: string, lines: XmlLine[]): ValidationIssue | null {
  const v = getValue('Version', xml)
  if (!v) return null

  if (v.trim() !== '1.0') {
    return {
      id: nextId(),
      severity: 'red',
      field: 'Version',
      line: findLine(/<Version>/, lines),
      message: `Version inválida: "${v}". El único valor permitido en todos los esquemas DGII es "1.0".`,
    }
  }
  return null
}

// ── IndicadorNotaCredito date validation (E-34 only) ─────────────────────────

/**
 * IndicadorNotaCredito must match the actual elapsed time between the original
 * invoice date (FechaNCFModificado) and the current note's FechaEmision:
 *
 *   ≤ 30 calendar days → IndicadorNotaCredito must be 0
 *   > 30 calendar days → IndicadorNotaCredito must be 1
 *
 * This is fiscally significant:
 *   - Value 0 (≤ 30 days): the note can deduct ITBIS
 *   - Value 1 (> 30 days): the note has NO right to deduct ITBIS
 *
 * Both dates are in DD-MM-YYYY format per DGII schema.
 */
export function checkIndicadorNotaCreditoDate(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue | null {
  if (invoiceType !== 'E-34') return null

  const indicador = getValue('IndicadorNotaCredito', xml)
  const fechaNCF  = getValue('FechaNCFModificado', xml)
  const fechaEmision = getValue('FechaEmision', xml)

  if (!indicador || !fechaNCF || !fechaEmision) return null

  // Parse DD-MM-YYYY into a Date object
  function parseDGIIDate(s: string): Date | null {
    const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
    if (!m) return null
    return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]))
  }

  const original = parseDGIIDate(fechaNCF)
  const emision  = parseDGIIDate(fechaEmision)
  if (!original || !emision) return null

  const diffMs   = emision.getTime() - original.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  const expectedIndicador = diffDays > 30 ? '1' : '0'
  const actualIndicador   = indicador.trim()

  if (actualIndicador !== expectedIndicador) {
    const daysLabel = diffDays === 1 ? '1 día' : `${diffDays} días`
    const fiscal = expectedIndicador === '0'
      ? 'con derecho a rebajar ITBIS'
      : 'SIN derecho a rebajar ITBIS'

    return {
      id: nextId(),
      severity: 'red',
      field: 'IndicadorNotaCredito',
      line: findLine(/<IndicadorNotaCredito>/, lines),
      message: `IndicadorNotaCredito incorrecto: el valor es "${actualIndicador}" pero debería ser "${expectedIndicador}". Han transcurrido ${daysLabel} entre FechaNCFModificado (${fechaNCF}) y FechaEmision (${fechaEmision}). Esta nota de crédito es ${fiscal}.`,
    }
  }

  return null
}

// ── FechaVencimientoSecuencia > FechaEmision ─────────────────────────────────

/**
 * FechaVencimientoSecuencia must be on or after FechaEmision.
 * An invoice can't be issued after its own sequence has expired.
 */
export function checkFechaVencimientoSecuencia(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  const vencRaw    = getValue('FechaVencimientoSecuencia', xml)
  const emisionRaw = getValue('FechaEmision', xml)
  if (!vencRaw || !emisionRaw) return null

  function parseDate(s: string): Date | null {
    const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
    if (!m) return null
    return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]))
  }

  const venc    = parseDate(vencRaw)
  const emision = parseDate(emisionRaw)
  if (!venc || !emision) return null

  if (venc < emision) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'FechaVencimientoSecuencia',
      line: findLine(/<FechaVencimientoSecuencia>/, lines),
      message: `FechaVencimientoSecuencia (${vencRaw}) es anterior a FechaEmision (${emisionRaw}). No se puede emitir un comprobante con una secuencia ya vencida.`,
    }
  }
  return null
}

// ── FechaDesde ≤ FechaHasta ───────────────────────────────────────────────────

/**
 * When both FechaDesde and FechaHasta are present in IdDoc (billing period),
 * FechaDesde must be ≤ FechaHasta.
 */
export function checkFechaDesdeHasta(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  const desdeRaw = getValue('FechaDesde', xml)
  const hastaRaw = getValue('FechaHasta', xml)
  if (!desdeRaw || !hastaRaw) return null

  function parseDate(s: string): Date | null {
    const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
    if (!m) return null
    return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]))
  }

  const desde = parseDate(desdeRaw)
  const hasta = parseDate(hastaRaw)
  if (!desde || !hasta) return null

  if (desde > hasta) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'FechaDesde',
      line: findLine(/<FechaDesde>/, lines),
      message: `FechaDesde (${desdeRaw}) es posterior a FechaHasta (${hastaRaw}). El período de facturación no puede terminar antes de comenzar.`,
    }
  }

  // FechaDesde after FechaEmision is unusual (advance invoice) — warn, don't reject
  const emisionRaw = getValue('FechaEmision', xml)
  const emision    = emisionRaw ? parseDate(emisionRaw) : null
  if (emision && desde > emision) {
    return {
      id: nextId(),
      severity: 'yellow',
      field: 'FechaDesde',
      line: findLine(/<FechaDesde>/, lines),
      message: `FechaDesde (${desdeRaw}) es posterior a FechaEmision (${emisionRaw}). El período facturado comienza después de la fecha de emisión — esto corresponde a una factura adelantada. Verifica que sea intencional.`,
    }
  }

  return null
}



/**
 * FechaHoraFirma must be >= FechaEmision.
 * A signing timestamp before the invoice emission date is physically impossible.
 */
export function checkFechaHoraFirmaConsistency(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  const firmaRaw   = getValue('FechaHoraFirma', xml)
  const emisionRaw = getValue('FechaEmision', xml)
  if (!firmaRaw || !emisionRaw) return null

  function parseDGIIDate(s: string): Date | null {
    const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
    if (!m) return null
    return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]))
  }

  const firma   = parseDGIIDate(firmaRaw)
  const emision = parseDGIIDate(emisionRaw)
  if (!firma || !emision) return null

  if (firma < emision) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'FechaHoraFirma',
      line: findLine(/<FechaHoraFirma>/, lines),
      message: `FechaHoraFirma (${firmaRaw}) es anterior a FechaEmision (${emisionRaw}). Es físicamente imposible firmar un documento antes de emitirlo. Verifica que ambas fechas sean correctas.`,
    }
  }
  return null
}

// ── FechaHoraFirma ≤ hora actual (Formato sección G, validación b) ────────────

/** Below this, a future offset is treated as ordinary clock jitter → silent. */
const FIRMA_SKEW_SILENT_MS = 60_000          // 1 minute
/** Between SILENT and this, likely local clock skew → yellow rather than red. */
const FIRMA_SKEW_YELLOW_MS = 5 * 60_000      // 5 minutes

/**
 * DGII rule — Formato eCF, sección G, validación b:
 *   "Valida que fecha y hora firma del e-CF =< fecha y hora actual."
 *
 * FechaHoraFirma is declared in GMT-4 ("Zona horaria GMT -4", sección G). The
 * Dominican Republic does not observe DST, so the offset is -4 year-round.
 *
 * The timestamp is parsed as GMT-4 wall time and converted to a UTC instant
 * before comparing with Date.now(). We deliberately do NOT build a local Date:
 * that would silently use the validator's own timezone and give wrong answers
 * for anyone not sitting in GMT-4.
 *
 * Severity is tiered so ordinary clock drift doesn't produce a false red:
 *   ≤ 1 min ahead   → silent
 *   1–5 min ahead   → yellow (probably local clock skew, but worth checking)
 *   > 5 min ahead   → red (DGII rejects)
 *
 * A ~4 hour gap gets a targeted message: that is the fingerprint of an emitter
 * writing UTC into a field DGII reads as GMT-4 — the most common cause by far.
 */
export function checkFechaHoraFirmaFutura(
  xml: string,
  lines: XmlLine[]
): ValidationIssue | null {
  const raw = getValue('FechaHoraFirma', xml)
  if (!raw) return null

  // Single-digit H/m/s are tolerated here because the XSD pattern allows them;
  // the zero-padding requirement is reported separately by format-checks.
  const m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/)
  if (!m) return null   // malformed → format-checks already reports it

  // +4h converts the GMT-4 wall time into the corresponding UTC instant.
  const firmaUtcMs = Date.UTC(
    parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
    parseInt(m[4]) + 4, parseInt(m[5]), parseInt(m[6])
  )

  const aheadMs = firmaUtcMs - Date.now()
  if (aheadMs <= FIRMA_SKEW_SILENT_MS) return null

  const line     = findLine(/<FechaHoraFirma>/, lines)
  const aheadMin = Math.round(aheadMs / 60_000)

  if (aheadMs <= FIRMA_SKEW_YELLOW_MS) {
    return {
      id: nextId(),
      severity: 'yellow',
      field: 'FechaHoraFirma',
      line,
      message: `FechaHoraFirma (${raw}) está ~${aheadMin} min en el futuro respecto a la hora actual en GMT-4. DGII exige que la fecha y hora de firma sea menor o igual a la hora actual. Un desfase tan pequeño suele deberse al reloj local, pero verifica la sincronización (NTP) antes de enviar.`,
    }
  }

  const hoursAhead = aheadMs / 3_600_000
  const magnitude  = hoursAhead >= 1 ? `${hoursAhead.toFixed(1)} h` : `${aheadMin} min`
  const utcHint    =
    hoursAhead >= 3.5 && hoursAhead <= 4.5
      ? ' El desfase es de ~4 horas: es exactamente el patrón de un emisor que escribe la hora en UTC en un campo que DGII interpreta como GMT-4. Convierte la hora a GMT-4 antes de serializar el XML.'
      : ''

  return {
    id: nextId(),
    severity: 'red',
    field: 'FechaHoraFirma',
    line,
    message: `FechaHoraFirma (${raw}) está ~${magnitude} en el futuro respecto a la hora actual en GMT-4. DGII rechazará el e-CF: la validación exige que la fecha y hora de firma sea menor o igual a la hora actual (Formato sección G, validación b).${utcHint}`,
  }
}

// ── NCFModificado prefix validation ───────────────────────────────────────────

/**
 * NCFModificado (inside InformacionReferencia for E-33/34) must reference a valid
 * invoice type prefix. E.g. "E480000000013" is invalid — type 48 does not exist.
 * Old-style NCF prefixes (B01–B16) are also valid when modifying paper invoices.
 */
export function checkNCFModificadoPrefix(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue | null {
  if (invoiceType !== 'E-33' && invoiceType !== 'E-34') return null

  const ncf = getValue('NCFModificado', xml)
  if (!ncf) return null

  const validPrefixes = new Set([
    'E31','E32','E33','E34','E41','E43','E44','E45','E46','E47',
    'B01','B02','B03','B04','B11','B12','B13','B14','B15','B16',
  ])

  if (ncf.length >= 3) {
    const prefix = ncf.substring(0, 3).toUpperCase()
    if (prefix.startsWith('E') && !validPrefixes.has(prefix)) {
      return {
        id: nextId(),
        severity: 'red',
        field: 'NCFModificado',
        line: findLine(/<NCFModificado>/, lines),
        message: `NCFModificado "${ncf}" referencia el tipo "${prefix}" que no existe. Prefijos e-CF válidos: E31, E32, E33, E34, E41, E43, E44, E45, E46, E47. Si modifica un NCF anterior en papel, use el formato B01–B16.`,
      }
    }
  }
  return null
}

export function resetCrossCounter(): void {
  _crossCounter = 0
}

// ── Forbidden field checks ────────────────────────────────────────────────────

/**
 * Some fields/sections do not exist in certain invoice type schemas.
 * If they appear in the XML, DGII will reject the document because
 * xs:sequence is strictly validated — unexpected elements are not allowed.
 */
export function checkForbiddenFields(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const push = (issue: ValidationIssue | null) => { if (issue) issues.push(issue) }

  // E-32 and E-34: FechaVencimientoSecuencia is not defined in their schemas
  if (
    (invoiceType === 'E-32' || invoiceType === 'E-34') &&
    /<FechaVencimientoSecuencia>/.test(xml)
  ) {
    push({
      id: nextId(),
      severity: 'red',
      field: 'FechaVencimientoSecuencia',
      line: findLine(/<FechaVencimientoSecuencia>/, lines),
      message: `FechaVencimientoSecuencia no forma parte del esquema ${invoiceType}. Su presencia causará rechazo por DGII. Este campo solo aplica a E-31, E-33, E-41, E-43, E-44, E-45, E-46 y E-47.`,
    })
  }

  // E-41, E-43, E-47: TipoIngresos is not defined in their schemas
  if (
    ['E-41', 'E-43', 'E-47'].includes(invoiceType) &&
    /<TipoIngresos>/.test(xml)
  ) {
    push({
      id: nextId(),
      severity: 'red',
      field: 'TipoIngresos',
      line: findLine(/<TipoIngresos>/, lines),
      message: `TipoIngresos no forma parte del esquema ${invoiceType}. Su presencia causará rechazo por DGII. Este campo no aplica a comprobantes de compras, gastos menores ni pagos al exterior.`,
    })
  }

  // E-47: RNCComprador is not in the E-47 schema — recipients are non-resident foreigners
  if (invoiceType === 'E-47' && /<RNCComprador>/.test(xml)) {
    issues.push({
      id: nextId(),
      severity: 'red',
      field: 'RNCComprador',
      line: findLine(/<RNCComprador>/, lines),
      message: 'RNCComprador no existe en el esquema de E-47 (Pagos al Exterior). Los destinatarios son personas físicas o jurídicas no residentes que no tienen RNC dominicano. Usar IdentificadorExtranjero para identificarlos.',
    })
  }

  // E-43: The entire <Comprador> section is absent from the E-43 XSD schema
  // (obligation code 0 for the whole area). Any content under <Comprador>
  // will cause a DGII rejection with "element is not expected".
  if (invoiceType === 'E-43' && /<Comprador>/.test(xml)) {
    issues.push({
      id: nextId(), severity: 'red',
      field: 'Comprador',
      line: findLine(/<Comprador>/, lines),
      message: 'La sección <Comprador> completa tiene código de obligatoriedad 0 para E-43 (Gastos Menores) — no existe en el esquema XSD. Su presencia causará rechazo por DGII con el error "element is not expected". Los comprobantes de gastos menores no identifican al comprador.',
    })
  }

  // E-41 and E-43: The entire <Transporte> section is absent from these XSD
  // schemas (obligation code 0 for the whole area, Formato e-CF PDF page 17).
  // Any <Transporte> content causes a DGII rejection with "element is not expected".
  //
  // E-47 is intentionally NOT included here: although the PDF section-header row
  // also shows 0 for E-47, the e-CF 47 XSD DOES define <Transporte> containing a
  // single <PaisDestino> child (field 81 = opcional/3 for E-47). E-47's other
  // Transporte children are already forbidden by the e46OnlyFields loop below,
  // and PaisDestino is explicitly allowed there.
  if ((invoiceType === 'E-41' || invoiceType === 'E-43') && /<Transporte>/.test(xml)) {
    issues.push({
      id: nextId(), severity: 'red',
      field: 'Transporte',
      line: findLine(/<Transporte>/, lines),
      message: `La sección <Transporte> completa tiene código de obligatoriedad 0 para ${invoiceType} — no existe en el esquema XSD de este tipo. Su presencia causará rechazo por DGII con el error "element is not expected".`,
    })
  }

  // Mineria (item-level section) exists only in E-32, E-33, E-34, E-46, where it is
  // conditional (code 2 — "a que exista facturación relacionada al sector minería";
  // Formato e-CF PDF p.40). It is forbidden (code 0) in E-31, E-41, E-43, E-44, E-45
  // and E-47 — <Mineria> is absent from those XSDs, so its presence causes a DGII
  // rejection with "element is not expected". The four child fields
  // (PesoNetoKilogramo, PesoNetoMineria, TipoAfiliacion, Liquidacion) only ever
  // appear nested inside <Mineria>, so flagging the wrapper covers them.
  const mineriaForbiddenTypes = new Set<InvoiceType>([
    'E-31', 'E-41', 'E-43', 'E-44', 'E-45', 'E-47',
  ])
  if (mineriaForbiddenTypes.has(invoiceType) && /<Mineria>/.test(xml)) {
    issues.push({
      id: nextId(), severity: 'red',
      field: 'Mineria',
      line: findLine(/<Mineria>/, lines),
      message: `La sección <Mineria> no aplica para ${invoiceType} (código de obligatoriedad 0 — no existe en su esquema XSD). Solo E-32, E-33, E-34 y E-46 admiten esta sección, condicional a facturación del sector minería. Su presencia causará rechazo por DGII con el error "element is not expected".`,
    })
  }

  // IdentificadorExtranjero is forbidden (obligation code 0) in the four types that
  // never carry it: E-31, E-41, E-45 (they have a Comprador with RNCComprador but no
  // IdentificadorExtranjero element) and E-43 (no Comprador section at all). Verified
  // against each XSD's Comprador complexType. Source: PDF obligation table field 39.
  //
  // For E-43 the <Comprador> wrapper, if present, is already flagged above as a whole
  // forbidden section, so suppress this per-field message when that fired to avoid
  // double-reporting the same root cause. It still fires for a stray
  // <IdentificadorExtranjero> in E-43 that has no <Comprador> wrapper.
  const ieForbiddenTypes = new Set<InvoiceType>(['E-31', 'E-41', 'E-43', 'E-45'])
  const compradorWrapperFlagged = invoiceType === 'E-43' && /<Comprador>/.test(xml)
  if (
    ieForbiddenTypes.has(invoiceType) &&
    /<IdentificadorExtranjero>/.test(xml) &&
    !compradorWrapperFlagged
  ) {
    const reason = invoiceType === 'E-43'
      ? 'Los comprobantes de gastos menores no identifican al comprador — no existe sección Comprador en el esquema.'
      : 'El comprador en este tipo de e-CF debe identificarse con RNCComprador (RNC o Cédula dominicana).'
    issues.push({
      id: nextId(), severity: 'red',
      field: 'IdentificadorExtranjero',
      line: findLine(/<IdentificadorExtranjero>/, lines),
      message: `IdentificadorExtranjero no aplica para ${invoiceType}. ${reason} Su presencia causará rechazo por DGII.`,
    })
  }

  // Mutual exclusion: RNCComprador and IdentificadorExtranjero cannot both be present.
  // Source: PDF footnotes 3 and 7 — "cuando exista IdentificadorExtranjero se omitirá RNCComprador".
  if (/<RNCComprador>/.test(xml) && /<IdentificadorExtranjero>/.test(xml)) {
    issues.push({
      id: nextId(), severity: 'red',
      field: 'IdentificadorExtranjero',
      line: findLine(/<IdentificadorExtranjero>/, lines),
      message: 'RNCComprador e IdentificadorExtranjero no pueden estar presentes simultáneamente. Son mutuamente excluyentes: use RNCComprador para compradores con RNC/Cédula dominicana, o IdentificadorExtranjero para extranjeros sin RNC dominicano — nunca ambos.',
    })
  }

  // IdentificadorExtranjero max length: 20 alphanumeric characters.
  const ieVal = getValue('IdentificadorExtranjero', xml)
  if (ieVal && ieVal.trim().length > 20) {
    issues.push({
      id: nextId(), severity: 'red',
      field: 'IdentificadorExtranjero',
      line: findLine(/<IdentificadorExtranjero>/, lines),
      message: `IdentificadorExtranjero excede el máximo de 20 caracteres (actual: ${ieVal.trim().length}). El campo acepta hasta 20 caracteres alfanuméricos.`,
    })
  }

  // ── E-46-only fields: forbidden in all other invoice types ────────────────
  // These fields (InformacionesAdicionales export fields + Transporte section) have
  // obligation code 0 for E-31 through E-47 except E-46. Source: PDF table fields 60-84.
  if (invoiceType !== 'E-46') {
    const e46OnlyFields: [string, string][] = [
      // InformacionesAdicionales — export/port fields (obligation 0 for all types except E-46)
      ['NombrePuertoEmbarque',   'NombrePuertoEmbarque'],
      ['CondicionesEntrega',     'CondicionesEntrega'],
      ['TotalFob',               'TotalFob (valor FOB)'],
      ['Seguro',                 'Seguro'],
      ['Flete',                  'Flete'],
      ['OtrosGastos',            'OtrosGastos'],
      ['TotalCif',               'TotalCif'],
      ['RegimenAduanero',        'RegimenAduanero'],
      ['NombrePuertoSalida',     'NombrePuertoSalida'],
      ['NombrePuertoDesembarque','NombrePuertoDesembarque'],
      // Transporte — export-specific fields (obligation 0 for all except E-46; PaisDestino also E-47)
      ['ViaTransporte',          'ViaTransporte'],
      ['PaisOrigen',             'PaisOrigen'],
      ['DireccionDestino',       'DireccionDestino'],
      ['RNCIdentificacionCompaniaTransportista', 'RNCIdentificacionCompaniaTransportista'],
      ['NombreCompaniaTransportista', 'NombreCompaniaTransportista'],
      ['NumeroViaje',            'NumeroViaje'],
      // Comprador
      ['PaisComprador',          'PaisComprador'],
    ]

    // For E-41/E-43 the whole <Transporte> section is already flagged once at the
    // wrapper level above. Its child fields only ever appear nested inside it, so
    // skip the per-child Transporte checks for those two types to avoid reporting
    // the same root cause twice. They still fire for E-31/32/33/34/44/45/47.
    const transporteChildren = new Set([
      'ViaTransporte', 'PaisOrigen', 'DireccionDestino',
      'RNCIdentificacionCompaniaTransportista', 'NombreCompaniaTransportista', 'NumeroViaje',
    ])
    const transporteWrapperFlagged =
      (invoiceType === 'E-41' || invoiceType === 'E-43') && /<Transporte>/.test(xml)

    for (const [field, label] of e46OnlyFields) {
      if (transporteWrapperFlagged && transporteChildren.has(field)) continue
      if (new RegExp(`<${field}>`).test(xml)) {
        issues.push({
          id: nextId(), severity: 'red',
          field,
          line: findLine(new RegExp(`<${field}>`), lines),
          message: `${label} solo aplica para E-46 (Exportaciones). Su presencia en ${invoiceType} causará rechazo por DGII con "element is not expected".`,
        })
      }
    }

    // PaisDestino is valid for E-46 AND E-47 (obligation 3 for both)
    // but forbidden (obligation 0) in all other types.
    if (invoiceType !== 'E-47' && /<PaisDestino>/.test(xml)) {
      issues.push({
        id: nextId(), severity: 'red',
        field: 'PaisDestino',
        line: findLine(/<PaisDestino>/, lines),
        message: `PaisDestino solo aplica para E-46 (Exportaciones) y E-47 (Pagos al Exterior). Su presencia en ${invoiceType} causará rechazo por DGII.`,
      })
    }
  }

  // ── PesoBruto ≥ PesoNeto ────────────────────────────────────────────────────
  // Applies whenever both fields are present (E-46 InformacionesAdicionales).
  // Gross weight includes packaging and must always be ≥ net weight.
  const pesoBrutoStr = getValue('PesoBruto', xml)
  const pesoNetoStr  = getValue('PesoNeto',  xml)
  if (pesoBrutoStr && pesoNetoStr) {
    const pesoBruto = parseFloat(pesoBrutoStr)
    const pesoNeto  = parseFloat(pesoNetoStr)
    if (!isNaN(pesoBruto) && !isNaN(pesoNeto) && pesoBruto < pesoNeto) {
      issues.push({
        id: nextId(), severity: 'red',
        field: 'PesoBruto',
        line: findLine(/<PesoBruto>/, lines),
        message: `PesoBruto (${pesoBruto}) no puede ser menor que PesoNeto (${pesoNeto}). El peso bruto incluye embalaje y debe ser mayor o igual al peso neto.`,
      })
    }
  }

  return issues
}

// ── ViaTransporte enum (E-46 only) ────────────────────────────────────────────

/**
 * ViaTransporte (E-46 Transporte section) must be one of the ViaTransporteType
 * codes: 01 (Terrestre), 02 (Marítimo), 03 (Aérea) — zero-padded strings.
 * Only E-46 legally carries ViaTransporte; its presence in any other type is
 * already flagged by the e46OnlyFields loop in checkForbiddenFields, so this
 * value check is scoped to E-46 to avoid double-reporting. Source: XSD
 * ViaTransporteType (e-CF_46_v_1_0.xsd).
 */
export function checkViaTransporteValue(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue | null {
  if (invoiceType !== 'E-46') return null

  const via = getValue('ViaTransporte', xml)
  if (!via) return null

  if (!['01', '02', '03'].includes(via.trim())) {
    return {
      id: nextId(),
      severity: 'red',
      field: 'ViaTransporte',
      line: findLine(/<ViaTransporte>/, lines),
      message: `ViaTransporte="${via}" es inválido. Valores válidos (ViaTransporteType): 01 (Terrestre), 02 (Marítimo), 03 (Aérea). Deben incluir el cero inicial.`,
    }
  }
  return null
}

// ── E-33 CodigoModificacion must be 3 ────────────────────────────────────────

/**
 * E-33 (Nota de Débito) only allows CodigoModificacion=3 (Corrige montos).
 * E-34 allows codes 1–5; E-33 does not.
 *
 * Source: DGII FAQ sections 1.7.3 and 1.7.4.
 */
export function checkCodigoModificacionE33(
  xml: string,
  invoiceType: InvoiceType,
  lines: XmlLine[]
): ValidationIssue | null {
  if (invoiceType !== 'E-33') return null

  const v = getValue('CodigoModificacion', xml)
  if (!v) return null

  if (v.trim() !== '3') {
    return {
      id: nextId(),
      severity: 'red',
      field: 'CodigoModificacion',
      line: findLine(/<CodigoModificacion>/, lines),
      message: `CodigoModificacion="${v}" es inválido para E-33 (Nota de Débito). Solo se permite código 3 (Corrige montos). Los demás códigos (1 = Anula, 2 = Corrige texto, 4 = Reemplaza contingencia, 5 = Referencia consumo) no aplican para Notas de Débito.`,
    }
  }
  return null
}