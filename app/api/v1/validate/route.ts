/**
 * POST /api/v1/validate — programmatic e-CF XML validation.
 *
 * Body: raw e-CF XML, Content-Type application/xml (or text/xml).
 * Returns the same findings the UI produces, as JSON (see lib/validate-result).
 *
 * Contract
 *   200 — XML processed; findings in the body (an invoice WITH errors is still 200)
 *   400 — malformed XML, empty body, or a forbidden DOCTYPE/ENTITY (XXE guard)
 *   405 — method other than POST/OPTIONS (Allow header set)
 *   413 — body over the size cap
 *   415 — wrong/missing Content-Type
 *   429 — rate limited (Retry-After + X-RateLimit-* headers)
 *   500 — unexpected failure
 *
 * Security: rejects any DOCTYPE/ENTITY before parsing (blocks XXE and entity
 * expansion), caps the body size, and never persists or logs invoice content —
 * only request metadata. Open CORS so it's callable from anywhere.
 *
 * v1 is deterministic and offline: it does not perform the DGII RNC registry
 * lookup. (A future opt-in flag will add it.)
 */
import { NextRequest, NextResponse } from 'next/server'
import { ensureServerDom } from '@/lib/server/server-dom'
import { rateLimit, RATE_LIMIT_MAX } from '@/lib/server/rate-limit'
import { buildParsed } from '@/lib/run-validation'
import { validate } from '@/lib/validators/validator'
import { buildValidationResult } from '@/lib/validate-result'

export const runtime = 'nodejs' // jsdom needs Node APIs
export const dynamic = 'force-dynamic'
export const maxDuration = 15 // backstop; a synchronous parse can't be interrupted mid-run

/** Max request body, well under Vercel's platform limit (~4.5 MB). */
const MAX_BYTES = 2_000_000

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, { status, headers: { ...CORS, ...extraHeaders } })
}

function clientKey(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for') ?? ''
  return fwd.split(',')[0].trim() || 'unknown'
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(): Promise<NextResponse> {
  return jsonResponse(
    { error: 'method_not_allowed', message: 'Use POST with an application/xml body.' },
    405,
    { Allow: 'POST, OPTIONS' },
  )
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1) Rate limit (interim in-memory; see lib/server/rate-limit).
  const rl = rateLimit(clientKey(request))
  const rlHeaders: Record<string, string> = {
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
    'X-RateLimit-Remaining': String(rl.remaining),
  }
  if (rl.limited) {
    return jsonResponse(
      {
        error: 'rate_limited',
        message: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.`,
        retryAfterSeconds: rl.retryAfterSeconds,
      },
      429,
      { ...rlHeaders, 'Retry-After': String(rl.retryAfterSeconds) },
    )
  }

  // 2) Content-Type must be XML.
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.includes('application/xml') && !contentType.includes('text/xml')) {
    return jsonResponse(
      {
        error: 'unsupported_media_type',
        message: 'Content-Type must be application/xml or text/xml.',
      },
      415,
      rlHeaders,
    )
  }

  // 3) Size cap — fast reject on Content-Length, then enforce on actual bytes.
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (declaredLength && declaredLength > MAX_BYTES) {
    return jsonResponse(
      { error: 'payload_too_large', message: `Body exceeds ${MAX_BYTES} bytes.`, maxBytes: MAX_BYTES },
      413,
      rlHeaders,
    )
  }

  const bytes = Buffer.from(await request.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) {
    return jsonResponse(
      { error: 'payload_too_large', message: `Body exceeds ${MAX_BYTES} bytes.`, maxBytes: MAX_BYTES },
      413,
      rlHeaders,
    )
  }

  const xml = bytes.toString('utf-8')
  if (!xml.trim()) {
    return jsonResponse({ error: 'empty_body', message: 'Request body is empty.' }, 400, rlHeaders)
  }

  // 4) XXE guard — reject any DOCTYPE/ENTITY before the parser ever sees it.
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    return jsonResponse(
      {
        error: 'doctype_forbidden',
        message: 'DOCTYPE and ENTITY declarations are not allowed.',
      },
      400,
      rlHeaders,
    )
  }

  // 5) Parse + validate under the server DOM, exactly as the UI does.
  try {
    await ensureServerDom()

    const probe = new DOMParser().parseFromString(xml, 'application/xml')
    if (!probe.documentElement || probe.getElementsByTagName('parsererror').length > 0) {
      return jsonResponse(
        { error: 'malformed_xml', message: 'The XML is not well-formed.' },
        400,
        rlHeaders,
      )
    }

    const parsed = buildParsed(xml)
    const issues = validate(parsed)
    const result = buildValidationResult(parsed, issues)

    // Privacy-safe log: metadata only, never the XML body.
    console.log(
      JSON.stringify({
        at: 'api/v1/validate',
        status: 200,
        bytes: bytes.byteLength,
        invoiceType: result.invoiceType,
        findings: result.findings.length,
      }),
    )

    return jsonResponse(result, 200, rlHeaders)
  } catch (err) {
    console.error(
      JSON.stringify({
        at: 'api/v1/validate',
        status: 500,
        bytes: bytes.byteLength,
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
    return jsonResponse(
      { error: 'internal_error', message: 'Validation failed to run.' },
      500,
      rlHeaders,
    )
  }
}
