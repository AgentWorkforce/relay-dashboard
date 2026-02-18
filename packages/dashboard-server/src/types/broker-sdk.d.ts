/**
 * Type declarations for @agent-relay/broker-sdk.
 *
 * This stub allows the dashboard to compile before the broker SDK is
 * published to npm. Remove this file once @agent-relay/broker-sdk is
 * available as a real dependency.
 */
declare module '@agent-relay/broker-sdk' {
  export interface RelayAdapterOptions {
    cwd: string;
    binaryPath?: string;
    channels?: string[];
    env?: NodeJS.ProcessEnv;
    clientName?: string;
  }

  export interface RelaySpawnRequest {
    name: string;
    cli: string;
    task?: string;
    team?: string;
    cwd?: string;
    model?: string;
    interactive?: boolean;
    shadowMode?: string;
    shadowOf?: string;
    shadowAgent?: string;
    shadowTriggers?: string;
    shadowSpeakOn?: string;
    spawnerName?: string;
    userId?: string;
    includeWorkflowConventions?: boolean;
  }

  export interface RelaySpawnResult {
    success: boolean;
    name: string;
    pid?: number;
    error?: string;
  }

  export interface RelayAgentInfo {
    name: string;
    cli?: string;
    pid?: number;
    channels: string[];
    parent?: string;
    runtime: string;
  }

  export interface RelayReleaseResult {
    success: boolean;
    name: string;
    error?: string;
  }

  export interface SendMessageInput {
    to: string;
    text: string;
    from?: string;
    threadId?: string;
    priority?: number;
  }

  export type BrokerEvent =
    | { kind: 'agent_spawned'; name: string; runtime: string; parent?: string }
    | { kind: 'agent_released'; name: string }
    | { kind: 'agent_exited'; name: string; code?: number; signal?: string }
    | { kind: 'relay_inbound'; event_id: string; from: string; target: string; body: string; thread_id?: string }
    | { kind: 'worker_stream'; name: string; stream: string; chunk: string }
    | { kind: 'delivery_retry'; name: string; delivery_id: string; event_id: string; attempts: number }
    | { kind: 'delivery_dropped'; name: string; delivery_id: string; event_id: string; reason: string };

  export class RelayAdapter {
    constructor(opts: RelayAdapterOptions);
    start(): Promise<void>;
    shutdown(): Promise<void>;
    spawn(req: RelaySpawnRequest): Promise<RelaySpawnResult>;
    release(name: string): Promise<RelayReleaseResult>;
    listAgents(): Promise<RelayAgentInfo[]>;
    hasAgent(name: string): Promise<boolean>;
    sendMessage(input: SendMessageInput): Promise<{ event_id: string; targets: string[] }>;
    sendInput(name: string, data: string): Promise<void>;
    interruptAgent(name: string): Promise<boolean>;
    setModel(name: string, model: string, opts?: { timeoutMs?: number }): Promise<{ success: boolean; name: string; model: string }>;
    getMetrics(agent?: string): Promise<{ agents: Array<{ name: string; pid: number; memory_bytes: number; uptime_secs: number }> }>;
    onEvent(listener: (event: BrokerEvent) => void): () => void;
  }
}
