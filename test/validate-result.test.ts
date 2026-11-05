import { describe, it, expect } from 'vitest'

import { buildParsed } from '@/lib/run-validation'
import { validate } from '@/lib/validators/validator'
import {
  buildValidationResult,
  SCHEMA_VERSION,
  type ApiSeverity,
} from '@/lib/validate-result'
import type { ParsedXml, ValidationIssue } from '@/lib/types'
import { loadFixture } from './helpers'

const API_SEVERITIES: ApiSeverity[] = ['error', 'discrepancy', 'warning', 'info', 'advisory']

/** Minimal ParsedXml for mapping tests that don't need a real parse. */
function stubParsed(overrides: Partial<ParsedXml> = {}): ParsedXml {
  return {
    raw: '',
    beautified: '',
    lines: [],
    invoiceType: 'E-31',
    hasSignature: false,
    issues: [],
    ...overrides,
  }
}

describe('buildValidationResult', () => {
  it('produces the frozen v1 shape from a real validation run', () => {
    const parsed = buildParsed(loadFixture('e44-isc-014-prohibido.xml'))
    const res = buildValidationResult(parsed, validate(parsed))

    expect(res.schemaVersion).toBe(SCHEMA_VERSION)
    expect(typeof res.valid).toBe('boolean')
    expect(res.invoiceType).not.toBeNull()
    expect(typeof res.hasSignature).toBe('boolean')

    // counts cover exactly the five public severities and sum to findings.length
    expect(Object.keys(res.counts).sort()).toEqual([...API_SEVERITIES].sort())
    const sum = API_SEVERITIES.reduce((n, s) => n + res.counts[s], 0)
    expect(sum).toBe(res.findings.length)

    // findings never leak internal colour names
    for (const f of res.findings) expect(API_SEVERITIES).toContain(f.severity)
  })

  it('maps internal colour severities to public labels', () => {
    const issues: ValidationIssue[] = [
      { id: '1', severity: 'red', field: 'A', line: 1, message: 'x' },
      { id: '2', severity: 'orange', field: 'B', line: null, message: 'y' },
      { id: '3', severity: 'yellow', field: 'C', line: 3, message: 'z' },
      { id: '4', severity: 'blue', field: 'D', line: 4, message: 'w' },
      { id: '5', severity: 'advisory', field: 'E', line: 5, message: 'v' },
    ]
    const res = buildValidationResult(stubParsed(), issues)

    expect(res.findings.map((f) => f.severity)).toEqual([
      'error',
      'discrepancy',
      'warning',
      'info',
      'advisory',
    ])
    expect(res.counts).toEqual({ error: 1, discrepancy: 1, warning: 1, info: 1, advisory: 1 })
  })

  it('valid is false with any error or discrepancy, true otherwise', () => {
    expect(
      buildValidationResult(stubParsed(), [
        { id: '1', severity: 'red', field: 'A', line: 1, message: 'x' },
      ]).valid,
    ).toBe(false)

    expect(
      buildValidationResult(stubParsed(), [
        { id: '1', severity: 'orange', field: 'A', line: 1, message: 'x' },
      ]).valid,
    ).toBe(false)

    expect(
      buildValidationResult(stubParsed(), [
        { id: '1', severity: 'yellow', field: 'A', line: 1, message: 'x' },
        { id: '2', severity: 'advisory', field: 'B', line: null, message: 'y' },
      ]).valid,
    ).toBe(true)

    expect(buildValidationResult(stubParsed(), []).valid).toBe(true)
  })

  it('reports invoiceType null for an unknown document', () => {
    const res = buildValidationResult(stubParsed({ invoiceType: 'unknown' }), [])
    expect(res.invoiceType).toBeNull()
  })
})
