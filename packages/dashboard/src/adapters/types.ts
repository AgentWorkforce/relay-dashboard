import type { ComponentType } from 'react';

export interface DashboardFeatures {
  billing: boolean;
  teams: boolean;
  workspaces: boolean;
  auth: boolean;
}

export interface CloudSettingsSlots {
  BillingPanel?: ComponentType;
  TeamPanel?: ComponentType;
  WorkspacePanel?: ComponentType;
}

export type SessionErrorCode = 'SESSION_EXPIRED' | 'USER_NOT_FOUND' | 'SESSION_ERROR';

export interface SessionError {
  error: string;
  code: SessionErrorCode;
  message: string;
}

export type SessionExpiredCallback = (error: SessionError) => void;

export interface SessionStatus {
  authenticated: boolean;
  code?: SessionErrorCode;
  message?: string;
  user?: {
    id: string;
    githubUsername: string;
    email?: string;
    avatarUrl?: string;
    plan: string;
  };
}

export interface CloudUser {
  id: string;
  githubUsername: string;
  email?: string;
  avatarUrl?: string;
  plan: string;
  connectedProviders: Array<{
    provider: string;
    email?: string;
    connectedAt: string;
  }>;
  pendingInvites: number;
  onboardingCompleted: boolean;
  displayName?: string;
}

export interface NangoLoginSession {
  sessionToken: string;
  tempUserId: string;
}

export interface NangoLoginStatus {
  ready: boolean;
  user?: {
    id: string;
    githubUsername: string;
    email?: string;
    avatarUrl?: string;
    plan: string;
  };
}

export interface NangoRepoSession {
  sessionToken: string;
}

export interface NangoRepoStatus {
  ready: boolean;
  pendingApproval?: boolean;
  message?: string;
  repos?: Array<{
    id: string;
    fullName: string;
    isPrivate: boolean;
    defaultBranch: string;
  }>;
}

export type CloudApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; sessionExpired?: boolean };

export type CloudApiResultWithoutSession<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface WorkspaceSummary {
  id: string;
  name: string;
  status: string;
  publicUrl?: string;
  isStopped: boolean;
  isRunning: boolean;
  isProvisioning: boolean;
  hasError: boolean;
}

