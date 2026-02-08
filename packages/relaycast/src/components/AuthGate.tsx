'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/store';
import { validateApiKey } from '@/lib/relay';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { apiKey, logout } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!apiKey) {
      window.location.href = '/login';
      return;
    }

    validateApiKey(apiKey)
      .then(() => setChecking(false))
      .catch(() => {
        logout();
        window.location.href = '/login';
      });
  }, [apiKey, logout]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <p className="text-text-muted">Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}
