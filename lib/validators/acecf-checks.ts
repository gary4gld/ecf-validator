/**
 * ACECF — Aprobación Comercial validator.
 *
 * The ACECF is the receiver's commercial approve/reject response to an e-CF. It is a
 * separate document (root <ACECF>) that shares no structure with an e-CF, so it runs on
 * its own path (see validate() in validator.ts) instead of the e-CF pipeline.
 *
 * Schema (ACECF_v_1_0.xsd) — DetalleAprobacionComercial:
 *   Version (1.0), RNCEmisor, eNCF, FechaEmision, MontoTotal, RNCComprador,
 *   Estado (1=Aceptado, 2=Rechazado), DetalleMotivoRechazo (opt),
 *   FechaHoraAprobacionComercial, Signature.
 *
 * Key rule (Formato Aprobación Comercial, field 8): DetalleMotivoRechazo is conditional on
 * Estado=2. Note: the XSD defines an EstadoRechazoType (0–4) that is NOT attached to any
 * element and is absent from the Formato — treated as vestigial, not validated.
 */

import type { ParsedXml, ValidationIssue, XmlLine } from '../types'
import { isValidRNC } from './format-checks'

let counter = 0
const nextId = () => `acecf-${++counter}`
export const resetAcecfCounter = () => { counter = 0 }

function getValue(field: string, xml: string): string | null {
  const m = xml.match(new RegExp(`<${field}[^>]*>([^<]*)</${field}>`))
  return m ? m[1].trim() : null
}
function findLine(pattern: RegExp, lines: XmlLine[]): number | null {
  const l = lines.find((ln) => pattern.test(ln.content))
  return l ? l.number : null
}
const VALID_ENCF_PREFIXES = ['E31','E32','E33','E34','E41','E43','E44','E45','E46','E47']

