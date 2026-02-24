import { WebSocket, type WebSocketServer } from 'ws';
import type { MessageBuffer } from '../messageBuffer.js';

export interface UserPresenceInfo {
  username: string;
  avatarUrl?: string;
  connectedAt: string;
  lastSeen: string;
}

export interface UserPresenceState {
  info: UserPresenceInfo;
  connections: Set<WebSocket>;
}

export interface ChannelMessageEvent {
  type: 'channel_message';
  targetUser: string;
  channel: string;
  from: string;
  fromAvatarUrl?: string;
  fromEntityType?: 'user' | 'agent';
  body: string;
  thread?: string;
  mentions?: string[];
  timestamp: string;
}

export interface DirectMessageEvent {
  type: 'direct_message';
  targetUser: string;
  from: string;
  fromAvatarUrl?: string;
  fromEntityType?: 'user' | 'agent';
  body: string;
  id: string;
  messageId: string;
  timestamp: string;
}

interface UserBridgeLike {
  updateWebSocket: (username: string, ws: WebSocket) => void;
  registerUser: (username: string, ws: WebSocket, metadata?: { avatarUrl?: string }) => Promise<void>;
  unregisterUser: (username: string) => void;
  joinChannel: (username: string, channel: string) => Promise<boolean>;
  leaveChannel: (username: string, channel: string) => Promise<boolean>;
  sendChannelMessage: (username: string, channel: string, body: string, options?: { thread?: string }) => Promise<boolean>;
  sendDirectMessage: (from: string, to: string, body: string, options?: { thread?: string }) => Promise<boolean>;
}

export interface PresenceWebSocketDeps {
  wss: WebSocketServer;
  wssPresence: WebSocketServer;
  mainMessageBuffer: MessageBuffer;
  onlineUsers: Map<string, UserPresenceState>;
  presenceHealth: WeakMap<WebSocket, { isAlive: boolean }>;
  broadcastPresence: (message: object, exclude?: WebSocket) => void;
  isValidUsername: (username: unknown) => username is string;
  isValidAvatarUrl: (avatarUrl: unknown) => avatarUrl is string | undefined;
  getUserBridge: () => UserBridgeLike | undefined;
  debug: (message: string) => void;
}

export interface PresenceSetupResult {
  broadcastChannelMessage: (message: ChannelMessageEvent) => void;
  broadcastDirectMessage: (message: DirectMessageEvent) => void;
}

/**
 * Presence WebSocket handler and channel/direct message broadcasters.
 */
