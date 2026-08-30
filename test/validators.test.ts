import { describe, it, expect } from 'vitest'
import { validateXml, hasIssue, loadFixture } from './helpers'

/**
 * Regression suite for the ECF validator.
 *
 * Each block locks in a rule that has burned us before or that recently changed.
 * Assertions target the SPECIFIC issue under test (by field + severity), not the
 * total issue count — so a fixture only needs to exercise its rule, it does not
 * have to be a globally valid invoice.
 */

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