export interface CloudApiAdapter {
  getNangoLoginSession(): Promise<CloudApiResultWithoutSession<NangoLoginSession>>;
  checkNangoLoginStatus(
    connectionId: string
  ): Promise<CloudApiResultWithoutSession<NangoLoginStatus>>;
  getNangoRepoSession(): Promise<CloudApiResult<NangoRepoSession>>;
  checkNangoRepoStatus(connectionId: string): Promise<CloudApiResult<NangoRepoStatus>>;
  checkSession(): Promise<SessionStatus>;
  getMe(): Promise<CloudApiResult<CloudUser>>;
  logout(): Promise<{ success: boolean; error?: string }>;
  getWorkspaces(): Promise<
    CloudApiResult<{
      workspaces: Array<{
        id: string;
        name: string;
        slug: string;
        repositories: number;
        members: number;
        plan: string;
      }>;
    }>
  >;
  getWorkspace(id: string): Promise<
    CloudApiResult<{
      id: string;
      name: string;
      slug: string;
      config: Record<string, unknown>;
      createdAt: string;
    }>
  >;
  createWorkspace(data: { name: string; slug?: string }): Promise<
    CloudApiResult<{
      id: string;
      name: string;
      slug: string;
    }>
  >;
  getPrimaryWorkspace(): Promise<
    CloudApiResult<{
      exists: boolean;
      message?: string;
      workspace?: {
        id: string;
        name: string;
        status: string;
        publicUrl?: string;
        isStopped: boolean;
        isRunning: boolean;
        isProvisioning: boolean;
        hasError: boolean;
        config: {
          providers: string[];
          repositories: string[];
        };
      };
      statusMessage: string;
      actionNeeded?: 'wakeup' | 'check_error' | null;
    }>
  >;
  getWorkspaceSummary(): Promise<
    CloudApiResult<{
      workspaces: WorkspaceSummary[];
      summary: {
        total: number;
        running: number;
        stopped: number;
        provisioning: number;
        error: number;
      };
      overallStatus: 'ready' | 'provisioning' | 'stopped' | 'none' | 'error';
    }>
  >;
  getAccessibleWorkspaces(): Promise<
    CloudApiResult<{
      workspaces: Array<{
        id: string;
        name: string;
        status: string;
        publicUrl?: string;
        providers?: string[];
        repositories?: string[];
        accessType: 'owner' | 'member' | 'contributor';
        permission: 'admin' | 'write' | 'read';
        createdAt: string;
      }>;
      summary: {
        owned: number;
        member: number;
        contributor: number;
        total: number;
      };
    }>
  >;
  getWorkspaceStatus(id: string): Promise<CloudApiResult<{ status: string }>>;
  wakeupWorkspace(id: string): Promise<
    CloudApiResult<{
      status: string;
      wasRestarted: boolean;
      message: string;
      estimatedStartTime?: number;
      publicUrl?: string;
    }>
  >;
  restartWorkspace(id: string): Promise<
    CloudApiResult<{
      success: boolean;
      action: 'restarted' | 'reprovisioning';
      message: string;
    }>
  >;
  rebuildWorkspace(id: string): Promise<CloudApiResult<{ success: boolean; message: string }>>;
  getProviders(workspaceId: string): Promise<
    CloudApiResult<{
      providers: Array<{
        id: string;
        name: string;
        displayName: string;
        description: string;
        color: string;
        authStrategy: string;
        cliCommand?: string;
        isConnected: boolean;
        connectedAs?: string;
        connectedAt?: string;
      }>;
    }>
  >;
  disconnectProvider(provider: string, workspaceId: string): Promise<CloudApiResult<{ success: boolean }>>;
  getUserCredentials(): Promise<
    CloudApiResult<{
      credentials: Array<{
        id: string;
        provider: string;
        providerAccountEmail?: string;
        createdAt: string;
        updatedAt: string;
        workspaces: Array<{ id: string; name: string }>;
      }>;
    }>
  >;
  assignCredentialToWorkspace(
    credentialId: string,
    workspaceId: string
  ): Promise<CloudApiResult<{ success: boolean }>>;
  unassignCredentialFromWorkspace(
    credentialId: string,
    workspaceId: string
  ): Promise<CloudApiResult<{ success: boolean }>>;
  getWorkspaceMembers(workspaceId: string): Promise<
    CloudApiResult<{
      members: Array<{
        id: string;
        userId: string;
        role: string;
        isPending: boolean;
        user?: {
          githubUsername: string;
          email?: string;
          avatarUrl?: string;
        };
      }>;
    }>
  >;
  getRepoCollaborators(workspaceId: string): Promise<
    CloudApiResult<{
      collaborators: Array<{
        id: number;
        login: string;
        avatarUrl: string;
        permission: 'admin' | 'write' | 'read' | 'none';
        repos: string[];
      }>;
      totalRepos: number;
      message?: string;
    }>
  >;
  inviteMember(
    workspaceId: string,
    githubUsername: string,
    role?: string
  ): Promise<CloudApiResult<{ success: boolean; member: unknown }>>;
  getPendingInvites(): Promise<
    CloudApiResult<{
      invites: Array<{
        id: string;
        workspaceId: string;
        workspaceName: string;
        role: string;
        invitedAt: string;
        invitedBy: string;
      }>;
    }>
  >;
  acceptInvite(inviteId: string): Promise<CloudApiResult<{ success: boolean; workspaceId: string }>>;
  declineInvite(inviteId: string): Promise<CloudApiResult<{ success: boolean }>>;
  updateMemberRole(
    workspaceId: string,
    memberId: string,
    role: string
  ): Promise<CloudApiResult<{ success: boolean; role: string }>>;
  removeMember(workspaceId: string, memberId: string): Promise<CloudApiResult<{ success: boolean }>>;
  getBillingPlans(): Promise<
    CloudApiResult<{
      plans: Array<{
        tier: string;
        name: string;
        description: string;
        price: { monthly: number; yearly: number };
        features: string[];
        limits: Record<string, number>;
        recommended?: boolean;
      }>;
      publishableKey: string;
    }>
  >;
  getSubscription(): Promise<
    CloudApiResult<{
      tier: string;
      subscription: {
        id: string;
        tier: string;
        status: string;
        currentPeriodStart: string;
        currentPeriodEnd: string;
        cancelAtPeriodEnd: boolean;
        interval: 'month' | 'year';
      } | null;
      customer: {
        id: string;
        email: string;
        name?: string;
        paymentMethods: Array<{
          id: string;
          type: string;
          last4?: string;
          brand?: string;
          isDefault: boolean;
        }>;
        invoices: Array<{
          id: string;
          number: string;
          amount: number;
          status: string;
          date: string;
          pdfUrl?: string;
        }>;
      } | null;
    }>
  >;
  createCheckoutSession(
    tier: string,
    interval?: 'month' | 'year'
  ): Promise<CloudApiResult<{ sessionId: string; checkoutUrl: string }>>;
  createBillingPortal(): Promise<CloudApiResult<{ sessionId: string; portalUrl: string }>>;
  changeSubscription(
    tier: string,
    interval?: 'month' | 'year'
  ): Promise<CloudApiResult<{ subscription: { tier: string; status: string } }>>;
  cancelSubscription(): Promise<
    CloudApiResult<{
      subscription: { cancelAtPeriodEnd: boolean; currentPeriodEnd: string };
      message: string;
    }>
  >;
  resumeSubscription(): Promise<
    CloudApiResult<{
      subscription: { cancelAtPeriodEnd: boolean };
      message: string;
    }>
  >;
  getInvoices(): Promise<
    CloudApiResult<{
      invoices: Array<{
        id: string;
        number: string;
        amount: number;
        status: string;
        date: string;
        pdfUrl?: string;
      }>;
    }>
  >;
  stopWorkspace(id: string): Promise<CloudApiResult<{ success: boolean; message: string }>>;
  deleteWorkspace(id: string): Promise<CloudApiResult<{ success: boolean; message: string }>>;
  addReposToWorkspace(
    workspaceId: string,
    repositoryIds: string[]
  ): Promise<CloudApiResult<{ success: boolean; message: string }>>;
  setCustomDomain(workspaceId: string, domain: string): Promise<
    CloudApiResult<{
      success: boolean;
      domain: string;
      status: string;
      instructions: {
        type: string;
        name: string;
        value: string;
        ttl: number;
      };
      verifyEndpoint: string;
      message: string;
    }>
  >;
  verifyCustomDomain(workspaceId: string): Promise<
    CloudApiResult<{
      success: boolean;
      status: string;
      domain?: string;
      message?: string;
      error?: string;
    }>
  >;
  removeCustomDomain(workspaceId: string): Promise<CloudApiResult<{ success: boolean; message: string }>>;
  getWorkspaceDetails(id: string): Promise<
    CloudApiResult<{
      id: string;
      name: string;
      status: string;
      publicUrl?: string;
      computeProvider: string;
      config: {
        providers: string[];
        repositories: string[];
        supervisorEnabled?: boolean;
        maxAgents?: number;
      };
      customDomain?: string;
      customDomainStatus?: string;
      errorMessage?: string;
      repositories: Array<{
        id: string;
        fullName: string;
        syncStatus: string;
        lastSyncedAt?: string;
      }>;
      createdAt: string;
      updatedAt: string;
    }>
  >;
  getRepos(): Promise<
    CloudApiResult<{
      repositories: Array<{
        id: string;
        fullName: string;
        isPrivate: boolean;
        defaultBranch: string;
        syncStatus: string;
        hasNangoConnection: boolean;
        lastSyncedAt?: string;
      }>;
    }>
  >;
  syncRepo(repoId: string): Promise<
    CloudApiResult<{
      message: string;
      syncStatus: string;
      result?: unknown;
    }>
  >;
  spawnAgent(
    workspaceId: string,
    params: {
      name: string;
      provider?: string;
      task?: string;
      cwd?: string;
      model?: string;
    }
  ): Promise<
    CloudApiResult<{
      name: string;
      sandboxId: string;
      status: string;
      cli: string;
      workspaceId: string;
      createdAt: string;
    }>
  >;
  getAgents(workspaceId: string): Promise<
    CloudApiResult<{
      agents: Array<{
        name: string;
        sandboxId: string;
        status: string;
        cli: string;
        workspaceId: string;
        createdAt: string;
      }>;
      workspaceId: string;
    }>
  >;
  stopAgent(workspaceId: string, agentName: string): Promise<CloudApiResult<{ success: boolean }>>;
  getOnboardingNextStep(): Promise<unknown>;
}

export interface CloudAuthAdapter {
  checkSession(): Promise<SessionStatus>;
  getUser(): Promise<CloudApiResult<CloudUser>>;
  logout(): Promise<{ success: boolean; error?: string }>;
  redirectToLogin(): void;
  onSessionExpired(callback: SessionExpiredCallback): () => void;
}