export function setupPresenceWebSocket(deps: PresenceWebSocketDeps): PresenceSetupResult {
  const {
    wss,
    wssPresence,
    mainMessageBuffer,
    onlineUsers,
    presenceHealth,
    broadcastPresence,
    isValidUsername,
    isValidAvatarUrl,
    getUserBridge,
    debug,
  } = deps;

  // Helper to broadcast channel messages to all connected clients.
  // Broadcasts to both main wss (local mode) and wssPresence (cloud mode).
  const broadcastChannelMessage = (message: ChannelMessageEvent) => {
    // Push into buffer and wrap with sequence ID for replay support.
    const rawPayload = JSON.stringify(message);
    const seq = mainMessageBuffer.push('channel_message', rawPayload);
    const payload = JSON.stringify({ seq, ...message });
    // Broadcast to main WebSocket clients (local mode).
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
    // Also broadcast to presence WebSocket clients (cloud mode).
    wssPresence.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  // Helper to broadcast direct messages to all connected clients.
  // This enables agent replies to appear in the dashboard UI.
  const broadcastDirectMessage = (message: DirectMessageEvent) => {
    // Push into buffer and wrap with sequence ID for replay support.
    const rawPayload = JSON.stringify(message);
    const seq = mainMessageBuffer.push('direct_message', rawPayload);
    const payload = JSON.stringify({ seq, ...message });

    // Broadcast to main WebSocket clients (local mode).
    const mainClients = Array.from(wss.clients).filter((c) => c.readyState === WebSocket.OPEN);
    debug(`[dashboard] Broadcasting direct_message to ${mainClients.length} main clients`);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });

    const presenceClients = Array.from(wssPresence.clients).filter((c) => c.readyState === WebSocket.OPEN);
    if (presenceClients.length > 0) {
      debug(`[dashboard] Broadcasting direct_message to ${presenceClients.length} presence clients`);
      wssPresence.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    }
  };

  // Helper to get online users list (without ws references).
  const getOnlineUsersList = (): UserPresenceInfo[] => {
    return Array.from(onlineUsers.values()).map((state) => state.info);
  };

  // Heartbeat to detect dead connections (30 seconds).
  const PRESENCE_HEARTBEAT_INTERVAL = 30000;
  const presenceHeartbeat = setInterval(() => {
    wssPresence.clients.forEach((ws) => {
      const health = presenceHealth.get(ws);
      if (!health) {
        presenceHealth.set(ws, { isAlive: true });
        return;
      }
      if (!health.isAlive) {
        ws.terminate();
        return;
      }
      health.isAlive = false;
      ws.ping();
    });
  }, PRESENCE_HEARTBEAT_INTERVAL);

  wssPresence.on('close', () => {
    clearInterval(presenceHeartbeat);
  });

  wssPresence.on('connection', (ws) => {
    // Initialize health tracking (no log - too noisy).
    presenceHealth.set(ws, { isAlive: true });

    ws.on('pong', () => {
      const health = presenceHealth.get(ws);
      if (health) health.isAlive = true;
    });

    let clientUsername: string | undefined;

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;

        if (msg.type === 'presence') {
          if (msg.action === 'join' && typeof msg.user === 'object' && msg.user !== null && 'username' in msg.user) {
            const user = msg.user as { username?: unknown; avatarUrl?: unknown };
            const username = user.username;
            const avatarUrl = user.avatarUrl;

            // Validate inputs.
            if (!isValidUsername(username)) {
              console.warn(`[dashboard] Invalid username rejected: ${username}`);
              return;
            }
            if (!isValidAvatarUrl(avatarUrl)) {
              console.warn(`[dashboard] Invalid avatar URL rejected for user ${username}`);
              return;
            }

            clientUsername = username;
            const now = new Date().toISOString();

            // Check if user already has connections (multi-tab support).
            const existing = onlineUsers.get(username);
            if (existing) {
              // Add this connection to existing user.
              existing.connections.add(ws);
              existing.info.lastSeen = now;

              // Update userBridge to use the new WebSocket for message delivery.
              getUserBridge()?.updateWebSocket(username, ws);

              // Only log at milestones to reduce noise.
              const count = existing.connections.size;
              if (count === 2 || count === 5 || count === 10 || count % 50 === 0) {
                console.log(`[dashboard] User ${username} has ${count} connections`);
              }
            } else {
              // New user - create presence state.
              onlineUsers.set(username, {
                info: {
                  username,
                  avatarUrl,
                  connectedAt: now,
                  lastSeen: now,
                },
                connections: new Set([ws]),
              });

              console.log(`[dashboard] User ${username} came online`);

              // Register user for messaging.
              getUserBridge()?.registerUser(username, ws, { avatarUrl }).catch((err: unknown) => {
                console.error(`[dashboard] Failed to register user ${username} with relay:`, err);
              });

              // Broadcast join to all other clients (only for truly new users).
              broadcastPresence({
                type: 'presence_join',
                user: {
                  username,
                  avatarUrl,
                  connectedAt: now,
                  lastSeen: now,
                },
              }, ws);
            }

            // Send current online users list to the new client.
            ws.send(JSON.stringify({
              type: 'presence_list',
              users: getOnlineUsersList(),
            }));
          } else if (msg.action === 'leave') {
            // Security: Only allow leaving your own username. Must be authenticated first.
            if (!clientUsername) {
              console.warn('[dashboard] Security: Unauthenticated leave attempt');
              return;
            }
            if (msg.username !== clientUsername) {
              console.warn(`[dashboard] Security: User ${clientUsername} tried to remove ${String(msg.username)}`);
              return;
            }

            // Remove this connection from the user's set.
            const username = clientUsername;
            const userState = onlineUsers.get(username);
            if (userState) {
              userState.connections.delete(ws);

              // Only broadcast leave if no more connections.
              if (userState.connections.size === 0) {
                onlineUsers.delete(username);
                console.log(`[dashboard] User ${username} went offline`);

                broadcastPresence({
                  type: 'presence_leave',
                  username,
                });
              } else {
                console.log(`[dashboard] User ${username} closed tab (${userState.connections.size} remaining)`);
              }
            }
          }
        } else if (msg.type === 'typing') {
          // Must have authenticated first.
          if (!clientUsername) {
            console.warn('[dashboard] Security: Unauthenticated typing attempt');
            return;
          }
          // Validate typing message comes from authenticated user.
          if (msg.username !== clientUsername) {
            console.warn('[dashboard] Security: Typing message username mismatch');
            return;
          }

          // Update last seen.
          const username = clientUsername;
          const userState = onlineUsers.get(username);
          if (userState) {
            userState.info.lastSeen = new Date().toISOString();
          }

          // Broadcast typing indicator to all other clients.
          broadcastPresence({
            type: 'typing',
            username,
            avatarUrl: userState?.info.avatarUrl,
            isTyping: msg.isTyping,
          }, ws);
        } else if (msg.type === 'channel_join') {
          // Join a channel.
          if (!clientUsername) {
            console.warn('[dashboard] Security: Unauthenticated channel_join attempt');
            return;
          }
          if (!msg.channel || typeof msg.channel !== 'string') {
            console.warn('[dashboard] Invalid channel_join: missing channel');
            return;
          }
          getUserBridge()?.joinChannel(clientUsername, msg.channel).then((success: boolean) => {
            ws.send(JSON.stringify({
              type: 'channel_joined',
              channel: msg.channel,
              success,
            }));
          }).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[dashboard] Channel join error:', err);
            ws.send(JSON.stringify({
              type: 'channel_joined',
              channel: msg.channel,
              success: false,
              error: message,
            }));
          });
        } else if (msg.type === 'channel_leave') {
          // Leave a channel.
          if (!clientUsername) {
            console.warn('[dashboard] Security: Unauthenticated channel_leave attempt');
            return;
          }
          if (!msg.channel || typeof msg.channel !== 'string') {
            console.warn('[dashboard] Invalid channel_leave: missing channel');
            return;
          }
          getUserBridge()?.leaveChannel(clientUsername, msg.channel).then((success: boolean) => {
            ws.send(JSON.stringify({
              type: 'channel_left',
              channel: msg.channel,
              success,
            }));
          }).catch((err: unknown) => {
            console.error('[dashboard] Channel leave error:', err);
          });
        } else if (msg.type === 'channel_message') {
          // Send message to channel.
          if (!clientUsername) {
            console.warn('[dashboard] Security: Unauthenticated channel_message attempt');
            return;
          }
          if (!msg.channel || typeof msg.channel !== 'string') {
            console.warn('[dashboard] Invalid channel_message: missing channel');
            return;
          }
          if (!msg.body || typeof msg.body !== 'string') {
            console.warn('[dashboard] Invalid channel_message: missing body');
            return;
          }
          getUserBridge()?.sendChannelMessage(clientUsername, msg.channel, msg.body, {
            thread: typeof msg.thread === 'string' ? msg.thread : undefined,
          }).catch((err: unknown) => {
            console.error('[dashboard] Channel message error:', err);
          });
        } else if (msg.type === 'direct_message') {
          // Send direct message to user or agent.
          if (!clientUsername) {
            console.warn('[dashboard] Security: Unauthenticated direct_message attempt');
            return;
          }
          if (!msg.to || typeof msg.to !== 'string') {
            console.warn("[dashboard] Invalid direct_message: missing 'to'");
            return;
          }
          if (!msg.body || typeof msg.body !== 'string') {
            console.warn('[dashboard] Invalid direct_message: missing body');
            return;
          }
          getUserBridge()?.sendDirectMessage(clientUsername, msg.to, msg.body, {
            thread: typeof msg.thread === 'string' ? msg.thread : undefined,
          }).catch((err: unknown) => {
            console.error('[dashboard] Direct message error:', err);
          });
        }
      } catch (err) {
        console.error('[dashboard] Invalid presence message:', err);
      }
    });

    ws.on('error', (err) => {
      console.error('[dashboard] Presence WebSocket client error:', err);
    });

    ws.on('close', () => {
      // Clean up on disconnect with multi-tab support.
      if (clientUsername) {
        const userState = onlineUsers.get(clientUsername);
        if (userState) {
          userState.connections.delete(ws);

          // Only broadcast leave if no more connections.
          if (userState.connections.size === 0) {
            onlineUsers.delete(clientUsername);
            console.log(`[dashboard] User ${clientUsername} disconnected`);

            // Unregister from messaging bridge.
            getUserBridge()?.unregisterUser(clientUsername);

            broadcastPresence({
              type: 'presence_leave',
              username: clientUsername,
            });
          } else {
            console.log(`[dashboard] User ${clientUsername} closed connection (${userState.connections.size} remaining)`);
          }
        }
      }
    });
  });

  return {
    broadcastChannelMessage,
    broadcastDirectMessage,
  };
}
