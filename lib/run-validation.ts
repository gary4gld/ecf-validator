/**
 * Canonical "string in → issues out" pipeline, shared by the UI, the API route,
 * and the test suite so all three validate identically.
 *
 * Mirrors what app/page.tsx does: beautify → detect type → build the line map →
 * validate. Requires a DOM (browser, jsdom, or the server-dom shim) because the
 * beautifier and the sequence/item checks use DOMParser.
 */
import { beautifyXml } from './xml-beautifier'
import { detectInvoiceType, hasSignature } from './xml-parser'
import { validate } from './validators/validator'
import type { ParsedXml, ValidationIssue, XmlLine } from './types'

export function buildParsed(xml: string): ParsedXml {
  const beautified = beautifyXml(xml)
  const lines: XmlLine[] = beautified.split('\n').map((content, i) => ({
    number: i + 1,
    content,
    severity: null,
    issueId: null,
  }))

  return {
    raw: xml,
    beautified,
    lines,
    invoiceType: detectInvoiceType(xml),
    hasSignature: hasSignature(xml),
    issues: [],
  }
}

export function runValidation(xml: string): ValidationIssue[] {
  return validate(buildParsed(xml))
}
