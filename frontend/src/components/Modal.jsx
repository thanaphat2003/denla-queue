export default function Modal({
  open,
  type = 'info',
  title,
  message,
  confirmText = 'ตกลง',
  cancelText = null,
  onConfirm,
  onClose,
}) {
  if (!open) return null;

  const iconMap = {
    error: { icon: '!', className: 'bg-red-100 text-red-600' },
    confirm: { icon: '?', className: 'bg-amber-100 text-amber-600' },
    success: { icon: '✓', className: 'bg-emerald-100 text-emerald-600' },
    info: { icon: 'i', className: 'bg-primary/10 text-primary' },
  };

  const tone = iconMap[type] || iconMap.info;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 backdrop-blur-[1px]">
      <div className="w-full max-w-md rounded-2xl border border-primary/10 bg-surface p-6 shadow-2xl shadow-primary/10">
        <div className="mb-4 flex items-center gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold ${tone.className}`}>
            {tone.icon}
          </div>
          <h3 className="font-display text-xl text-primary">{title}</h3>
        </div>

        <p className="mb-5 text-sm leading-6 text-ink-muted">{message}</p>

        <div className="flex justify-end gap-2">
          {cancelText && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm font-medium text-ink hover:border-primary/30 hover:text-primary"
            >
              {cancelText}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (onConfirm) {
                onConfirm();
                return;
              }
              onClose?.();
            }}
            className={[
              'rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors',
              type === 'error' ? 'bg-red-500 hover:bg-red-600' :
              type === 'confirm' ? 'bg-amber-500 hover:bg-amber-600' :
              'bg-primary hover:bg-primary-light',
            ].join(' ')}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
