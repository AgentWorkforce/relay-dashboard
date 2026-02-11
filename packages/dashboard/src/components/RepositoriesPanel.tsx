/**
 * RepositoriesPanel - Unified Repository Management
 *
 * Consolidated view of all repositories the user has access to.
 * Shows GitHub App connected repos at top, then all accessible repos.
 *
 * Button logic:
 * - If repo is already in workspace → "Connected"
 * - If GitHub App has access BUT not in workspace → "Add to Workspace"
 * - If GitHub App does NOT have access → "Enable Access" (triggers reconnect flow)
 *
 * Uses:
 * - GET /api/repos/accessible - List repos user can access via GitHub OAuth
 * - GET /api/repos/check-github-app-access/:owner/:repo - Check GitHub App access
 * - POST /api/workspaces/:id/repos - Add repo to workspace
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Nango from '@nangohq/frontend';

interface GitHubAppAccessResult {
  hasAccess: boolean;
  needsReconnect: boolean;
  reason?: string;
  message?: string;
  connectionId?: string;
  source?: 'own' | 'shared';
}

interface AccessibleRepo {
  id: number;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  permissions: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

interface WorkspaceRepo {
  id: string;
  fullName: string;
  syncStatus: string;
}

export interface RepositoriesPanelProps {
  /** Current workspace ID to add repos to */
  workspaceId: string;
  /** Repos already in the workspace */
  workspaceRepos?: WorkspaceRepo[];
  /** Callback when a repo is added to the workspace */
  onRepoAdded?: (repoFullName: string) => void;
  /** Callback when a repo is removed from the workspace */
  onRepoRemoved?: (repoFullName: string) => void;
  /** CSRF token for mutations */
  csrfToken?: string;
  /** Custom class name */
  className?: string;
}

type LoadingState = 'idle' | 'loading' | 'loaded' | 'error';

interface RepoWithStatus extends AccessibleRepo {
  gitHubAppAccess: 'unknown' | 'checking' | 'has_access' | 'no_access';
  isInWorkspace: boolean;
}

