import { readFileSync } from 'node:fs'
import path from 'node:path'

import { beautifyXml } from '@/lib/xml-beautifier'
import { detectInvoiceType, hasSignature } from '@/lib/xml-parser'
import { validate } from '@/lib/validators/validator'
import type { ParsedXml, ValidationIssue, XmlLine, Severity } from '@/lib/types'

/**
 * Build a ParsedXml exactly the way app/page.tsx does, so tests exercise the
 * real pipeline (beautify -> detect type -> line map -> validate).
 */
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

/** Convenience: parse + validate in one call, returns the issue list. */
export function validateXml(xml: string): ValidationIssue[] {
  return validate(buildParsed(xml))
}

export interface IssueQuery {
  /** Case-insensitive substring match on issue.field */
  field?: string
  severity?: Severity
  /** Case-insensitive substring match on issue.message */
  message?: string
}

export function findIssues(issues: ValidationIssue[], q: IssueQuery): ValidationIssue[] {
  return issues.filter(
    (i) =>
      (q.field === undefined || i.field.toLowerCase().includes(q.field.toLowerCase())) &&
      (q.severity === undefined || i.severity === q.severity) &&
      (q.message === undefined || i.message.toLowerCase().includes(q.message.toLowerCase())),
  )
}

export const hasIssue = (issues: ValidationIssue[], q: IssueQuery): boolean =>
  findIssues(issues, q).length > 0

/** Load a fixture XML file from test/fixtures/. Resolved from the project root
 *  (vitest's working directory) to stay robust under the jsdom environment. */
export function loadFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), 'test/fixtures', name), 'utf-8')
}
