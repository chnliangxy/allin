import type { ConfirmState } from '../uiTypes'

type Props = ConfirmState & {
  onCancel: () => void
}

function ConfirmDialog(props: Props) {
  const { title, message, confirmText, confirmVariant, onCancel, onConfirm } = props

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-text">{message}</div>
        <div className="modal-actions">
          <button onClick={onCancel}>取消</button>
          <button className={confirmVariant} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog

