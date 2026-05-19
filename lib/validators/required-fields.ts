/**
 * Required field definitions per invoice type.
 *
 * Fields are composed from reusable building blocks. Each block maps to a
 * specific group of fields that are required (minOccurs="1") according to the
 * official DGII XSD schemas.
 *
 * Key findings from full XSD analysis:
 *  - TipoIngresos is ABSENT in E-41, E-43, E-47 (not required, not optional — not in schema)
 *  - TipoPago is optional (minOccurs=0) in E-41, E-43, E-47
 *  - FechaVencimientoSecuencia is absent in E-32 and E-34
 *  - E-33 requires FechaVencimientoSecuencia; E-34 does NOT
 *  - E-34 has a unique required field: IndicadorNotaCredito
 *  - E-41 requires RNCComprador + RazonSocialComprador; E-47 does NOT
 *  - E-41 and E-47 both require a Retencion block per item
 *  - E-47 Retencion is stricter: MontoISRRetenido is also required
 */

import type { InvoiceType, Severity } from '../types'

// ── Requirement descriptor ────────────────────────────────────────────────────

export interface FieldRequirement {
  field: string
  pattern: RegExp
  message: string
  severity: Severity
}

// ── Building blocks ───────────────────────────────────────────────────────────

/**
 * Fields that are truly universal — present and required in all 10 ECF types.
 * TipoIngresos, TipoPago, and FechaVencimientoSecuencia are NOT here
 * because they vary across types.
 */
const SHARED_ECF: FieldRequirement[] = [
  {
    field: 'Version',
    pattern: /<Version>/,
    severity: 'red',
    message: 'Version es obligatorio. El único valor válido es "1.0".',
  },
  {
    field: 'TipoeCF',
    pattern: /<TipoeCF>/,
    severity: 'red',
    message: 'TipoeCF es obligatorio. Debe contener el código del tipo de comprobante (31, 32, 33…).',
  },
  {
    field: 'eNCF',
    pattern: /<eNCF>/,
    severity: 'red',
    message: 'eNCF es obligatorio. Debe ser el número de comprobante fiscal electrónico de 13 caracteres.',
  },
  {
    field: 'RNCEmisor',
    pattern: /<RNCEmisor>/,
    severity: 'red',
    message: 'RNCEmisor es obligatorio. Debe ser el RNC registrado del emisor (9 u 11 dígitos).',
  },
  {
    field: 'RazonSocialEmisor',
    pattern: /<RazonSocialEmisor>/,
    severity: 'red',
    message: 'RazonSocialEmisor es obligatorio. Máximo 150 caracteres.',
  },
  {
    field: 'DireccionEmisor',
    pattern: /<DireccionEmisor>/,
    severity: 'red',
    message: 'DireccionEmisor es obligatorio. Máximo 100 caracteres.',
  },
  {
    field: 'FechaEmision',
    pattern: /<FechaEmision>/,
    severity: 'red',
    message: 'FechaEmision es obligatoria. Formato requerido: DD-MM-YYYY.',
  },
  {
    field: 'MontoTotal',
    pattern: /<MontoTotal>/,
    severity: 'red',
    message: 'MontoTotal es obligatorio en la sección Totales.',
  },
  {
    field: 'DetallesItems',
    pattern: /<DetallesItems>/,
    severity: 'red',
    message: 'La sección DetallesItems es obligatoria. Debe contener al menos un Item.',
  },
]

/** TipoIngresos + TipoPago — required for E-31/32/33/34/44/45/46. Absent in E-41/43/47. */
const WITH_TIPO_PAGO: FieldRequirement[] = [
  {
    field: 'TipoIngresos',
    pattern: /<TipoIngresos>/,
    severity: 'red',
    message: 'TipoIngresos es obligatorio. Valores válidos: 01–06 (con cero incluido).',
  },
  {
    field: 'TipoPago',
    pattern: /<TipoPago>/,
    severity: 'red',
    message: 'TipoPago es obligatorio. Valores válidos: 1 (contado), 2 (crédito), 3 (gratuito).',
  },
]

/** FechaVencimientoSecuencia — required for all types EXCEPT E-32 and E-34. */
const WITH_FECHA_VENCIMIENTO: FieldRequirement[] = [
  {
    field: 'FechaVencimientoSecuencia',
    pattern: /<FechaVencimientoSecuencia>/,
    severity: 'red',
    message: 'FechaVencimientoSecuencia es obligatoria para este tipo de e-CF. Formato: DD-MM-YYYY.',
  },
]

