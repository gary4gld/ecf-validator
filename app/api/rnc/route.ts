/**
 * Server-side proxy for the Megaplus RNC lookup endpoint.
 *
 * The browser can't call rnc.megaplus.com.do directly due to CORS restrictions.
 * This route forwards the request from Next.js server (no CORS constraint)
 * and returns the response to the client.
 *
 * Usage: GET /api/rnc?rnc=131880681
 */

import { NextRequest, NextResponse } from 'next/server'

const MEGAPLUS_URL = 'https://rnc.megaplus.com.do/api/consulta'
const TIMEOUT_MS   = 6000

export async function GET(request: NextRequest) {
  const rnc = request.nextUrl.searchParams.get('rnc')

  if (!rnc || !/^[0-9]{9,11}$/.test(rnc)) {
    return NextResponse.json(
      { error: true, mensaje: 'RNC inválido — debe ser 9 u 11 dígitos' },
      { status: 400 }
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const upstream = await fetch(
      `${MEGAPLUS_URL}?rnc=${encodeURIComponent(rnc)}`,
      { signal: controller.signal }
    )
    clearTimeout(timer)

    // Always return 200 to the client regardless of upstream status.
    // registry-checks.ts reads the `error` field to distinguish not-found from success.
    // Forwarding non-200 status codes causes the client to see null and show a
    // misleading "connection issue" message instead of "RNC not found".
    try {
      const data = await upstream.json()
      return NextResponse.json(data)
    } catch {
      return NextResponse.json(
        { error: true, mensaje: 'Respuesta inesperada del servicio DGII' },
        { status: 200 }
      )
    }

  } catch (err) {
    clearTimeout(timer)
    const isTimeout = (err as Error)?.name === 'AbortError'
    return NextResponse.json(
      { error: true, mensaje: isTimeout ? 'Tiempo de espera agotado' : 'Error de conexión' },
      { status: 503 }
    )
  }
}