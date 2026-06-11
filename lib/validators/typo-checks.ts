/**
 * Misspelled field detection — item #15.
 *
 * XML parsers silently ignore unrecognized elements. A field like <MontoTotla>
 * is valid XML — the parser reads it without complaint — but DGII rejects it and
 * our validator never finds the expected <MontoTotal>. This creates confusing
 * downstream errors ("required field missing", "math discrepancy") without any
 * explanation of why.
 *
 * Algorithm:
 *   1. Strip <Signature> block (W3C namespace fields — not DGII names)
 *   2. Extract all unique tag names from the remaining XML
 *   3. Skip any tag in KNOWN_FIELDS (fast Set lookup)
 *   4. For unknowns: compute Levenshtein distance to all known fields
 *   5a. If min distance ≤ 2 → 🟡 yellow "probable/posible typo — ¿quisiste decir X?"
 *   5b. If min distance > 2 → 🔴 red "field does not exist in DGII XSD schema —
 *       DGII will reject with element is not expected"
 *
 * Counter prefix: typo-N. Counter reset is managed externally by validator.ts
 * via resetTypoCounter() — checkForTypos does NOT reset it internally.
 */

import type { ValidationIssue, XmlLine } from '../types'

// ── Counter ───────────────────────────────────────────────────────────────────

let _typoCounter = 0
export function resetTypoCounter(): void { _typoCounter = 0 }
function nextId(): string { return `typo-${++_typoCounter}` }

function findLine(tag: string, lines: XmlLine[]): number | null {
  const re = new RegExp(`<${tag}[\\s>]`)
  for (const l of lines) {
    if (re.test(l.content)) return l.number
  }
  return null
}

// ── Known fields ──────────────────────────────────────────────────────────────

/**
 * All valid ECF element names across all 10 invoice types + RFCE.
 * Compiled from XSD schemas and PDF format specification.
 * Used for Levenshtein comparison — if a document contains a tag NOT in this
 * set, we check if it's a near-miss (possible typo) of something in the set.
 */
