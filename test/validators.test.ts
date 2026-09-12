import { describe, it, expect } from 'vitest'
import { validateXml, hasIssue, loadFixture } from './helpers'
import { isValidRNC } from '@/lib/validators/format-checks'

/**
 * Regression suite for the ECF validator.
 *
 * Each block locks in a rule that has burned us before or that recently changed.
 * Assertions target the SPECIFIC issue under test (by field + severity), not the
 * total issue count — so a fixture only needs to exercise its rule, it does not
 * have to be a globally valid invoice.
 */

describe('RNC / cédula checksum (isValidRNC) — VALIDATION_LIMITATIONS #25', () => {
  it('accepts a valid 9-digit RNC (known-good checksum)', () => {
    expect(isValidRNC('131880681')).toBe(true)
  })
  it('rejects a 9-digit RNC with a broken checksum', () => {
    expect(isValidRNC('131880682')).toBe(false)
  })
  it('accepts a Luhn-valid 11-digit cédula', () => {
    expect(isValidRNC('00102030400')).toBe(true)
  })
  it('rejects an 11-digit cédula with a broken Luhn check digit', () => {
    expect(isValidRNC('00102030401')).toBe(false)
  })
})

describe('RFCE forbidden fields (E-32-R has no items/signature/etc.)', () => {
  it('flags a DetallesItems section inside an RFCE (red)', () => {
    const issues = validateXml(loadFixture('rfce-detallesitems-prohibido.xml'))
    expect(hasIssue(issues, { field: 'DetallesItems', severity: 'red' })).toBe(true)
  })
})

describe('TablaSubcantidad — Subcantidad ≤ CantidadItem (#19)', () => {
  it('flags a Subcantidad greater than CantidadItem (yellow)', () => {
    const issues = validateXml(loadFixture('e31-subcantidad-excede.xml'))
    expect(hasIssue(issues, { field: 'Subcantidad', severity: 'yellow' })).toBe(true)
  })
})

describe('E-33/E-34 stale reference note (#24)', () => {
  it('notes a FechaNCFModificado more than a year before FechaEmision (blue)', () => {
    const issues = validateXml(loadFixture('e34-referencia-antigua.xml'))
    expect(hasIssue(issues, { field: 'FechaNCFModificado', severity: 'blue' })).toBe(true)
  })
})

describe('IndicadorNotaCredito enum (E-34) — guards the {0,1} vs {1,2} regression', () => {
  // If someone ever flips the enum back to {1,2}, BOTH of these go red:
  //   value 0 would wrongly become invalid, value 2 would wrongly become valid.
  it('accepts value 0 (≤30 days) with no red enum error', () => {
    const issues = validateXml(loadFixture('e34-notacredito-valid0.xml'))
    expect(hasIssue(issues, { field: 'IndicadorNotaCredito', severity: 'red' })).toBe(false)
  })

  it('rejects value 2 (outside {0,1}) with a red enum error', () => {
    const issues = validateXml(loadFixture('e34-notacredito-invalid2.xml'))
    expect(hasIssue(issues, { field: 'IndicadorNotaCredito', severity: 'red' })).toBe(true)
  })
})

describe('TipoMoneda enum — guards the 17-code / COP addition', () => {
  it('accepts COP (Peso Colombiano)', () => {
    const issues = validateXml(loadFixture('e31-moneda-cop.xml'))
    expect(hasIssue(issues, { field: 'TipoMoneda', severity: 'red' })).toBe(false)
  })

  it('rejects an unknown currency code', () => {
    const issues = validateXml(loadFixture('e31-moneda-invalid.xml'))
    expect(hasIssue(issues, { field: 'TipoMoneda', severity: 'red' })).toBe(true)
  })
})

describe('FechaHoraFirma ≤ ahora — Formato sección G, validación b', () => {
  it('accepts a past signing timestamp', () => {
    const issues = validateXml(loadFixture('e31-firma-pasada.xml'))
    expect(hasIssue(issues, { field: 'FechaHoraFirma', message: 'en el futuro' })).toBe(false)
  })

  it('rejects a signing timestamp in the future', () => {
    const issues = validateXml(loadFixture('e31-firma-futura.xml'))
    expect(hasIssue(issues, { field: 'FechaHoraFirma', severity: 'red', message: 'en el futuro' })).toBe(true)
  })

  // The ERPNext pipeline's known risk: a server on UTC writes UTC wall time into a
  // field DGII reads as GMT-4, putting the timestamp ~4h in the future.
  it('flags a UTC timestamp written into the GMT-4 field, with a targeted hint', () => {
    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const utcWallClock =
      `${p(now.getUTCDate())}-${p(now.getUTCMonth() + 1)}-${now.getUTCFullYear()} ` +
      `${p(now.getUTCHours())}:${p(now.getUTCMinutes())}:${p(now.getUTCSeconds())}`

    const xml = loadFixture('e31-firma-pasada.xml').replace(
      /<FechaHoraFirma>[^<]+<\/FechaHoraFirma>/,
      `<FechaHoraFirma>${utcWallClock}</FechaHoraFirma>`,
    )

    const issues = validateXml(xml)
    expect(hasIssue(issues, { field: 'FechaHoraFirma', severity: 'red' })).toBe(true)
    expect(hasIssue(issues, { field: 'FechaHoraFirma', message: '~4 horas' })).toBe(true)
  })
})