/** RNCComprador + RazonSocialComprador — required for E-31, E-41, E-45. */
const WITH_COMPRADOR_REQUIRED: FieldRequirement[] = [
  {
    field: 'RNCComprador',
    pattern: /<RNCComprador>/,
    severity: 'red',
    message: 'RNCComprador es obligatorio para este tipo de e-CF. El comprador debe ser un contribuyente con RNC registrado.',
  },
  {
    field: 'RazonSocialComprador',
    pattern: /<RazonSocialComprador>/,
    severity: 'red',
    message: 'RazonSocialComprador es obligatorio para este tipo de e-CF.',
  },
]

/**
 * RazonSocialComprador only — required for E-44 and E-46.
 * These types require the buyer name but NOT the RNC.
 */
const WITH_RAZON_SOCIAL_COMPRADOR: FieldRequirement[] = [
  {
    field: 'RazonSocialComprador',
    pattern: /<RazonSocialComprador>/,
    severity: 'red',
    message: 'RazonSocialComprador es obligatorio para este tipo de e-CF. El RNCComprador es opcional pero el nombre del comprador es requerido.',
  },
]

/**
 * InformacionReferencia block — required for E-33 and E-34.
 * NCFModificado, FechaNCFModificado, and CodigoModificacion are all
 * minOccurs="1" inside InformacionReferencia in both schemas.
 */
const WITH_INFORMACION_REFERENCIA: FieldRequirement[] = [
  {
    field: 'InformacionReferencia',
    pattern: /<InformacionReferencia>/,
    severity: 'red',
    message: 'InformacionReferencia es obligatoria para Notas de Débito (E-33) y Crédito (E-34). Debe referenciar el comprobante original que se está modificando.',
  },
  {
    field: 'NCFModificado',
    pattern: /<NCFModificado>/,
    severity: 'red',
    message: 'NCFModificado es obligatorio dentro de InformacionReferencia. Debe contener el eNCF/NCF del comprobante original (11–19 caracteres).',
  },
  {
    field: 'FechaNCFModificado',
    pattern: /<FechaNCFModificado>/,
    severity: 'red',
    message: 'FechaNCFModificado es obligatorio dentro de InformacionReferencia. Formato: DD-MM-YYYY.',
  },
  {
    field: 'CodigoModificacion',
    pattern: /<CodigoModificacion>/,
    severity: 'red',
    message: 'CodigoModificacion es obligatorio dentro de InformacionReferencia. Valores válidos: 1 (anula), 2 (corrige texto), 3 (corrige montos), 4 (reemplaza contingencia), 5 (referencia factura consumo).',
  },
]

/**
 * IndicadorNotaCredito — unique required field in E-34.
 * Value 0: fecha de emisión <= 30 días del original.
 * Value 1: fecha de emisión > 30 días del original.
 */
const WITH_INDICADOR_NOTA_CREDITO: FieldRequirement[] = [
  {
    field: 'IndicadorNotaCredito',
    pattern: /<IndicadorNotaCredito>/,
    severity: 'red',
    message: 'IndicadorNotaCredito es obligatorio y exclusivo del E-34 (Nota de Crédito). Valor 0: emisión dentro de 30 días del comprobante original. Valor 1: emisión después de 30 días.',
  },
]

/**
 * Retencion block — required per item in E-41 and E-47.
 * We check for presence anywhere in the document; per-item exhaustive
 * checking requires DOM parsing (future enhancement).
 */
const WITH_RETENCION: FieldRequirement[] = [
  {
    field: 'Retencion',
    pattern: /<Retencion>/,
    severity: 'red',
    message: 'Retencion es obligatorio en cada Item para este tipo de e-CF. Debe incluir al menos IndicadorAgenteRetencionoPercepcion.',
  },
  {
    field: 'IndicadorAgenteRetencionoPercepcion',
    pattern: /<IndicadorAgenteRetencionoPercepcion>/,
    severity: 'red',
    message: 'IndicadorAgenteRetencionoPercepcion es obligatorio dentro de Retencion. Valor 1: Retención. Valor 2: Percepción.',
  },
]

/**
 * E-47 stricter Retencion — MontoISRRetenido is also required per item.
 * Combined with WITH_RETENCION for E-47.
 */
const WITH_RETENCION_ISR_REQUIRED: FieldRequirement[] = [
  {
    field: 'MontoISRRetenido',
    pattern: /<MontoISRRetenido>/,
    severity: 'red',
    message: 'MontoISRRetenido es obligatorio dentro de Retencion para E-47 (Pagos al Exterior). A diferencia de E-41, el monto de retención ISR debe estar presente en cada ítem.',
  },
]

// ── RFCE required fields ──────────────────────────────────────────────────────