export const KNOWN_FIELDS = new Set<string>([
  // ── Root ──
  'ECF', 'RFCE', 'Encabezado', 'DetallesItems', 'FechaHoraFirma',
  'DescuentosORecargos', 'InformacionReferencia', 'InformacionesAdicionales',
  'Signature',

  // ── IdDoc ──
  'Version', 'IdDoc',
  'TipoeCF', 'eNCF',
  'FechaVencimientoSecuencia', 'IndicadorEnvioDiferido', 'IndicadorMontoGravado',
  'TipoIngresos', 'TipoPago', 'TotalPaginas', 'FechaDesde', 'FechaHasta',
  'TablaFormasPago', 'FormaDePago', 'FormaPago', 'MontoPago',
  'FechaLimitePago',              // conditional on credit invoices
  'IndicadorNotaCredito',         // E-34 credit note indicator
  'TipoCuentaPago',               // payment account type
  'IndicadorServicioTodoIncluido',// all-inclusive service indicator
  'TerminoPago',                  // payment term

  // ── Emisor ──
  'Emisor',
  'RNCEmisor', 'RazonSocialEmisor', 'NombreComercial', 'Sucursal',
  'DireccionEmisor', 'Municipio', 'Provincia',
  'TablaTelefonoEmisor', 'TelefonoEmisor',
  'CorreoEmisor', 'WebSite', 'ActividadEconomica',
  'CodigoVendedor', 'NumeroFacturaInterna', 'NumeroPedidoInterno',
  'ZonaVenta', 'RutaVenta', 'InformacionAdicionalEmisor',
  'FechaEmision',

  // ── Comprador ──
  'Comprador',
  'RNCComprador', 'IdentificadorExtranjero',
  'RazonSocialComprador', 'ContactoComprador',
  'CorreoComprador', 'DireccionComprador',
  'MunicipioComprador', 'ProvinciaComprador', 'PaisComprador',
  'FechaEntrega', 'FechaOrdenCompra', 'NumeroOrdenCompra',
  'CodigoInternoComprador', 'ResponsablePago',
  'ContactoEntrega', 'DireccionEntrega', 'TelefonoAdicional',
  'InformacionAdicionalComprador',

  // ── Totales ──
  'Totales',
  'MontoGravadoTotal', 'MontoGravadoI1', 'MontoGravadoI2', 'MontoGravadoI3',
  'MontoExento',
  'ITBIS1', 'ITBIS2', 'ITBIS3',
  'TotalITBIS', 'TotalITBIS1', 'TotalITBIS2', 'TotalITBIS3',
  'MontoImpuestoAdicional', 'MontoTotal',
  'MontoNoFacturable', 'MontoPeriodo', 'SaldoAnterior',
  'MontoAvancePago', 'ValorPagar',
  'TotalITBISRetenido', 'TotalISRRetencion',
  'TotalITBISPercepcion', 'TotalISRPercepcion',
  'NumeroCuentaPago', 'BancoPago',

  // ── OtraMoneda (Encabezado) ──
  'OtraMoneda',
  'TipoMoneda', 'TipoCambio',
  'MontoGravadoTotalOtraMoneda',
  'MontoGravado1OtraMoneda', 'MontoGravado2OtraMoneda', 'MontoGravado3OtraMoneda',
  'MontoExentoOtraMoneda',
  'TotalITBISOtraMoneda', 'TotalITBIS1OtraMoneda',
  'TotalITBIS2OtraMoneda', 'TotalITBIS3OtraMoneda',
  'MontoImpuestoAdicionalOtraMoneda', 'MontoTotalOtraMoneda',

  // ── InformacionReferencia ──
  'NCFModificado', 'FechaNCFModificado', 'CodigoModificacion',
  'RazonModificacion', 'RNCOtroContribuyente',

  // ── InformacionesAdicionales (shared fields; E-46 export fields listed below) ──
  'NumeroContenedor', 'NumeroReferencia',
  'FechaEmbarque', 'NumeroEmbarque',

  // ── InformacionesAdicionales — E-46 export / port fields (obligation 0 in all other types) ──
  'NombrePuertoEmbarque', 'CondicionesEntrega',
  'TotalFob', 'Seguro', 'Flete', 'OtrosGastos', 'TotalCif',
  'RegimenAduanero', 'NombrePuertoSalida', 'NombrePuertoDesembarque',

  // ── InformacionesAdicionales — weight/bulk detail (present in most types, not E-46 only) ──
  'PesoBruto', 'PesoNeto', 'UnidadPesoBruto', 'UnidadPesoNeto',
  'CantidadBulto', 'UnidadBulto', 'VolumenBulto', 'UnidadVolumen',

  // ── Transporte ──
  // E-46 only: ViaTransporte, PaisOrigen, DireccionDestino, PaisDestino (+ E-47),
  //            RNCIdentificacionCompaniaTransportista, NombreCompaniaTransportista, NumeroViaje
  // Most types: Conductor, DocumentoTransporte, Ficha, Placa,
  //             RutaTransporte, ZonaTransporte, NumeroAlbaran
  'Transporte',
  'ViaTransporte', 'PaisOrigen', 'DireccionDestino', 'PaisDestino',
  'RNCIdentificacionCompaniaTransportista', 'NombreCompaniaTransportista', 'NumeroViaje',
  'Conductor', 'DocumentoTransporte', 'Ficha', 'Placa',
  'RutaTransporte', 'ZonaTransporte', 'NumeroAlbaran',

  // ── DescuentosORecargos ──
  'DescuentoORecargo', 'NumeroLinea',
  'TipoAjuste', 'DescripcionDescuentooRecargo', 'TipoValor',
  'MontoDescuentooRecargo', 'ValorDescuentooRecargo',
  'MontoDescuentooRecargoOtraMoneda',
  'IndicadorFacturacionDescuentooRecargo', 'IndicadorNorma1007',
  'TablaImpuestoAdicional',    // also appears within DescuentosORecargos
  'ImpuestoAdicionalOtraMoneda',

  // ── Paginacion ──
  'Paginacion', 'Pagina',
  'PaginaNo', 'NoLineaDesde', 'NoLineaHasta',
  'SubtotalMontoGravadoPagina',
  'SubtotalMontoGravado1Pagina', 'SubtotalMontoGravado2Pagina', 'SubtotalMontoGravado3Pagina',
  'SubtotalExentoPagina', 'SubtotalItbisPagina',
  'SubtotalItbis1Pagina', 'SubtotalItbis2Pagina', 'SubtotalItbis3Pagina',
  'MontoSubtotalPagina',
  'SubtotalImpuestoAdicional', 'SubtotalImpuestoAdicionalPagina',
  'SubtotalImpuestoSelectivoConsumoEspecificoPagina',
  'SubtotalOtrosImpuesto', 'SubtotalMontoNoFacturablePagina',

  // ── Item ──
  'Item',
  'TablaCodigosItem', 'CodigosItem', 'TipoCodigo', 'CodigoItem',
  'IndicadorFacturacion',
  'Retencion', 'IndicadorAgenteRetencionoPercepcion',
  'MontoITBISRetenido', 'MontoISRRetenido',
  'NombreItem', 'IndicadorBienoServicio', 'DescripcionItem',
  'CantidadItem', 'UnidadMedida',
  'CantidadReferencia', 'UnidadReferencia',
  'TablaSubcantidad', 'SubcantidadItem', 'Subcantidad', 'CodigoSubcantidad',
  'GradosAlcohol', 'PrecioUnitarioReferencia',
  'FechaElaboracion', 'FechaVencimientoItem',
  'Mineria', 'PesoNetoKilogramo', 'PesoNetoMineria',
  'TipoAfiliacion', 'Liquidacion',
  'PrecioUnitarioItem',
  'DescuentoMonto',
  'TablaSubDescuento', 'SubDescuento',
  'TipoSubDescuento', 'SubDescuentoPorcentaje', 'MontoSubDescuento',
  'RecargoMonto',
  'TablaSubRecargo', 'SubRecargo',
  'TipoSubRecargo', 'SubRecargoPorcentaje', 'MontoSubRecargo',
  'OtraMonedaDetalle',
  'PrecioOtraMoneda', 'DescuentoOtraMoneda', 'RecargoOtraMoneda', 'MontoItemOtraMoneda',
  'MontoItem',

  // ── ImpuestosAdicionales (item-level) ──
  'ImpuestosAdicionales', 'ImpuestoAdicional',
  'TipoImpuesto', 'TasaImpuestoAdicional',
  'MontoImpuestoSelectivoConsumoEspecifico',
  'MontoImpuestoSelectivoConsumoAdvalorem',
  'OtrosImpuestosAdicionales',

  // ── Subtotales ──
  'Subtotales', 'Subtotal',
  'NumeroSubTotal', 'DescripcionSubtotal', 'Orden',
  'SubTotalExento', 'SubTotalMontoGravadoTotal',
  'SubTotalMontoGravadoI1', 'SubTotalMontoGravadoI2', 'SubTotalMontoGravadoI3',
  'SubTotaITBIS', 'SubTotaITBIS1', 'SubTotaITBIS2', 'SubTotaITBIS3',
  'MontoSubTotal', 'SubTotalImpuestoAdicional', 'Lineas',

  // ── RFCE ──
  'CodigoSeguridadeCF',
])

