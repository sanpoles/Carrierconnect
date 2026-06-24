import { useEffect } from 'react'
import type { AuthUser } from '../services/api'
import {
  startRealtimeConnection,
  stopRealtimeConnection,
} from '../services/realtime'

type RealtimeBridgeProps = {
  currentUser: AuthUser | null
}

function RealtimeBridge({ currentUser }: RealtimeBridgeProps) {
  useEffect(() => {
    const token = localStorage.getItem('careerconnect_token')

    if (!currentUser || !token) {
      stopRealtimeConnection()
      return
    }

    startRealtimeConnection(token)

    return () => {
      stopRealtimeConnection()
    }
  }, [currentUser?.id])

  return null
}

export default RealtimeBridge