/**
 * ISC Específico rate lookup table — lib/validators/isc-rates.ts
 *
 * Source: Dirección General de Impuestos Internos (DGII)
 * Resolution series: DDG-AR1-YYYY-NNNNN (quarterly)
 * Published at: https://dgii.gov.do/legislacion/resoluciones/
 *
 * MAINTAINING THIS FILE
 * ─────────────────────
 * DGII publishes a new quarterly resolution every ~3 months. The resolution
 * number follows a predictable pattern:
 *
 *   Period          Resolution
 *   Jan–Mar YYYY    DDG-AR1-{YYYY-1}-00008   (published in Dec of prior year)
 *   Apr–Jun YYYY    DDG-AR1-YYYY-00002        (published in Mar)
 *   Jul–Sep YYYY    DDG-AR1-YYYY-00004        (published in Jun)
 *   Oct–Dec YYYY    DDG-AR1-YYYY-00006        (published in Sep)
 *
 * To add a new quarter:
 *   1. Download the PDF from https://dgii.gov.do/legislacion/resoluciones/
 *   2. Copy the alcohol and cigarette rates from the tables
 *   3. Add a new entry to ISC_RATES_TABLE following the existing format
 *   4. Mark the previous entry's "current" comment if applicable
 *
 * RATE STRUCTURE
 * ──────────────
 * alcohol    RD$ per liter of absolute alcohol — applies to ALL beverage
 *            alcohol types (beer, wine, rum, whisky, vodka, gin, etc.)
 *            regardless of e-CF TipoImpuesto code within the 006–022 range.
 *            One rate per quarter for all alcoholic beverages.
 *
 * cig20      RD$ per cajetilla of 20 cigarette units (tabaco negro/rubio/demás)
 * cig10      RD$ per cajetilla of 10 cigarette units
 *
 * null       Rate not yet confirmed from official source — skip validation,
 *            show a blue informational note to the user.
 */

export interface ISCPeriodRates {
  resolution: string        // DGII resolution number (for audit trail)
  alcohol:    number | null // RD$/L absolute alcohol — null = not confirmed
  cig20:      number | null // RD$/cajetilla 20 units — null = not confirmed
  cig10:      number | null // RD$/cajetilla 10 units — null = not confirmed
}

/**
 * Historical ISC specific rates by calendar quarter.
 * All confirmed values sourced directly from official DGII PDF resolutions.
 * null values are missing — validation is skipped for those fields/periods.
 *
 * Update instructions above. Contact AlcoholesyTabacos@dgii.gov.do for
 * queries about specific periods.
 */
export const ISC_RATES_TABLE: Record<string, ISCPeriodRates> = {
  // ── 2023 ───────────────────────────────────────────────────────────────────
  '2023-Q1': { resolution: 'DDG-AR1-2022-00008', alcohol: 705.64, cig20:  59.69, cig10: 29.84 },
  '2023-Q2': { resolution: 'DDG-AR1-2023-00002', alcohol: 710.88, cig20:  60.13, cig10: 30.07 },
  '2023-Q3': { resolution: 'DDG-AR1-2023-00004', alcohol: 711.21, cig20:  60.16, cig10: 30.08 },
  '2023-Q4': { resolution: 'DDG-AR1-2023-00006', alcohol:   null, cig20:   null, cig10:  null }, // scanned image PDF — fetch manually

  // ── 2024 ───────────────────────────────────────────────────────────────────
  '2024-Q1': { resolution: 'DDG-AR1-2023-00008', alcohol: 720.66, cig20:  60.96, cig10: 30.48 },
  '2024-Q2': { resolution: 'DDG-AR1-2024-00002', alcohol:   null, cig20:   null, cig10:  null }, // scanned image PDF — fetch manually
  '2024-Q3': { resolution: 'DDG-AR1-2024-00004', alcohol: 723.13, cig20:  61.17, cig10: 30.58 },
  '2024-Q4': { resolution: 'DDG-AR1-2024-00006', alcohol: 729.89, cig20:  61.74, cig10: 30.87 },

  // ── 2025 ───────────────────────────────────────────────────────────────────
  '2025-Q1': { resolution: 'DDG-AR1-2024-00008', alcohol: 731.71, cig20:  61.89, cig10: 30.95 },
  '2025-Q2': { resolution: 'DDG-AR1-2025-00002', alcohol: 736.77, cig20:  62.32, cig10: 31.16 },
  '2025-Q3': { resolution: 'DDG-AR1-2025-00004', alcohol: 737.57, cig20:  62.39, cig10: 31.20 },
  '2025-Q4': { resolution: 'DDG-AR1-2025-00006', alcohol: 745.60, cig20:  63.07, cig10: 31.53 },

  // ── 2026 ───────────────────────────────────────────────────────────────────
  '2026-Q1': { resolution: 'DDG-AR1-2025-00008', alcohol:   null, cig20:  63.87, cig10: 31.94 }, // alcohol: fetch DDG-AR1-2025-00008 PDF
  '2026-Q2': { resolution: 'DDG-AR1-2026-00002', alcohol: 758.26, cig20:  64.14, cig10: 32.07 },
}

