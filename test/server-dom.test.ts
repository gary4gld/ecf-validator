// @vitest-environment node
//
// Runs in the Node environment (no window) — unlike the rest of the suite,
// which runs under jsdom. This proves the server-dom shim makes the FULL
// pipeline (beautifier + the DOM-based sequence/item checks) run on the Node
// runtime, i.e. the exact path the /api/v1/validate route takes in production.
import { describe, it, expect, beforeAll } from 'vitest'

import { ensureServerDom } from '@/lib/server/server-dom'
import { buildParsed } from '@/lib/run-validation'
import { validate } from '@/lib/validators/validator'
import { buildValidationResult } from '@/lib/validate-result'
import { loadFixture } from './helpers'

describe('server-dom shim (node environment)', () => {
  beforeAll(async () => {
    await ensureServerDom()
  })

  it('exposes the DOM globals the pipeline needs', () => {
    expect(typeof DOMParser).not.toBe('undefined')
    expect(typeof Node).not.toBe('undefined')
    expect((globalThis as { window?: { DOMParser?: unknown } }).window?.DOMParser).toBeTruthy()
  })

  it('runs the full validation pipeline on Node and matches the known type', () => {
    const parsed = buildParsed(loadFixture('e44-isc-014-prohibido.xml'))
    const res = buildValidationResult(parsed, validate(parsed))

    expect(res.invoiceType).toBe('E-44')
    // Would be empty if the DOM-dependent layers had silently skipped.
    expect(res.findings.length).toBeGreaterThan(0)
    // Beautifier ran via the DOM (multi-line output), not just raw passthrough.
    expect(parsed.lines.length).toBeGreaterThan(1)
  })
})