function getPermissionLevel(permissions: { admin: boolean; push: boolean; pull: boolean }): {
  level: 'admin' | 'write' | 'read';
  label: string;
  color: string;
} {
  if (permissions.admin) {
    return { level: 'admin', label: 'Admin', color: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30' };
  }
  if (permissions.push) {
    return { level: 'write', label: 'Write', color: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30' };
  }
  return { level: 'read', label: 'Read', color: 'text-text-muted bg-bg-tertiary border-border-subtle' };
}

// Icons
const GitHubIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

const SearchIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const LockIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
);

const CheckIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const REPOS_PER_PAGE = 25;

interface SearchResult {
  id: number;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  description?: string;
  permissions: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export function RepositoriesPanel({
  workspaceId,
  workspaceRepos = [],
  onRepoAdded,
  onRepoRemoved,
  csrfToken,
  className = '',
}: RepositoriesPanelProps) {
  const [repos, setRepos] = useState<RepoWithStatus[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isGitHubNotConnected, setIsGitHubNotConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Search state
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Action states
  const [addingRepo, setAddingRepo] = useState<string | null>(null);
  const [removingRepo, setRemovingRepo] = useState<string | null>(null);
  const [checkingAccess, setCheckingAccess] = useState<Set<string>>(new Set());

  // GitHub OAuth state (for initial connection when not connected)
  const nangoRef = useRef<InstanceType<typeof Nango> | null>(null);
  const [isNangoReady, setIsNangoReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // GitHub App reconnect state
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [pendingRepoForAdd, setPendingRepoForAdd] = useState<string | null>(null);
  const [reconnectSuccessful, setReconnectSuccessful] = useState(false);

  // GitHub App accessible repos (fetched once on load)
  const [githubAppRepos, setGithubAppRepos] = useState<Set<string>>(new Set());
  const [hasGitHubAppConnection, setHasGitHubAppConnection] = useState(false);

  // Build a set of repos already in workspace (memoized to prevent re-renders)
  const workspaceRepoSet = React.useMemo(
    () => new Set(workspaceRepos.map(r => r.fullName.toLowerCase())),
    [workspaceRepos]
  );

  // Fetch accessible repos
  const fetchRepos = useCallback(async (page = 1, append = false) => {
    if (!append) {
      setLoadingState('loading');
    }
    setError(null);

    try {
      const response = await fetch(`/api/repos/accessible?perPage=${REPOS_PER_PAGE}&page=${page}`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (!response.ok) {
        if (data.code === 'NANGO_NOT_CONNECTED') {
          setIsGitHubNotConnected(true);
        }
        throw new Error(data.error || 'Failed to fetch repositories');
      }

      const accessibleRepos: AccessibleRepo[] = data.repositories || [];

      // Convert to RepoWithStatus (isInWorkspace will be computed from workspaceRepoSet)
      const reposWithStatus: RepoWithStatus[] = accessibleRepos.map(repo => ({
        ...repo,
        gitHubAppAccess: 'unknown' as const,
        isInWorkspace: false, // Will be computed in render based on workspaceRepoSet
      }));

      if (append) {
        setRepos(prev => [...prev, ...reposWithStatus]);
      } else {
        setRepos(reposWithStatus);
      }
      setCurrentPage(page);
      setHasMore(data.pagination?.hasMore || false);
      setLoadingState('loaded');
      setIsGitHubNotConnected(false);
    } catch (err) {
      console.error('Error fetching repos:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch repositories');
      setLoadingState('error');
    }
  }, []);

  // Fetch GitHub App accessible repos (to know which repos can be added directly)
  const fetchGitHubAppRepos = useCallback(async () => {
    try {
      const response = await fetch('/api/repos/github-app-accessible', {
        credentials: 'include',
      });
      const data = await response.json();

      if (response.ok && data.repositories) {
        const repoNames: string[] = data.repositories.map(
          (r: { fullName: string }) => r.fullName.toLowerCase()
        );
        setGithubAppRepos(new Set(repoNames));
        setHasGitHubAppConnection(data.hasConnection || false);
      }
    } catch (err) {
      console.error('Error fetching GitHub App repos:', err);
    }
  }, []);

  // Initial fetch - get both user repos and GitHub App repos
  useEffect(() => {
    fetchRepos();
    fetchGitHubAppRepos();
  }, [fetchRepos, fetchGitHubAppRepos]);

  // Initialize Nango when GitHub is not connected
  useEffect(() => {
    if (!isGitHubNotConnected) return;

    let mounted = true;

    const initNango = async () => {
      try {
        const response = await fetch('/api/auth/nango/login-session', {
          credentials: 'include',
        });
        const data = await response.json();

        if (!mounted) return;

        if (response.ok && data.sessionToken) {
          nangoRef.current = new Nango({ connectSessionToken: data.sessionToken });
          setIsNangoReady(true);
        }
      } catch (err) {
        console.error('Failed to initialize Nango:', err);
      }
    };

    initNango();
    return () => { mounted = false; };
  }, [isGitHubNotConnected]);

  // Check GitHub App access for a specific repo
  const checkGitHubAppAccess = useCallback(async (repoFullName: string): Promise<GitHubAppAccessResult> => {
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) {
      return { hasAccess: false, needsReconnect: false, message: 'Invalid repository name' };
    }

    try {
      const response = await fetch(`/api/repos/check-github-app-access/${owner}/${repo}`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (!response.ok) {
        return { hasAccess: false, needsReconnect: true, message: data.error || 'Failed to check access' };
      }

      return data as GitHubAppAccessResult;
    } catch (err) {
      console.error('Error checking GitHub App access:', err);
      return { hasAccess: false, needsReconnect: true, message: 'Failed to check access' };
    }
  }, []);

  // Update repo's GitHub App access status
  const updateRepoAccessStatus = useCallback((repoFullName: string, status: RepoWithStatus['gitHubAppAccess']) => {
    setRepos(prev => prev.map(repo =>
      repo.fullName === repoFullName ? { ...repo, gitHubAppAccess: status } : repo
    ));
  }, []);

  // Handle GitHub App reconnect to add a repo
  const handleReconnectGitHubApp = useCallback(async (repoFullName: string) => {
    setIsReconnecting(true);
    setPendingRepoForAdd(repoFullName);
    setReconnectSuccessful(false);
    setError(null);

    try {
      // First, try to get a reconnect session (for existing connections)
      let sessionResponse = await fetch('/api/auth/nango/repo-reconnect-session', {
        credentials: 'include',
      });
      let sessionData = await sessionResponse.json();

      // If no existing connection, fall back to regular connect flow
      if (!sessionResponse.ok || sessionData.code === 'NO_EXISTING_CONNECTION') {
        sessionResponse = await fetch('/api/auth/nango/repo-session', {
          credentials: 'include',
        });
        sessionData = await sessionResponse.json();
      }

      if (!sessionResponse.ok || !sessionData.sessionToken) {
        setError('Failed to initialize GitHub connection. Please refresh the page.');
        setIsReconnecting(false);
        setPendingRepoForAdd(null);
        return;
      }

      // Create Nango instance with the session token
      const nangoInstance = new Nango({ connectSessionToken: sessionData.sessionToken });

      // Open the GitHub App installation popup (fire-and-forget).
      // The popup may not close automatically for GitHub App OAuth flows,
      // so we don't await the result. Instead, poll for repo access directly.
      nangoInstance.auth('github-app-oauth').catch((err: unknown) => {
        const authErr = err as Error & { type?: string };
        // Only log non-cancellation errors; user closing popup is expected
        if (authErr.type !== 'user_cancelled' && !authErr.message?.includes('closed')) {
          console.error('GitHub App auth background error:', authErr);
        }
      });

      // Poll check-github-app-access for the specific repo being added.
      // The webhook will sync the repo to the DB, and this endpoint checks
      // whether the GitHub App installation now includes the target repo.
      const [owner, repo] = repoFullName.split('/');
      const pollForAccess = async (attempts = 0): Promise<boolean> => {
        if (attempts > 60) {
          throw new Error('Connection timed out. Please try again.');
        }

        try {
          const accessRes = await fetch(`/api/repos/check-github-app-access/${owner}/${repo}`, {
            credentials: 'include',
          });
          const accessData = await accessRes.json();

          if (accessData.hasAccess) {
            return true;
          }
        } catch {
          // Network error - continue polling
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        return pollForAccess(attempts + 1);
      };

      const success = await pollForAccess();
      if (success) {
        setReconnectSuccessful(true);
        setIsReconnecting(false);
      }
    } catch (err: unknown) {
      const error = err as Error & { type?: string };
      console.error('GitHub App reconnect error:', error);
      setError(error.message || 'Failed to reconnect GitHub');
      setPendingRepoForAdd(null);
      setIsReconnecting(false);
    }
  }, []);

  // Effect to add repo after successful reconnect
  useEffect(() => {
    if (reconnectSuccessful && pendingRepoForAdd && !isReconnecting) {
      const repoName = pendingRepoForAdd;
      setReconnectSuccessful(false);
      setPendingRepoForAdd(null);
      // Update repo status and try to add to workspace
      updateRepoAccessStatus(repoName, 'has_access');
      handleAddToWorkspace(repoName);
    }
  }, [reconnectSuccessful, pendingRepoForAdd, isReconnecting]);

  // Handle adding repo to workspace
  const handleAddToWorkspace = useCallback(async (repoFullName: string) => {
    setAddingRepo(repoFullName);
    setError(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const response = await fetch(`/api/workspaces/${workspaceId}/repos`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ repositoryFullName: repoFullName }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add repository');
      }

      // Callback will trigger parent to refresh workspaceRepos, which updates workspaceRepoSet
      onRepoAdded?.(repoFullName);
    } catch (err) {
      console.error('Error adding repo to workspace:', err);
      setError(err instanceof Error ? err.message : 'Failed to add repository');
    } finally {
      setAddingRepo(null);
    }
  }, [workspaceId, csrfToken, onRepoAdded]);

  // Remove repo from workspace
  const handleRemoveRepo = useCallback(async (repo: RepoWithStatus) => {
    // Find the workspace repo record to get its DB id
    const wsRepo = workspaceRepos.find(
      r => r.fullName.toLowerCase() === repo.fullName.toLowerCase()
    );
    if (!wsRepo) return;

    setRemovingRepo(repo.fullName);
    setError(null);

    try {
      const headers: Record<string, string> = {};
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const response = await fetch(`/api/workspaces/${workspaceId}/repos/${wsRepo.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove repository');
      }

      onRepoRemoved?.(repo.fullName);
    } catch (err) {
      console.error('Error removing repo from workspace:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove repository');
    } finally {
      setRemovingRepo(null);
    }
  }, [workspaceId, workspaceRepos, csrfToken, onRepoRemoved]);

  // Handle button click - check access and either add or reconnect
  const handleRepoAction = useCallback(async (repo: RepoWithStatus) => {
    if (repo.isInWorkspace) return; // Already connected

    // If we already know it has access, add directly
    if (repo.gitHubAppAccess === 'has_access') {
      await handleAddToWorkspace(repo.fullName);
      return;
    }

    // Check GitHub App access first
    setCheckingAccess(prev => new Set(prev).add(repo.fullName));
    updateRepoAccessStatus(repo.fullName, 'checking');

    const accessResult = await checkGitHubAppAccess(repo.fullName);

    setCheckingAccess(prev => {
      const next = new Set(prev);
      next.delete(repo.fullName);
      return next;
    });

    if (accessResult.hasAccess) {
      updateRepoAccessStatus(repo.fullName, 'has_access');
      await handleAddToWorkspace(repo.fullName);
    } else {
      updateRepoAccessStatus(repo.fullName, 'no_access');
      // Trigger reconnect flow
      await handleReconnectGitHubApp(repo.fullName);
    }
  }, [checkGitHubAppAccess, handleAddToWorkspace, handleReconnectGitHubApp, updateRepoAccessStatus]);

  // Handle GitHub OAuth connection
  const handleConnectGitHub = async () => {
    if (!nangoRef.current) {
      setConnectError('GitHub connection not available. Please refresh the page.');
      return;
    }

    setIsConnecting(true);
    setConnectError(null);

    try {
      await nangoRef.current.auth('github');
      // Reload the page to refresh auth state
      window.location.reload();
    } catch (err: unknown) {
      const error = err as Error & { type?: string };
      if (error.type !== 'user_cancelled') {
        setConnectError(error.message || 'Failed to connect GitHub');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  // Load more repos from server
  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      await fetchRepos(currentPage + 1, true);
    } finally {
      setLoadingMore(false);
    }
  };

  // Search repos via GitHub API
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`/api/repos/search?q=${encodeURIComponent(query)}`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (response.ok) {
        // Map search results to match our format
        const results: SearchResult[] = (data.repositories || []).map((r: {
          githubId: number;
          fullName: string;
          isPrivate: boolean;
          defaultBranch: string;
          description?: string;
        }) => ({
          id: r.githubId,
          fullName: r.fullName,
          isPrivate: r.isPrivate,
          defaultBranch: r.defaultBranch,
          description: r.description,
          permissions: { admin: false, push: true, pull: true }, // Assume write access since they found it
        }));
        setSearchResults(results);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (value.trim()) {
      searchTimeoutRef.current = setTimeout(() => {
        handleSearch(value);
      }, 300);
    } else {
      setSearchResults([]);
    }
  }, [handleSearch]);

  // When searching, use search results; otherwise use fetched repos
  const displayRepos = React.useMemo(() => {
    // Helper to determine GitHub App access status
    const getGitHubAppAccess = (fullName: string): RepoWithStatus['gitHubAppAccess'] => {
      if (githubAppRepos.has(fullName.toLowerCase())) {
        return 'has_access';
      }
      return hasGitHubAppConnection ? 'no_access' : 'unknown';
    };

    if (searchQuery.trim() && searchResults.length > 0) {
      // Convert search results to RepoWithStatus format
      return searchResults.map(r => ({
        ...r,
        gitHubAppAccess: getGitHubAppAccess(r.fullName),
        isInWorkspace: workspaceRepoSet.has(r.fullName.toLowerCase()),
      }));
    }

    // No search - add isInWorkspace and gitHubAppAccess
    return repos.map(repo => ({
      ...repo,
      gitHubAppAccess: getGitHubAppAccess(repo.fullName),
      isInWorkspace: workspaceRepoSet.has(repo.fullName.toLowerCase()),
    }));
  }, [repos, searchResults, searchQuery, workspaceRepoSet, githubAppRepos, hasGitHubAppConnection]);

  // Split repos into workspace repos and other repos
  const inWorkspaceRepos = displayRepos.filter(r => r.isInWorkspace);

  // Sort available repos: GitHub App accessible first, then others
  const availableRepos = displayRepos
    .filter(r => !r.isInWorkspace)
    .sort((a, b) => {
      // GitHub App access repos first
      if (a.gitHubAppAccess === 'has_access' && b.gitHubAppAccess !== 'has_access') return -1;
      if (a.gitHubAppAccess !== 'has_access' && b.gitHubAppAccess === 'has_access') return 1;
      return 0;
    });

  // Show load more only when not searching
  const showLoadMore = !searchQuery.trim() && hasMore;

  // Loading state
  if (loadingState === 'loading') {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <div className="text-center">
          <svg className="w-8 h-8 text-accent-cyan animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-4 text-text-muted">Loading repositories...</p>
        </div>
      </div>
    );
  }

  // Error state - GitHub not connected
  if (loadingState === 'error' && isGitHubNotConnected) {
    return (
      <div className={`p-6 ${className}`}>
        <div className="bg-bg-tertiary border border-border-subtle rounded-xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-bg-hover rounded-full flex items-center justify-center">
            <GitHubIcon className="w-8 h-8 text-text-muted" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary mb-2">Connect GitHub</h3>
          <p className="text-text-muted mb-6 max-w-md mx-auto">
            Connect your GitHub account to see your repositories and enable agent access to your code.
          </p>
          {connectError && (
            <p className="text-error text-sm mb-4">{connectError}</p>
          )}
          <button
            onClick={handleConnectGitHub}
            disabled={!isNangoReady || isConnecting}
            className="px-6 py-3 bg-gradient-to-r from-accent-cyan to-[#00b8d9] text-bg-deep font-medium rounded-lg hover:shadow-glow-cyan transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isConnecting ? 'Connecting...' : !isNangoReady ? 'Loading...' : (
              <span className="flex items-center gap-2">
                <GitHubIcon className="w-5 h-5" />
                Connect GitHub Account
              </span>
            )}
          </button>
        </div>
      </div>
    );
  }

  // General error state
  if (loadingState === 'error') {
    return (
      <div className={`p-6 ${className}`}>
        <div className="bg-error/10 border border-error/20 rounded-xl p-4 text-center">
          <p className="text-error mb-4">{error}</p>
          <button
            onClick={() => fetchRepos()}
            className="px-4 py-2 bg-bg-tertiary border border-border-subtle rounded-lg text-text-primary hover:bg-bg-hover transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const renderRepoItem = (repo: RepoWithStatus) => {
    const permission = getPermissionLevel(repo.permissions);
    const isAdding = addingRepo === repo.fullName;
    const isChecking = checkingAccess.has(repo.fullName) || repo.gitHubAppAccess === 'checking';
    const isReconnectingThis = isReconnecting && pendingRepoForAdd === repo.fullName;

    return (
      <div
        key={repo.id}
        className="flex items-center justify-between p-4 hover:bg-bg-hover transition-colors"
      >
        {/* Repo info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <GitHubIcon className="w-5 h-5 text-text-muted flex-shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-text-primary truncate">{repo.fullName}</span>
              {repo.isPrivate && (
                <LockIcon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs px-1.5 py-0.5 rounded border ${permission.color}`}>
                {permission.label}
              </span>
              <span className="text-xs text-text-muted">{repo.defaultBranch}</span>
            </div>
          </div>
        </div>

        {/* Action button */}
        <div className="flex-shrink-0 ml-4">
          {repo.isInWorkspace ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-success bg-success/10 border border-success/30 rounded-lg">
                <CheckIcon className="w-4 h-4" />
                In Workspace
              </span>
              <button
                onClick={() => handleRemoveRepo(repo)}
                disabled={removingRepo === repo.fullName}
                className="p-1.5 text-text-muted hover:text-error hover:bg-error/10 rounded-md transition-colors disabled:opacity-50"
                title="Remove from workspace"
              >
                {removingRepo === repo.fullName ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleRepoAction(repo)}
              disabled={isAdding || isChecking || isReconnectingThis}
              className="px-4 py-2 text-sm bg-gradient-to-r from-accent-cyan to-[#00b8d9] text-bg-deep font-medium rounded-lg hover:shadow-glow-cyan transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isChecking ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Checking...
                </span>
              ) : isReconnectingThis ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Connecting...
                </span>
              ) : isAdding ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Adding...
                </span>
              ) : repo.gitHubAppAccess === 'has_access' ? (
                'Add to Workspace'
              ) : repo.gitHubAppAccess === 'no_access' ? (
                'Enable Access'
              ) : (
                'Add'
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={className}>
      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-error/10 border border-error/20 rounded-lg">
          <p className="text-error text-sm">{error}</p>
        </div>
      )}

      {/* Search */}
      <div className="p-4 border-b border-border-subtle">
        <div className="relative">
          <SearchIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search your GitHub repositories..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-bg-tertiary border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/50 transition-colors"
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg className="w-4 h-4 text-text-muted animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
        </div>
        {searchQuery.trim() && (
          <p className="mt-2 text-xs text-text-muted">
            {isSearching ? 'Searching...' : searchResults.length > 0 ? `Found ${searchResults.length} results` : 'No results found. Try a different search term.'}
          </p>
        )}
      </div>

      {/* Repos in this workspace */}
      {inWorkspaceRepos.length > 0 && (
        <div className="border-b border-border-subtle">
          <div className="px-4 py-3 bg-bg-tertiary/50">
            <h3 className="text-sm font-semibold text-text-primary">
              In This Workspace ({inWorkspaceRepos.length})
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              Repositories already added to this workspace
            </p>
          </div>
          <div className="divide-y divide-border-subtle">
            {inWorkspaceRepos.map(renderRepoItem)}
          </div>
        </div>
      )}

      {/* Available repos section */}
      <div>
        <div className="px-4 py-3 bg-bg-tertiary/50 border-b border-border-subtle">
          <h3 className="text-sm font-semibold text-text-primary">
            {searchQuery.trim() ? 'Search Results' : 'Available Repositories'} ({availableRepos.length})
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            {searchQuery.trim() ? 'Matching repositories from GitHub' : 'Repositories you have access to on GitHub'}
          </p>
        </div>

        {availableRepos.length > 0 ? (
          <>
            <div className="divide-y divide-border-subtle">
              {availableRepos.map(renderRepoItem)}
            </div>

            {/* Load more button - only when not searching */}
            {showLoadMore && (
              <div className="p-4 border-t border-border-subtle">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="w-full py-2 text-sm text-accent-cyan hover:text-accent-cyan/80 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Loading more...
                    </span>
                  ) : 'Load More Repositories'}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="p-8 text-center">
            <p className="text-text-muted">
              {searchQuery.trim() ? 'No repositories match your search' : 'No additional repositories available'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