// ── Period resolution ──────────────────────────────────────────────────────

/**
 * Derive the ISC period key (e.g. "2025-Q3") from a FechaEmision string.
 *
 * FechaEmision format: DD-MM-YYYY
 * Quarter mapping:
 *   Jan–Mar → Q1 | Apr–Jun → Q2 | Jul–Sep → Q3 | Oct–Dec → Q4
 *
 * Returns null if the date string is malformed.
 */
export function getISCPeriodKey(fechaEmision: string): string | null {
  const m = fechaEmision.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (!m) return null
  const month   = parseInt(m[2], 10)
  const year    = parseInt(m[3], 10)
  if (month < 1 || month > 12 || year < 2020) return null
  const quarter = Math.ceil(month / 3)
  return `${year}-Q${quarter}`
}

/**
 * Look up the rates for the period containing the given FechaEmision.
 * Returns null if the date is malformed or the period is not in the table.
 */
export function getISCRatesForDate(fechaEmision: string): {
  key: string
  rates: ISCPeriodRates
} | null {
  const key = getISCPeriodKey(fechaEmision)
  if (!key) return null
  const rates = ISC_RATES_TABLE[key]
  if (!rates) return null
  return { key, rates }
}

// ── TasaImpuestoAdicional validator ────────────────────────────────────────

/**
 * Tolerance for TasaImpuestoAdicional comparison (RD$).
 * Rates in the resolutions have 2 decimal places; rounding in the ERP
 * or invoice system may introduce minor differences.
 */
const RATE_TOLERANCE = 0.02

/**
 * ISC específico codes (006–022) — all beverage alcohol types in the
 * ImpuestosAdicionalesType XSD enum. These all share a single quarterly
 * rate per liter of absolute alcohol published by DGII.
 *
 * Note: the exact mapping between TipoImpuesto codes and product categories
 * (alcohol vs. cigarettes) is determined by the complete ImpuestosAdicionalesType
 * XSD enum. Codes 006–022 are confirmed as alcohol types from the RFCE 32 XSD.
 * Cigarette codes (if any) within this range would use cig20/cig10 rates instead.
 * Until the complete mapping is verified, alcohol rate is applied to 006–022.
 */
export const ISC_ALCOHOL_CODES = new Set<string>(
  Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(3, '0'))  // 006–022
)

/** All valid TipoImpuesto codes (001–039) from ImpuestosAdicionalesType XSD enum. */
export const VALID_ISC_CODES = new Set<string>(
  Array.from({ length: 39 }, (_, i) => String(i + 1).padStart(3, '0'))  // 001–039
)

export type ISCRateValidationResult =
  | { status: 'valid' }
  | { status: 'mismatch'; declared: number; expected: number; resolution: string }
  | { status: 'unconfirmed'; key: string; resolution: string }
  | { status: 'period_unknown'; key: string }
  | { status: 'skip' }  // code not in validation scope

/**
 * Validate a declared TasaImpuestoAdicional against the DGII quarterly rate.
 *
 * @param tipoImpuesto  e-CF TipoImpuesto code (e.g. "006")
 * @param tasaDeclared  Numeric value from <TasaImpuestoAdicional> field
 * @param fechaEmision  Invoice emission date (DD-MM-YYYY)
 */
export function validateTasaISC(
  tipoImpuesto: string,
  tasaDeclared: number,
  fechaEmision: string
): ISCRateValidationResult {
  if (!ISC_ALCOHOL_CODES.has(tipoImpuesto)) return { status: 'skip' }

  const key = getISCPeriodKey(fechaEmision)
  if (!key) return { status: 'skip' }

  const entry = ISC_RATES_TABLE[key]
  if (!entry) return { status: 'period_unknown', key }

  const expectedRate = entry.alcohol
  if (expectedRate === null) {
    return { status: 'unconfirmed', key, resolution: entry.resolution }
  }

  if (Math.abs(tasaDeclared - expectedRate) > RATE_TOLERANCE) {
    return {
      status:     'mismatch',
      declared:   tasaDeclared,
      expected:   expectedRate,
      resolution: entry.resolution,
    }
  }

  return { status: 'valid' }
}