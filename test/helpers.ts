import { readFileSync } from 'node:fs'
import path from 'node:path'

import { buildParsed, runValidation } from '@/lib/run-validation'
import type { ValidationIssue, Severity } from '@/lib/types'

// Re-exported from the shared pipeline so tests, the UI, and the API route all
// build ParsedXml the same way (no drift).
export { buildParsed }

/** Convenience: parse + validate in one call, returns the issue list. */
export function validateXml(xml: string): ValidationIssue[] {
  return runValidation(xml)
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
