import { useEffect, useRef, useState, useCallback } from "react"

type MessageHandler = (data: any) => void

type UseWebSocketOptions = {
  url: string
  token?: string | null
  tenantId?: string | null
  onMessage?: Record<string, MessageHandler>
  onConnect?: () => void
  onDisconnect?: () => void
}

export function useWebSocket({
  url,
  token,
  tenantId,
  onMessage,
  onConnect,
  onDisconnect,
}: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<any>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<number | null>(null)
  const handlersRef = useRef(onMessage)
  handlersRef.current = onMessage

  const connect = useCallback(() => {
    if (!url || wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return

    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        if (token) {
          ws.send(JSON.stringify({ type: "auth", token }))
        }
        if (tenantId) {
          ws.send(JSON.stringify({ type: "subscribe", channel: `tenant:${tenantId}` }))
        }
        onConnect?.()
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          setLastMessage(msg)
          if (msg.type && handlersRef.current?.[msg.type]) {
            handlersRef.current[msg.type](msg.data)
          }
        } catch { /* ignore parse errors */ }
      }

      ws.onclose = () => {
        setIsConnected(false)
        onDisconnect?.()
        wsRef.current = null
        reconnectRef.current = window.setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch {
      reconnectRef.current = window.setTimeout(connect, 3000)
    }
  }, [url, token, tenantId, onConnect, onDisconnect])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  return { isConnected, lastMessage, send }
}