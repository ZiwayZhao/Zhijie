/**
 * Generic SSE parser for POST requests.
 * Uses fetch + ReadableStream (not EventSource, which only supports GET).
 */

export interface SSEEvent<T = unknown> {
  event: string
  data: T
}

export type SSEEventHandler = (event: SSEEvent) => void
export type SSEErrorHandler = (error: Error) => void

/**
 * Connect to an SSE endpoint via POST, parse events, and call back.
 * Returns AbortController for cancellation.
 */
export function connectSSE(
  url: string,
  options: {
    method: 'POST'
    headers: Record<string, string>
    body: string
  },
  onEvent: SSEEventHandler,
  onError: SSEErrorHandler,
  onComplete: () => void,
): AbortController {
  const controller = new AbortController()

  ;(async () => {
    try {
      const response = await fetch(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        onError(new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`))
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        onError(new Error('Response body is not readable'))
        return
      }

      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let currentEvent = ''
      let currentData = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // Split on \n and strip \r (servers may send \r\n or \n)
        const lines = buffer.split('\n')
        // Keep incomplete last line in buffer
        buffer = lines.pop() ?? ''

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '')
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            currentData += (currentData ? '\n' : '') + line.slice(5).trim()
          } else if (line === '' && currentEvent && currentData) {
            // Empty line = end of event
            try {
              const parsed = JSON.parse(currentData)
              onEvent({ event: currentEvent, data: parsed })
            } catch {
              // Non-JSON data, pass as string
              onEvent({ event: currentEvent, data: currentData })
            }
            currentEvent = ''
            currentData = ''
          }
        }
      }

      // Flush remaining
      if (currentEvent && currentData) {
        try {
          const parsed = JSON.parse(currentData)
          onEvent({ event: currentEvent, data: parsed })
        } catch {
          onEvent({ event: currentEvent, data: currentData })
        }
      }

      onComplete()
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  })()

  return controller
}
