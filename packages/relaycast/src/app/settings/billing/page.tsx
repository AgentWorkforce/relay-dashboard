'use client';

import { useEffect, useState } from 'react';
import RelaycastProvider from '@/components/RelaycastProvider';
import { useAuthStore } from '@/lib/store';
import {
  fetchBillingUsage,
  fetchBillingSubscription,
  createBillingPortal,
  type BillingUsage,
  type BillingSubscription,
} from '@/lib/relay';

function UsageMeter({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <div className="mb-4">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-text">{label}</span>
        <span className="text-text-muted">
          {used} / {limit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function BillingContent() {
  const apiKey = useAuthStore((s) => s.apiKey);
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(
    null,
  );
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (!apiKey) return;
    fetchBillingUsage(apiKey).then(setUsage).catch(() => {});
    fetchBillingSubscription(apiKey).then(setSubscription).catch(() => {});
  }, [apiKey]);

  const handleManageBilling = async () => {
    if (!apiKey) return;
    setPortalLoading(true);
    try {
      const { url } = await createBillingPortal(apiKey);
      window.open(url, '_blank');
    } catch {
      // portal unavailable
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-semibold text-text">Billing</h1>

      {/* Plan info */}
      <section className="mb-8 rounded-lg border border-white/10 bg-white/5 p-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-text-muted">
          Current Plan
        </h2>
        <p className="text-lg font-medium text-text">
          {subscription?.plan ?? 'Free'}
        </p>
        {subscription?.status && (
          <p className="text-sm text-text-muted">
            Status: {subscription.status}
          </p>
        )}
        {subscription?.current_period_end && (
          <p className="text-sm text-text-muted">
            Renews:{' '}
            {new Date(subscription.current_period_end).toLocaleDateString()}
          </p>
        )}
      </section>

      {/* Usage meters */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-text-muted">
          Usage
        </h2>
        {usage ? (
          <>
            <UsageMeter
              label="Messages"
              used={usage.messages.used}
              limit={usage.messages.limit}
            />
            <UsageMeter
              label="Agents"
              used={usage.agents.used}
              limit={usage.agents.limit}
            />
            <UsageMeter
              label="Storage (MB)"
              used={usage.storage.used_mb}
              limit={usage.storage.limit_mb}
            />
          </>
        ) : (
          <p className="text-sm text-text-muted">Loading usage data...</p>
        )}
      </section>

      {/* Manage billing */}
      <button
        onClick={handleManageBilling}
        disabled={portalLoading}
        className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {portalLoading ? 'Opening...' : 'Manage Billing'}
      </button>
    </div>
  );
}

export default function BillingPage() {
  return (
    <RelaycastProvider>
      <BillingContent />
    </RelaycastProvider>
  );
}