const RFCE_REQUIRED: FieldRequirement[] = [
  {
    field: 'TipoeCF',
    pattern: /<TipoeCF>/,
    severity: 'red',
    message: 'TipoeCF es obligatorio en el RFCE. El único valor válido es 32.',
  },
  {
    field: 'eNCF',
    pattern: /<eNCF>/,
    severity: 'red',
    message: 'eNCF es obligatorio en el RFCE. Debe coincidir con el eNCF de la factura de consumo original.',
  },
  {
    field: 'TipoIngresos',
    pattern: /<TipoIngresos>/,
    severity: 'red',
    message: 'TipoIngresos es obligatorio en el RFCE.',
  },
  {
    field: 'TipoPago',
    pattern: /<TipoPago>/,
    severity: 'red',
    message: 'TipoPago es obligatorio en el RFCE.',
  },
  {
    field: 'RNCEmisor',
    pattern: /<RNCEmisor>/,
    severity: 'red',
    message: 'RNCEmisor es obligatorio en el RFCE.',
  },
  {
    field: 'RazonSocialEmisor',
    pattern: /<RazonSocialEmisor>/,
    severity: 'red',
    message: 'RazonSocialEmisor es obligatorio en el RFCE.',
  },
  {
    field: 'FechaEmision',
    pattern: /<FechaEmision>/,
    severity: 'red',
    message: 'FechaEmision es obligatoria en el RFCE. Formato: DD-MM-YYYY.',
  },
  {
    field: 'MontoTotal',
    pattern: /<MontoTotal>/,
    severity: 'red',
    message: 'MontoTotal es obligatorio en el RFCE.',
  },
  {
    field: 'CodigoSeguridadeCF',
    pattern: /<CodigoSeguridadeCF>/,
    severity: 'red',
    message: 'CodigoSeguridadeCF es obligatorio y exclusivo del RFCE. Deben ser los primeros 6 caracteres de la firma digital de la factura de consumo original.',
  },
]

// ── Requirements map ──────────────────────────────────────────────────────────

export function getRequirements(invoiceType: InvoiceType): FieldRequirement[] {
  switch (invoiceType) {
    case 'E-31':
      return [...SHARED_ECF, ...WITH_TIPO_PAGO, ...WITH_FECHA_VENCIMIENTO, ...WITH_COMPRADOR_REQUIRED]

    case 'E-32':
      // No FechaVencimientoSecuencia, no RNCComprador required
      return [...SHARED_ECF, ...WITH_TIPO_PAGO]

    case 'E-33':
      // Requires FechaVencimientoSecuencia (like E-31), Comprador is optional
      return [...SHARED_ECF, ...WITH_TIPO_PAGO, ...WITH_FECHA_VENCIMIENTO, ...WITH_INFORMACION_REFERENCIA]

    case 'E-34':
      // No FechaVencimientoSecuencia, has unique IndicadorNotaCredito
      return [...SHARED_ECF, ...WITH_TIPO_PAGO, ...WITH_INDICADOR_NOTA_CREDITO, ...WITH_INFORMACION_REFERENCIA]

    case 'E-41':
      // No TipoIngresos in schema, TipoPago optional, RNCComprador required, Retencion per item
      return [...SHARED_ECF, ...WITH_FECHA_VENCIMIENTO, ...WITH_COMPRADOR_REQUIRED, ...WITH_RETENCION]

    case 'E-43':
      // No TipoIngresos, TipoPago optional, minimal structure
      return [...SHARED_ECF, ...WITH_FECHA_VENCIMIENTO]

    case 'E-44':
      // RazonSocialComprador required, RNCComprador optional
      return [...SHARED_ECF, ...WITH_TIPO_PAGO, ...WITH_FECHA_VENCIMIENTO, ...WITH_RAZON_SOCIAL_COMPRADOR]

    case 'E-45':
      // Both RNCComprador and RazonSocialComprador required
      return [...SHARED_ECF, ...WITH_TIPO_PAGO, ...WITH_FECHA_VENCIMIENTO, ...WITH_COMPRADOR_REQUIRED]

    case 'E-46':
      // RazonSocialComprador required, RNCComprador optional
      return [...SHARED_ECF, ...WITH_TIPO_PAGO, ...WITH_FECHA_VENCIMIENTO, ...WITH_RAZON_SOCIAL_COMPRADOR]

    case 'E-47':
      // No TipoIngresos, TipoPago optional, Comprador optional, stricter Retencion
      return [...SHARED_ECF, ...WITH_FECHA_VENCIMIENTO, ...WITH_RETENCION, ...WITH_RETENCION_ISR_REQUIRED]

    case 'E-32-R':
      return RFCE_REQUIRED

    default:
      return []
  }
}