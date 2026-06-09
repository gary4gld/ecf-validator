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

  if (!rnc || !/^([0-9]{9}|[0-9]{11})$/.test(rnc)) {
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

    // Always pass through the Megaplus JSON with status 200 so the client can
    // read the `error` field. Only fall back to 503 if the body isn't JSON
    // (true connectivity/parsing failure, not a "not found" response).
    try {
      const data = await upstream.json()
      return NextResponse.json(data)
    } catch {
      return NextResponse.json(
        { error: true, mensaje: 'Respuesta inesperada del servicio DGII' },
        { status: 503 }
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