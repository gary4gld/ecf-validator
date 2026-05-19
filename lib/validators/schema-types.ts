/**
 * Validation patterns and enumerations extracted directly from the official
 * DGII XSD schemas. Values here are the source of truth for format checks —
 * they come from the schema type definitions, not from guesswork.
 *
 * All 10 ECF schemas share the same type names and definitions. The RFCE
 * schema redefines them locally but with the same patterns/values.
 */

// ── Field patterns ─────────────────────────────────────────────────────────────
// Each regex mirrors the xs:pattern from the corresponding simpleType.

export const PATTERNS = {
  /** RNCValidationType: 9 or 11 digits. */
  RNC: /^([0-9]{9}|[0-9]{11})$/,

  /** eNCFValidationType: exactly 13 alphanumeric characters. */
  eNCF: /^[a-zA-Z0-9]{13}$/,

  /**
   * FechaValidationType: DD-MM-YYYY.
   * Note: NOT ISO 8601. Day first, then month, then 4-digit year (19xx or 20xx).
   */
  Fecha: /^(3[01]|[12][0-9]|0?[1-9])-(1[012]|0?[1-9])-((19|20)\d{2})$/,

  /**
   * DateTimeValidationType: DD-MM-YYYY HH:MM:SS.
   * Used for FechaHoraFirma.
   */
  DateTime:
    /^(3[01]|[12][0-9]|0[1-9])-(1[0-2]|0[1-9])-((19|20)\d{2}) (2[0-3]|[01]?\d):[0-5]\d:[0-5]\d$/,

  /**
   * TelefonoValidationType: exactly NNN-NNN-NNNN with hyphens (max 12 chars).
   * A common error is sending a raw number without the hyphen format.
   */
  Telefono: /^\d{3}-\d{3}-\d{4}$/,

  /**
   * CorreoValidationType: standard email format (max 80 chars enforced separately).
   */
  Email: /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*/,

  /**
   * CodigoSeguridadeCFType (RFCE only): exactly 6 characters, any content.
   * This is the first 6 characters of the ECF's digital signature.
   */
  CodigoSeguridad: /^.{6}$/,
} as const

// ── Field max lengths ──────────────────────────────────────────────────────────
// Derived from AlfNumXXXType definitions. Exceeding these lengths produces
// "Aceptado Condicional" — yellow severity.

export const MAX_LENGTHS: Record<string, number> = {
  // Emisor
  RazonSocialEmisor:          150,
  NombreComercial:            150,
  DireccionEmisor:            100,
  CorreoEmisor:                80,
  CodigoVendedor:              60,
  WebSite:                     50,
  Sucursal:                    20,
  ZonaVenta:                   20,
  RutaVenta:                   20,
  InformacionAdicionalEmisor: 250,
  NumeroFacturaInterna:        20,

  // Comprador
  RazonSocialComprador:       150,
  ContactoComprador:           80,
  DireccionComprador:         100,
  CorreoComprador:             80,

  // Item
  NombreItem:                  80,
  DescripcionItem:           1000,

  // Misc
  BancoPago:                   75,
  NumeroCuentaPago:            28,
}

// ── Enumerations ───────────────────────────────────────────────────────────────
// Valid values for coded fields. Using Set for O(1) membership checks.

export const ENUMS = {
  /** TipoIngresosValidationType */
  TipoIngresos: new Set(['01', '02', '03', '04', '05', '06']),

  /** TipoPagoType */
  TipoPago: new Set([1, 2, 3]),

  /** IndicadorFacturacionType */
  IndicadorFacturacion: new Set([0, 1, 2, 3, 4]),

  /** IndicadorBienoServicioType */
  IndicadorBienoServicio: new Set([1, 2]),

  /** FormaPagoType */
  FormaPago: new Set([1, 2, 3, 4, 5, 6, 7, 8]),

  /** IndicadorMontoGravadoType */
  IndicadorMontoGravado: new Set([0, 1]),

  /** TipoAjusteType (DescuentosORecargos) */
  TipoAjuste: new Set(['D', 'R']),

  /** TipoCuentaPagoType */
  TipoCuentaPago: new Set(['CT', 'AH', 'OT']),
} as const

// ── eNCF prefix mapping ────────────────────────────────────────────────────────
// Maps TipoeCF numeric value to the expected eNCF prefix.
// E.g. TipoeCF "31" → eNCF must start with "E31".

export const ENCF_PREFIXES: Record<string, string> = {
  '31': 'E31',
  '32': 'E32',
  '33': 'E33',
  '34': 'E34',
  '41': 'E41',
  '43': 'E43',
  '44': 'E44',
  '45': 'E45',
  '46': 'E46',
  '47': 'E47',
}

// ── E-32 summary threshold ─────────────────────────────────────────────────────

/** E-32 invoices below this amount require an RFCE summary submission. */
export const E32_RFCE_THRESHOLD = 250_000