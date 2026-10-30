"use client";

type Props = { text: string; onDismiss: () => void; action?: { label: string; onClick: () => void; disabled?: boolean } };

export default function Notice({ text, onDismiss, action }: Props) {
  return (
    <div role="status" className="anim-enter mb-4 pl-4 pr-2 py-2 text-[13px] text-soft rounded-xl border border-primary-100 bg-primary-50 flex items-center justify-between gap-3">
      <span>{text}</span>
      <span className="shrink-0 flex items-center gap-1">
      {action && (
        <button onClick={action.onClick} disabled={action.disabled} className="btn shrink-0 h-7 px-2.5 text-[13px] font-semibold text-primary hover:bg-primary-100">{action.label}</button>
      )}
      <button onClick={onDismiss} className="btn shrink-0 h-7 px-2.5 text-[13px] text-primary hover:bg-primary-100">Dismiss</button>
      </span>
    </div>
  );
}
