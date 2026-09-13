/**
 * ANECF — Anulación de e-NCF validator.
 *
 * Used to void authorized-but-unused eNCF *sequences* (ranges) — only valid if the
 * comprobante was NOT sent to DGII/receiver or the sequence is unused; otherwise a Nota de
 * Crédito (E-34) is required. Separate document, root <ANECF>, schema ANECF_v_1_0.xsd, own path.
 *
 * Structure:
 *   Encabezado: Version (1.0), RncEmisor, CantidadeNCFAnulados (header total),
 *               FechaHoraAnulacioneNCF
 *   DetalleAnulacion > Anulacion (1–10):
 *     NoLinea, TipoeCF (31–47),
 *     TablaRangoSecuenciasAnuladaseNCF > Secuencias (1–10000):
 *        SecuenciaeNCFDesde, SecuenciaeNCFHasta
 *     CantidadeNCFAnulados (per-line total)
 *
 * Quantity rules (Formato Anulación de eNCF):
 *   - per range: Hasta ≥ Desde, same serie+tipo, tipo matches the line's TipoeCF
 *   - per line:  CantidadeNCFAnulados = Σ (HastaSeq − DesdeSeq + 1) over its ranges
 *   - header:    CantidadeNCFAnulados = Σ per-line CantidadeNCFAnulados
 *
 * NOTE the header field is <RncEmisor> (that casing), not <RNCEmisor>.
 */

import type { ParsedXml, ValidationIssue, XmlLine } from '../types'
import { isValidRNC } from './format-checks'

let counter = 0
const nextId = () => `anecf-${++counter}`
export const resetAnecfCounter = () => { counter = 0 }

function getValue(field: string, xml: string): string | null {
  const m = xml.match(new RegExp(`<${field}[^>]*>([^<]*)</${field}>`))
  return m ? m[1].trim() : null
}
function findLine(pattern: RegExp, lines: XmlLine[]): number | null {
  const l = lines.find((ln) => pattern.test(ln.content))
  return l ? l.number : null
}

const VALID_TIPO_ECF = new Set(['31','32','33','34','41','43','44','45','46','47'])
// e-NCF: serie E–Z (except P) + 2-digit tipo + 10-digit secuencial = 13 chars
const ENCF_RE = /^[E-OQ-Z]\d{2}\d{10}$/
function encfSeq(encf: string): number | null {
  return ENCF_RE.test(encf) ? parseInt(encf.slice(3), 10) : null
}

