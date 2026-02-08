'use client';

import AuthGate from './AuthGate';
import RelaycastSidebar from './RelaycastSidebar';
import { useWebSocket } from '@/hooks/useWebSocket';

function WebSocketConnector() {
  useWebSocket();
  return null;
}

export default function RelaycastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <WebSocketConnector />
      <div className="flex h-screen overflow-hidden bg-bg">
        <RelaycastSidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </AuthGate>
  );
}
