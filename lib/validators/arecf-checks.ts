/**
 * ARECF — Acuse de Recibo validator.
 *
 * The ARECF is the receiver's *technical* acknowledgment that an e-CF was received — it does
 * NOT imply commercial acceptance or rejection (that's the ACECF). Separate document, root
 * <ARECF>, own schema (ARECF_v1_0.xsd), so it runs on its own path (see validate()).
 *
 * Schema — DetalleAcusedeRecibo:
 *   Version (1.0), RNCEmisor, RNCComprador, eNCF, Estado (0=Recibido, 1=No Recibido),
 *   CodigoMotivoNoRecibido (opt), FechaHoraAcuseRecibo, Signature.
 *
 * Key rule (Formato Acuse de Recibo, field 6): CodigoMotivoNoRecibido is conditional on
 * Estado=1 (No Recibido); valid codes 1–4. Note the Estado values differ from ACECF (0/1
 * here vs 1/2 there).
 */

import type { ParsedXml, ValidationIssue, XmlLine } from '../types'
import { isValidRNC } from './format-checks'

let counter = 0
const nextId = () => `arecf-${++counter}`
export const resetArecfCounter = () => { counter = 0 }

// Local getValue uses [^<]* (not the shared [^<]+) so an empty <Field></Field> returns ""
// rather than null — intentional, so empty required fields are flagged, not silently skipped.
function getValue(field: string, xml: string): string | null {
  const m = xml.match(new RegExp(`<${field}[^>]*>([^<]*)</${field}>`))
  return m ? m[1].trim() : null
}
function findLine(pattern: RegExp, lines: XmlLine[]): number | null {
  const l = lines.find((ln) => pattern.test(ln.content))
  return l ? l.number : null
}
const VALID_ENCF_PREFIXES = ['E31','E32','E33','E34','E41','E43','E44','E45','E46','E47']
const MOTIVO_LABELS: Record<string, string> = {
  '1': 'Error de Especificación',
  '2': 'Error de Firma Digital',
  '3': 'Envío Duplicado',
  '4': 'RNC Comprador no Corresponde',
}

export function runArecfChecks(parsed: ParsedXml): ValidationIssue[] {
  resetArecfCounter()
  const { raw: xml, lines } = parsed
  const issues: ValidationIssue[] = []
  const push = (i: ValidationIssue | null) => { if (i) issues.push(i) }
  const red = (field: string, message: string, pat: RegExp): ValidationIssue =>
    ({ id: nextId(), severity: 'red', field, line: findLine(pat, lines), message })

  // ── Required fields (minOccurs=1) ────────────────────────────────────────────
  const REQUIRED: [string, string][] = [
    ['DetalleAcusedeRecibo', 'La sección DetalleAcusedeRecibo es obligatoria en el ARECF.'],
    ['Version',              'Version es obligatoria en el ARECF.'],
    ['RNCEmisor',            'RNCEmisor es obligatorio en el ARECF (RNC del emisor del e-CF recibido).'],
    ['RNCComprador',         'RNCComprador es obligatorio en el ARECF (RNC del receptor que emite el acuse).'],
    ['eNCF',                 'eNCF es obligatorio en el ARECF (identifica el e-CF que se acusa).'],
    ['Estado',               'Estado es obligatorio en el ARECF (0=Recibido, 1=No Recibido).'],
    ['FechaHoraAcuseRecibo', 'FechaHoraAcuseRecibo es obligatoria en el ARECF.'],
  ]
  for (const [field, msg] of REQUIRED) {
    if (!new RegExp(`<${field}[\\s>]`).test(xml)) push(red(field, msg, new RegExp(`<${field}`)))
  }

  // ── Version enum ─────────────────────────────────────────────────────────────
  const version = getValue('Version', xml)
  if (version !== null && version !== '1.0') {
    push(red('Version', `Version del ARECF inválida: "${version}". El único valor válido es 1.0.`, /<Version>/))
  }

  // ── Estado enum (0 | 1) — note: differs from ACECF (1 | 2) ───────────────────
  const estado = getValue('Estado', xml)
  if (estado !== null && estado !== '0' && estado !== '1') {
    push(red('Estado', `Estado inválido: "${estado}". Valores válidos: 0 (e-CF Recibido), 1 (e-CF No Recibido).`, /<Estado>/))
  }

  // ── Conditional: CodigoMotivoNoRecibido ↔ Estado ─────────────────────────────
  const motivo = getValue('CodigoMotivoNoRecibido', xml)
  const motivoPresent = /<CodigoMotivoNoRecibido[\s>]/.test(xml)
  if (estado === '1' && !motivoPresent) {
    push(red('CodigoMotivoNoRecibido',
      'CodigoMotivoNoRecibido es obligatorio cuando Estado = 1 (e-CF No Recibido). Valores: 1 (Error de Especificación), 2 (Error de Firma Digital), 3 (Envío Duplicado), 4 (RNC Comprador no Corresponde).',
      /<Estado>/))
  }
  if (estado === '0' && motivoPresent) {
    push({
      id: nextId(), severity: 'yellow', field: 'CodigoMotivoNoRecibido',
      line: findLine(/<CodigoMotivoNoRecibido/, lines),
      message: 'CodigoMotivoNoRecibido no debería incluirse cuando Estado = 0 (e-CF Recibido); solo aplica a No Recibido (Estado = 1).',
    })
  }
  // Enum for the motivo code when present
  if (motivo !== null && motivo !== '' && !MOTIVO_LABELS[motivo]) {
    push(red('CodigoMotivoNoRecibido',
      `CodigoMotivoNoRecibido inválido: "${motivo}". Valores válidos: 1–4 (Error de Especificación, Error de Firma Digital, Envío Duplicado, RNC Comprador no Corresponde).`,
      /<CodigoMotivoNoRecibido>/))
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

  // ── FechaHoraAcuseRecibo: format + ≤ now (GMT-4) ─────────────────────────────
  const fAcuse = getValue('FechaHoraAcuseRecibo', xml)
  if (fAcuse !== null) {
    const m = fAcuse.match(/^(\d{1,2})-(\d{1,2})-(\d{4}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/)
    if (!m) {
      push(red('FechaHoraAcuseRecibo',
        `FechaHoraAcuseRecibo (${fAcuse}) debe tener formato DD-MM-YYYY HH:mm:ss (GMT-4).`, /<FechaHoraAcuseRecibo>/))
    } else {
      const acuseUtc = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 4, +m[5], +m[6])  // GMT-4 → UTC
      if (acuseUtc - Date.now() > 5 * 60_000) {
        push(red('FechaHoraAcuseRecibo',
          `FechaHoraAcuseRecibo (${fAcuse}) está en el futuro respecto a la hora actual en GMT-4. La fecha y hora del acuse no puede ser posterior a la hora actual.`,
          /<FechaHoraAcuseRecibo>/))
      }
    }
  }

  // ── Signature presence — informational (pre-signing is allowed) ──────────────
  const signed =
    xml.includes('<ds:Signature') || xml.includes('<Signature ') ||
    xml.includes('<FirmaDigital') || xml.includes('<SignatureValue')
  if (!signed) {
    push({
      id: nextId(), severity: 'blue', field: 'Signature', line: null,
      message: 'No se detectó un bloque de firma digital. Si este ARECF va a enviarse, debe estar firmado con un certificado digital válido. (Informativo: puede ser un documento pre-firma.)',
    })
  }

  return issues
}