export function runAnecfChecks(parsed: ParsedXml): ValidationIssue[] {
  resetAnecfCounter()
  const { raw: xml, lines } = parsed
  const issues: ValidationIssue[] = []
  const push = (i: ValidationIssue | null) => { if (i) issues.push(i) }
  const red = (field: string, message: string, pat: RegExp): ValidationIssue =>
    ({ id: nextId(), severity: 'red', field, line: findLine(pat, lines), message })
  const orange = (field: string, message: string, pat: RegExp): ValidationIssue =>
    ({ id: nextId(), severity: 'orange', field, line: findLine(pat, lines), message })

  // ── Required fields ──────────────────────────────────────────────────────────
  const REQUIRED: [string, string][] = [
    ['Encabezado',             'La sección Encabezado es obligatoria en el ANECF.'],
    ['Version',                'Version es obligatoria en el ANECF.'],
    ['RncEmisor',              'RncEmisor es obligatorio en el ANECF (RNC del contribuyente que anula).'],
    ['CantidadeNCFAnulados',   'CantidadeNCFAnulados (total) es obligatorio en el Encabezado del ANECF.'],
    ['FechaHoraAnulacioneNCF', 'FechaHoraAnulacioneNCF es obligatoria en el ANECF.'],
    ['DetalleAnulacion',       'La sección DetalleAnulacion es obligatoria en el ANECF.'],
    ['Anulacion',              'Debe existir al menos una Anulacion en el DetalleAnulacion.'],
    ['TipoeCF',                'TipoeCF es obligatorio en cada línea de Anulacion.'],
    ['SecuenciaeNCFDesde',     'SecuenciaeNCFDesde es obligatoria en cada rango de secuencias.'],
    ['SecuenciaeNCFHasta',     'SecuenciaeNCFHasta es obligatoria en cada rango de secuencias.'],
  ]
  for (const [field, msg] of REQUIRED) {
    if (!new RegExp(`<${field}[\\s>]`).test(xml)) push(red(field, msg, new RegExp(`<${field}`)))
  }

  // ── Version ──────────────────────────────────────────────────────────────────
  const version = getValue('Version', xml)
  if (version !== null && version !== '1.0') {
    push(red('Version', `Version del ANECF inválida: "${version}". El único valor válido es 1.0.`, /<Version>/))
  }

  // ── RncEmisor (length/format first, then checksum) ───────────────────────────
  const rnc = getValue('RncEmisor', xml)
  if (rnc && !/^[0-9]{9}$|^[0-9]{11}$/.test(rnc)) {
    push(red('RncEmisor', `RncEmisor (${rnc}) debe tener 9 u 11 dígitos numéricos sin guiones ni espacios.`, /<RncEmisor>/))
  } else if (rnc && !isValidRNC(rnc)) {
    push(red('RncEmisor', `RncEmisor (${rnc}) no supera la validación de dígito verificador (checksum RNC/Cédula).`, /<RncEmisor>/))
  }

  // ── FechaHoraAnulacioneNCF: format + ≤ now (GMT-4) ───────────────────────────
  const fAnul = getValue('FechaHoraAnulacioneNCF', xml)
  if (fAnul !== null) {
    const m = fAnul.match(/^(\d{1,2})-(\d{1,2})-(\d{4}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/)
    if (!m) {
      push(red('FechaHoraAnulacioneNCF',
        `FechaHoraAnulacioneNCF (${fAnul}) debe tener formato DD-MM-YYYY HH:mm:ss (GMT-4).`, /<FechaHoraAnulacioneNCF>/))
    } else {
      const anulUtc = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 4, +m[5], +m[6])  // GMT-4 → UTC
      if (anulUtc - Date.now() > 5 * 60_000) {
        push(red('FechaHoraAnulacioneNCF',
          `FechaHoraAnulacioneNCF (${fAnul}) está en el futuro respecto a la hora actual en GMT-4.`, /<FechaHoraAnulacioneNCF>/))
      }
    }
  }

  // ── Per-line Anulacion parsing + range math ──────────────────────────────────
  const anulBlocks = xml.match(/<Anulacion>[\s\S]*?<\/Anulacion>/g) ?? []
  let sumOfLineTotals = 0
  let lineTotalsAllNumeric = true

  for (const block of anulBlocks) {
    const tipo = getValue('TipoeCF', block)
    if (tipo !== null && !VALID_TIPO_ECF.has(tipo)) {
      push(red('TipoeCF', `TipoeCF "${tipo}" inválido en una línea de Anulacion. Valores válidos: 31–34, 41, 43–47.`, /<TipoeCF>/))
    }

    const seqBlocks = block.match(/<Secuencias>[\s\S]*?<\/Secuencias>/g) ?? []
    let lineComputed = 0
    let lineRangesClean = seqBlocks.length > 0

    for (const seq of seqBlocks) {
      const desde = getValue('SecuenciaeNCFDesde', seq)
      const hasta = getValue('SecuenciaeNCFHasta', seq)
      const dNum = desde ? encfSeq(desde) : null
      const hNum = hasta ? encfSeq(hasta) : null

      if (desde && dNum === null) {
        push(red('SecuenciaeNCFDesde', `SecuenciaeNCFDesde (${desde}) no cumple la estructura de e-NCF (serie E–Z sin P + tipo 2 díg. + 10 díg.), p. ej. E310000000001.`, /<SecuenciaeNCFDesde>/))
        lineRangesClean = false
      }
      if (hasta && hNum === null) {
        push(red('SecuenciaeNCFHasta', `SecuenciaeNCFHasta (${hasta}) no cumple la estructura de e-NCF (serie E–Z sin P + tipo 2 díg. + 10 díg.), p. ej. E310000000005.`, /<SecuenciaeNCFHasta>/))
        lineRangesClean = false
      }
      // serie + tipo must match between Desde and Hasta
      if (desde && hasta && dNum !== null && hNum !== null && desde.slice(0, 3) !== hasta.slice(0, 3)) {
        push(red('SecuenciaeNCFHasta', `El rango ${desde}–${hasta} mezcla serie/tipo distintos; Desde y Hasta deben compartir serie y tipo de comprobante.`, /<SecuenciaeNCFHasta>/))
        lineRangesClean = false
      }
      // tipo of the sequences must match the line's TipoeCF
      if (tipo && desde && dNum !== null && desde.slice(1, 3) !== tipo) {
        push(red('SecuenciaeNCFDesde', `El tipo de la secuencia ${desde} (${desde.slice(1, 3)}) no corresponde al TipoeCF de la línea (${tipo}).`, /<SecuenciaeNCFDesde>/))
        lineRangesClean = false
      }
      // Hasta ≥ Desde
      if (dNum !== null && hNum !== null) {
        if (hNum < dNum) {
          push(red('SecuenciaeNCFHasta', `SecuenciaeNCFHasta (${hasta}) es menor que SecuenciaeNCFDesde (${desde}); el rango final debe ser ≥ al inicial.`, /<SecuenciaeNCFHasta>/))
          lineRangesClean = false
        } else {
          lineComputed += (hNum - dNum + 1)
        }
      }
    }

    // Per-line CantidadeNCFAnulados = Σ ranges
    const lineCantStr = getValue('CantidadeNCFAnulados', block)
    if (lineCantStr !== null && /^\d+$/.test(lineCantStr)) {
      const declared = parseInt(lineCantStr, 10)
      sumOfLineTotals += declared
      if (lineRangesClean && declared !== lineComputed) {
        push(orange('CantidadeNCFAnulados',
          `CantidadeNCFAnulados de la línea (${declared}) no coincide con la suma de sus rangos (${lineComputed} = Σ(Hasta − Desde + 1)).`,
          /<CantidadeNCFAnulados>/))
      }
    } else {
      lineTotalsAllNumeric = false
    }
  }

  // ── Header CantidadeNCFAnulados = Σ per-line totals ──────────────────────────
  const encabezado = (xml.match(/<Encabezado>[\s\S]*?<\/Encabezado>/) ?? [''])[0]
  const headerCantStr = getValue('CantidadeNCFAnulados', encabezado)
  if (headerCantStr !== null && /^\d+$/.test(headerCantStr) && lineTotalsAllNumeric && anulBlocks.length > 0) {
    const headerDeclared = parseInt(headerCantStr, 10)
    if (headerDeclared !== sumOfLineTotals) {
      push(orange('CantidadeNCFAnulados',
        `CantidadeNCFAnulados del Encabezado (${headerDeclared}) no coincide con la suma de las líneas de anulación (${sumOfLineTotals}).`,
        /<CantidadeNCFAnulados>/))
    }
  }

  // ── Signature presence — informational (pre-signing allowed) ─────────────────
  const signed =
    xml.includes('<ds:Signature') || xml.includes('<Signature ') ||
    xml.includes('<FirmaDigital') || xml.includes('<SignatureValue')
  if (!signed) {
    push({
      id: nextId(), severity: 'blue', field: 'Signature', line: null,
      message: 'No se detectó un bloque de firma digital. El archivo de anulación debe firmarse digitalmente antes de enviarse. (Informativo: puede ser un documento pre-firma.)',
    })
  }

  return issues
}