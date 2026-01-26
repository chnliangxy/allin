export type SyncStatus = 'connecting' | 'connected' | 'disconnected'

export type Route = 'home' | 'game' | 'summary' | 'history' | 'rules'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export type PlayersSaveFeedback = { kind: 'success' | 'error'; text: string }

export type ConfirmState = {
  title: string
  message: string
  confirmText: string
  confirmVariant: 'primary' | 'danger'
  onConfirm: () => void
}

export type TurnToastInfo = {
  seat: number
  name: string
}