// ── Levenshtein distance ──────────────────────────────────────────────────────

function levenshtein(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1
  const m = a.length, n = b.length
  const row = Array.from({length: n + 1}, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = i
    let rowMin = Infinity
    for (let j = 1; j <= n; j++) {
      const curr = a[i - 1] === b[j - 1]
        ? row[j - 1]
        : 1 + Math.min(prev, row[j], row[j - 1])
      row[j - 1] = prev
      prev = curr
      rowMin = Math.min(rowMin, curr)
    }
    row[n] = prev
    if (rowMin > maxDist) return maxDist + 1  // early exit
  }
  return row[n]
}

function closestKnown(tag: string): { field: string; dist: number } | null {
  let bestField = ''
  let bestDist = 3  // only report distance ≤ 2
  for (const known of KNOWN_FIELDS) {
    const d = levenshtein(tag, known, bestDist - 1)
    if (d < bestDist) {
      bestDist = d
      bestField = known
      if (bestDist === 1) break  // can't do better
    }
  }
  return bestDist <= 2 ? { field: bestField, dist: bestDist } : null
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Detect element names that are not in the known ECF schema but are close
 * (Levenshtein distance ≤ 2) to a known field — likely typos.
 */
export function checkForTypos(raw: string, lines: XmlLine[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Strip Signature block — W3C namespace elements (SignedInfo, X509Certificate, etc.)
  // are not DGII field names and would produce false positives.
  const stripped = raw.replace(/<Signature[\s\S]*?<\/Signature>/gi, '')

  // Extract all unique opening tag names
  const tagRe = /<([A-Za-z][A-Za-z0-9]*)/g
  const seen = new Set<string>()
  let m
  while ((m = tagRe.exec(stripped)) !== null) {
    seen.add(m[1])
  }

  for (const tag of seen) {
    if (KNOWN_FIELDS.has(tag)) continue  // known — skip

    const match = closestKnown(tag)

    if (match) {
      // Near-miss: likely a typo of a known field
      const confidence = match.dist === 1 ? 'Probable' : 'Posible'
      issues.push({
        id: nextId(),
        severity: 'yellow',
        field: tag,
        line: findLine(tag, lines),
        message: `<${tag}> no es un campo reconocido del esquema eCF. ${confidence} error tipográfico — ¿quisiste decir <${match.field}>? Los campos mal escritos son ignorados por el parser XML y causan que el valor declarado nunca sea leído.`,
      })
    } else {
      // Completely unknown — DGII will reject with "element is not expected"
      issues.push({
        id: nextId(),
        severity: 'red',
        field: tag,
        line: findLine(tag, lines),
        message: `<${tag}> no existe en el esquema XSD de la DGII. DGII rechazará el documento con el error "element is not expected". Si este campo proviene de un sistema ERP o integración, debe ser excluido del XML antes del envío.`,
      })
    }
  }

  return issues
}