describe('ISC header gaps — Totales > ImpuestosAdicionales type-awareness', () => {
  it('accepts E-44 with a services-ISC code (004 Telecom, in 001–005)', () => {
    const issues = validateXml(loadFixture('e44-isc-004-valido.xml'))
    expect(hasIssue(issues, { field: 'TipoImpuesto', severity: 'red' })).toBe(false)
  })

  it('rejects E-44 with a product-ISC code (014 Ron, in 006–039)', () => {
    const issues = validateXml(loadFixture('e44-isc-014-prohibido.xml'))
    expect(hasIssue(issues, { field: 'TipoImpuesto', severity: 'red', message: 'E-44' })).toBe(true)
  })

  it('rejects E-44 carrying MontoImpuestoSelectivoConsumoEspecifico (campo 107, obligación 0)', () => {
    const issues = validateXml(loadFixture('e44-isc-especifico-prohibido.xml'))
    expect(hasIssue(issues, { field: 'MontoImpuestoSelectivoConsumoEspecifico', severity: 'red' })).toBe(true)
  })

  it('rejects the whole ImpuestosAdicionales section in E-46 (obligation 0)', () => {
    const issues = validateXml(loadFixture('e46-isc-prohibido.xml'))
    expect(hasIssue(issues, { field: 'ImpuestosAdicionales', severity: 'red', message: 'no está permitida' })).toBe(true)
  })
})

describe('NumeroCuentaPago format advisory (XSD permits any string 1–28)', () => {
  it('does not flag a purely numeric account number', () => {
    const issues = validateXml(loadFixture('e31-cuenta-numerica.xml'))
    expect(hasIssue(issues, { field: 'NumeroCuentaPago' })).toBe(false)
  })

  it('raises a blue advisory when the account number contains hyphens', () => {
    const issues = validateXml(loadFixture('e31-cuenta-guiones.xml'))
    expect(hasIssue(issues, { field: 'NumeroCuentaPago', severity: 'blue' })).toBe(true)
    // it is advisory only — never red (the schema allows non-digits)
    expect(hasIssue(issues, { field: 'NumeroCuentaPago', severity: 'red' })).toBe(false)
  })
})

describe('FechaEmision reasonableness (VALIDATION_LIMITATIONS #22)', () => {
  it('does not flag a recent FechaEmision', () => {
    const issues = validateXml(loadFixture('e31-cuenta-numerica.xml'))
    expect(hasIssue(issues, { field: 'FechaEmision', message: 'futura' })).toBe(false)
  })

  it('flags a future FechaEmision (yellow)', () => {
    const issues = validateXml(loadFixture('e31-fecha-futura.xml'))
    expect(hasIssue(issues, { field: 'FechaEmision', severity: 'yellow', message: 'futura' })).toBe(true)
  })

  it('notes a FechaEmision more than a year in the past (blue)', () => {
    const issues = validateXml(loadFixture('e31-fecha-vieja.xml'))
    expect(hasIssue(issues, { field: 'FechaEmision', severity: 'blue' })).toBe(true)
  })
})

describe('DocumentoTransporte numeric-only (Integer20 XSD type)', () => {
  it('accepts a purely numeric DocumentoTransporte', () => {
    const issues = validateXml(loadFixture('e31-doctransporte-numerico.xml'))
    expect(hasIssue(issues, { field: 'DocumentoTransporte' })).toBe(false)
  })

  it('rejects a non-numeric DocumentoTransporte (red)', () => {
    const issues = validateXml(loadFixture('e31-doctransporte-invalido.xml'))
    expect(hasIssue(issues, { field: 'DocumentoTransporte', severity: 'red' })).toBe(true)
  })
})

describe('PrecioOtraMoneda unit-price cross-rate', () => {
  it('accepts a consistent PrecioOtraMoneda (× TipoCambio ≈ PrecioUnitarioItem)', () => {
    const issues = validateXml(loadFixture('e31-preciootramoneda-ok.xml'))
    expect(hasIssue(issues, { field: 'PrecioOtraMoneda' })).toBe(false)
  })

  it('flags a PrecioOtraMoneda that does not convert to PrecioUnitarioItem (orange)', () => {
    const issues = validateXml(loadFixture('e31-preciootramoneda-mal.xml'))
    expect(hasIssue(issues, { field: 'PrecioOtraMoneda', severity: 'orange' })).toBe(true)
  })
})

describe('TipoIngresos requiredness — guards the E-33/E-34 optional split (Apr-2026 XSD)', () => {
  it('does NOT flag E-34 missing TipoIngresos (now optional)', () => {
    const issues = validateXml(loadFixture('e34-sin-tipoingresos.xml'))
    expect(hasIssue(issues, { field: 'TipoIngresos', message: 'obligatorio' })).toBe(false)
  })

  it('DOES flag E-31 missing TipoIngresos (still required)', () => {
    const issues = validateXml(loadFixture('e31-sin-tipoingresos.xml'))
    expect(hasIssue(issues, { field: 'TipoIngresos', message: 'obligatorio' })).toBe(true)
  })
})