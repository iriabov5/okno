import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, LayoutGrid, X } from 'lucide-react';

export function Logo() {
  return (
    <div className="logo">
      <span className="brand-icon">
        <LayoutGrid size={19} />
      </span>
      <span>Окно</span>
    </div>
  );
}

export function Alert({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="alert" role="alert">
      <AlertTriangle size={18} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="empty">{children}</div>;
}

export function Modal({
  title,
  onClose,
  children,
}: Readonly<{
  title: string;
  onClose: () => void;
  children: ReactNode;
}>) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      requestAnimationFrame(() => {
        if (
          trigger instanceof HTMLElement &&
          trigger.isConnected &&
          document.activeElement === document.body
        ) {
          trigger.focus();
        }
      });
    };
  }, []);
  return (
    <dialog ref={dialog} className="modal" aria-label={title} onClose={onClose}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть"
          onClick={() => dialog.current?.close()}
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
