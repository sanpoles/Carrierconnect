import { io, type Socket } from 'socket.io-client'
import type { CareerNotification, RequestMessage } from './api'

const REALTIME_SERVER_URL =
  import.meta.env.VITE_REALTIME_SERVER_URL || 'http://localhost:4000'

let socket: Socket | null = null
let connectedToken = ''

const messageListeners = new Set<(message: RequestMessage) => void>()
const notificationListeners = new Set<
  (notification: CareerNotification) => void
>()
const internalNoteListeners = new Set<(note: RequestMessage) => void>()

function notifyMessageListeners(message: RequestMessage) {
  messageListeners.forEach((listener) => {
    listener(message)
  })
}

function notifyNotificationListeners(notification: CareerNotification) {
  notificationListeners.forEach((listener) => {
    listener(notification)
  })
}

function notifyInternalNoteListeners(note: RequestMessage) {
  internalNoteListeners.forEach((listener) => {
    listener(note)
  })
}

export function startRealtimeConnection(token: string) {
  if (!token) {
    stopRealtimeConnection()
    return
  }

  if (socket && connectedToken === token) {
    return
  }

  stopRealtimeConnection()
  connectedToken = token

  socket = io(REALTIME_SERVER_URL, {
    auth: {
      token,
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  })

  socket.on('connect', () => {
    console.log('CareerConnect realtime connection established.')
  })

  socket.on('connect_error', (error) => {
    console.warn('CareerConnect realtime connection failed:', error.message)
  })

  socket.on('message:new', (message: RequestMessage) => {
    notifyMessageListeners(message)
  })

  socket.on('notification:new', (notification: CareerNotification) => {
    notifyNotificationListeners(notification)
  })

  socket.on('internal-note:new', (note: RequestMessage) => {
    notifyInternalNoteListeners(note)
  })
}

export function stopRealtimeConnection() {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
  }

  socket = null
  connectedToken = ''
}

export function onRealtimeMessage(
  listener: (message: RequestMessage) => void,
) {
  messageListeners.add(listener)

  return () => {
    messageListeners.delete(listener)
  }
}

export function onRealtimeNotification(
  listener: (notification: CareerNotification) => void,
) {
  notificationListeners.add(listener)

  return () => {
    notificationListeners.delete(listener)
  }
}
export function onRealtimeInternalNote(
  listener: (note: RequestMessage) => void,
) {
  internalNoteListeners.add(listener)

  return () => {
    internalNoteListeners.delete(listener)
  }
}
