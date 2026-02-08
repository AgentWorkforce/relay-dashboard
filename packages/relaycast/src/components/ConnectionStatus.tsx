'use client';

import { useWsStore, type ConnectionState } from '@/hooks/useWebSocket';

const labels: Record<ConnectionState, string> = {
  connecting: 'Connecting...',
  connected: 'Connected',
  disconnected: 'Disconnected',
};

const colors: Record<ConnectionState, string> = {
  connecting: 'bg-yellow-400',
  connected: 'bg-green-400',
  disconnected: 'bg-red-400',
};

export default function ConnectionStatus() {
  const status = useWsStore((s) => s.status);

  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} />
      <span className="text-xs text-text-muted">{labels[status]}</span>
    </div>
  );
}
