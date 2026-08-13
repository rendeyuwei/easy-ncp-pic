import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { X } from 'lucide-react';

export type NotificationTone = 'success' | 'info' | 'failure';

interface Notification {
  message: string;
  tone: NotificationTone;
}

interface NotificationContextValue {
  notify(message: string, tone: NotificationTone): void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: PropsWithChildren) {
  const [current, setCurrent] = useState<Notification | null>(null);
  const notify = useCallback((message: string, tone: NotificationTone) => {
    setCurrent({ message, tone });
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {current ? (
        <div
          className={`notification notification--${current.tone}`}
          role={current.tone === 'failure' ? 'alert' : 'status'}
        >
          <span>{current.message}</span>
          <button type="button" onClick={() => setCurrent(null)} aria-label="关闭通知">
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const notifications = useContext(NotificationContext);
  if (!notifications) throw new Error('useNotifications must be used within NotificationProvider');
  return notifications;
}