export function runAcecfChecks(parsed: ParsedXml): ValidationIssue[] {
  resetAcecfCounter()
  const { raw: xml, lines } = parsed
  const issues: ValidationIssue[] = []
  const push = (i: ValidationIssue | null) => { if (i) issues.push(i) }
  const red = (field: string, message: string, pat: RegExp): ValidationIssue =>
    ({ id: nextId(), severity: 'red', field, line: findLine(pat, lines), message })

  // ── Required fields (minOccurs=1) ────────────────────────────────────────────
  const REQUIRED: [string, string][] = [
    ['DetalleAprobacionComercial', 'La sección DetalleAprobacionComercial es obligatoria en el ACECF.'],
    ['Version',                    'Version es obligatoria en el ACECF.'],
    ['RNCEmisor',                  'RNCEmisor es obligatorio en el ACECF (RNC del emisor del e-CF aprobado/rechazado).'],
    ['eNCF',                       'eNCF es obligatorio en el ACECF (identifica el e-CF que se aprueba o rechaza).'],
    ['FechaEmision',               'FechaEmision es obligatoria en el ACECF.'],
    ['MontoTotal',                 'MontoTotal es obligatorio en el ACECF.'],
    ['RNCComprador',               'RNCComprador es obligatorio en el ACECF (RNC del receptor que emite la aprobación).'],
    ['Estado',                     'Estado es obligatorio en el ACECF (1=Aceptado, 2=Rechazado).'],
    ['FechaHoraAprobacionComercial', 'FechaHoraAprobacionComercial es obligatoria en el ACECF.'],
  ]
  for (const [field, msg] of REQUIRED) {
    if (!new RegExp(`<${field}[\\s>]`).test(xml)) {
      push(red(field, msg, new RegExp(`<${field}`)))
    }
  }

  // ── Version enum ─────────────────────────────────────────────────────────────
  const version = getValue('Version', xml)
  if (version !== null && version !== '1.0') {
    push(red('Version', `Version del ACECF inválida: "${version}". El único valor válido es 1.0.`, /<Version>/))
  }

  // ── Estado enum (1 | 2) ──────────────────────────────────────────────────────
  const estado = getValue('Estado', xml)
  if (estado !== null && estado !== '1' && estado !== '2') {
    push(red('Estado', `Estado inválido: "${estado}". Valores válidos: 1 (e-CF Aceptado), 2 (e-CF Rechazado).`, /<Estado>/))
  }

  // ── Conditional: DetalleMotivoRechazo ↔ Estado ───────────────────────────────
  const motivoPresent = /<DetalleMotivoRechazo[\s>]/.test(xml)
  if (estado === '2' && !motivoPresent) {
    push(red('DetalleMotivoRechazo',
      'DetalleMotivoRechazo es obligatorio cuando Estado = 2 (e-CF Rechazado). Debe indicarse el motivo del rechazo (máx. 250 caracteres).',
      /<Estado>/))
  }
  if (estado === '1' && motivoPresent) {
    push({
      id: nextId(), severity: 'yellow', field: 'DetalleMotivoRechazo',
      line: findLine(/<DetalleMotivoRechazo/, lines),
      message: 'DetalleMotivoRechazo no debería incluirse cuando Estado = 1 (e-CF Aceptado); solo aplica a rechazos (Estado = 2).',
    })
  }

  // ── RNC checksums ────────────────────────────────────────────────────────────
  for (const f of ['RNCEmisor', 'RNCComprador']) {
    const v = getValue(f, xml)
    if (v && /^[0-9]+$/.test(v) && !isValidRNC(v)) {
      push(red(f, `${f} (${v}) no supera la validación de dígito verificador (checksum RNC/Cédula).`, new RegExp(`<${f}>`)))
    } else if (v && !/^[0-9]{9}$|^[0-9]{11}$/.test(v)) {
      push(red(f, `${f} (${v}) debe tener 9 u 11 dígitos numéricos sin guiones ni espacios.`, new RegExp(`<${f}>`)))
    }
  }

  // ── eNCF format (13-char, valid E-prefix) ────────────────────────────────────
  const encf = getValue('eNCF', xml)
  if (encf) {
    if (!/^E\d{2}\d{10}$/.test(encf)) {
      push(red('eNCF', `eNCF (${encf}) tiene formato inválido. Debe ser E + tipo (2 dígitos) + 10 dígitos, p. ej. E310000000001.`, /<eNCF>/))
    } else if (!VALID_ENCF_PREFIXES.includes(encf.slice(0, 3))) {
      push(red('eNCF', `eNCF (${encf}) usa un prefijo de tipo inválido (${encf.slice(0, 3)}). Debe ser uno de E31–E47.`, /<eNCF>/))
    }
  }

  // ── MontoTotal: numeric, 2 decimals, ≥ 0 ─────────────────────────────────────
  const monto = getValue('MontoTotal', xml)
  if (monto !== null && !/^\d+(\.\d{1,2})?$/.test(monto)) {
    push(red('MontoTotal', `MontoTotal (${monto}) debe ser numérico con hasta 2 decimales, separador punto y sin separador de miles.`, /<MontoTotal>/))
  }

  // ── FechaEmision: DD-MM-YYYY ─────────────────────────────────────────────────
  const fEmi = getValue('FechaEmision', xml)
  if (fEmi !== null && !/^(3[01]|[12][0-9]|0[1-9])-(1[0-2]|0[1-9])-\d{4}$/.test(fEmi)) {
    push(red('FechaEmision', `FechaEmision (${fEmi}) debe tener formato DD-MM-YYYY.`, /<FechaEmision>/))
  }

  // ── FechaHoraAprobacionComercial: format + ≤ now (GMT-4) + ≥ FechaEmision ─────
  const fApr = getValue('FechaHoraAprobacionComercial', xml)
  if (fApr !== null) {
    const m = fApr.match(/^(\d{1,2})-(\d{1,2})-(\d{4}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/)
    if (!m) {
      push(red('FechaHoraAprobacionComercial',
        `FechaHoraAprobacionComercial (${fApr}) debe tener formato DD-MM-YYYY HH:mm:ss (GMT-4).`, /<FechaHoraAprobacionComercial>/))
    } else {
      // GMT-4 wall time → UTC instant (+4h); DR has no DST.
      const aprUtc = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 4, +m[5], +m[6])
      if (aprUtc - Date.now() > 5 * 60_000) {
        push(red('FechaHoraAprobacionComercial',
          `FechaHoraAprobacionComercial (${fApr}) está en el futuro respecto a la hora actual en GMT-4. La fecha y hora de aprobación no puede ser posterior a la hora actual.`,
          /<FechaHoraAprobacionComercial>/))
      }
      if (fEmi) {
        const em = fEmi.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
        if (em) {
          const emUtc = Date.UTC(+em[3], +em[2] - 1, +em[1])
          // approval must be on or after the referenced e-CF's emission day
          if (aprUtc < emUtc) {
            push(red('FechaHoraAprobacionComercial',
              `FechaHoraAprobacionComercial (${fApr}) es anterior a FechaEmision (${fEmi}) del e-CF. No se puede aprobar/rechazar un comprobante antes de su emisión.`,
              /<FechaHoraAprobacionComercial>/))
          }
        }
      }
    }
  }

  // ── Signature presence — informational (pre-signing is allowed) ──────────────
  const signed =
    xml.includes('<ds:Signature') || xml.includes('<Signature ') ||
    xml.includes('<FirmaDigital') || xml.includes('<SignatureValue')
  if (!signed) {
    push({
      id: nextId(), severity: 'blue', field: 'Signature',
      line: null,
      message: 'No se detectó un bloque de firma digital. Si este ACECF va a enviarse a DGII, debe estar firmado con un certificado digital válido. (Informativo: puede ser un documento pre-firma.)',
    })
  }

  return issues
}