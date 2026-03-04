/**
 * Send strategy pattern for Relaycast message delivery.
 *
 * Extracts the dual send paths from proxy-server.ts into a clean
 * strategy pattern:
 *
 * - BrokerSendStrategy: HTTP POST to broker `/api/send`
 * - DirectSendStrategy: Calls sendMessage() from relaycast-provider.ts
 */

import { extractMessageId } from './message-id.js';
import { sendMessage } from '../relaycast-provider.js';
import type { RelaycastConfig } from '../relaycast-provider-types.js';

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors and let callers fallback to plain text handling.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendRequest {
  to: string;
  message: string;
  from: string;
  thread?: string;
}

export interface SendResult {
  success: true;
  messageId: string;
}

export interface SendError {
  success: false;
  status: number;
  error: string;
}

export type SendOutcome = SendResult | SendError;

export interface SendStrategy {
  send(request: SendRequest): Promise<SendOutcome>;
}

// ---------------------------------------------------------------------------
// BrokerSendStrategy
// ---------------------------------------------------------------------------

/**
 * Sends messages via the broker HTTP API (`POST /api/send`).
 * Used when running in proxy mode with a broker URL configured.
 */
export class BrokerSendStrategy implements SendStrategy {
  constructor(private brokerUrl: string) {}

  async send(request: SendRequest): Promise<SendOutcome> {
    try {
      const upstream = await fetch(`${this.brokerUrl}/api/send`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          to: request.to,
          message: request.message,
          from: request.from,
          thread: request.thread,
        }),
      });

      const bodyText = await upstream.text();
      const payload = bodyText ? parseJsonRecord(bodyText) : null;

      if (!upstream.ok) {
        const upstreamError = payload?.error;
        return {
          success: false,
          status: upstream.status,
          error: typeof upstreamError === 'string' && upstreamError.trim()
            ? upstreamError
            : (bodyText.trim() || `Broker send failed with status ${upstream.status}`),
        };
      }

      const brokerMessageId = payload ? extractMessageId(payload) : null;
      if (!brokerMessageId) {
        return {
          success: false,
          status: 502,
          error: 'Broker send succeeded but did not return event_id',
        };
      }

      return {
        success: true,
        messageId: brokerMessageId,
      };
    } catch (err) {
      return {
        success: false,
        status: 502,
        error: (err as Error).message || 'Failed to send message through broker',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// DirectSendStrategy
// ---------------------------------------------------------------------------

/**
 * Sends messages directly via the Relaycast SDK.
 * Used in standalone mode when no broker is configured.
 */
export class DirectSendStrategy implements SendStrategy {
  constructor(
    private config: RelaycastConfig,
    private dataDir: string,
  ) {}

  async send(request: SendRequest): Promise<SendOutcome> {
    try {
      const result = await sendMessage(this.config, {
        to: request.to,
        message: request.message,
        from: request.from,
        thread: request.thread,
        dataDir: this.dataDir,
      });
      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (err) {
      return {
        success: false,
        status: 502,
        error: (err as Error).message || 'Failed to send message',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateSendStrategyOptions {
  brokerProxyEnabled: boolean;
  brokerUrl?: string;
  relaycastConfig?: RelaycastConfig | null;
  dataDir: string;
}

/**
 * Create the appropriate send strategy based on server configuration.
 *
 * Returns `null` when neither a broker URL nor valid Relaycast config is
 * available (the caller should handle this as a 503).
 */
export function createSendStrategy(opts: CreateSendStrategyOptions): SendStrategy | null {
  if (opts.brokerProxyEnabled && opts.brokerUrl) {
    return new BrokerSendStrategy(opts.brokerUrl);
  }

  if (opts.relaycastConfig) {
    return new DirectSendStrategy(opts.relaycastConfig, opts.dataDir);
  }

  return null;
}
