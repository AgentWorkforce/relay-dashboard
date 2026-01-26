/**
 * URL Routing Hook
 *
 * Manages URL state for deep linking to channels, DMs, and settings.
 * Supports browser back/forward navigation.
 */

import { useEffect, useCallback, useRef } from 'react';

export type RouteType = 'activity' | 'channel' | 'dm' | 'agent' | 'settings';

export interface Route {
  type: RouteType;
  id?: string;
  tab?: 'dashboard' | 'workspace' | 'team' | 'billing';
}

/**
 * Parse the current URL path into a Route object
 */
export function parseRoute(pathname: string): Route {
  // Remove leading slash and split
  const parts = pathname.replace(/^\//, '').split('/').filter(Boolean);

  if (parts.length === 0 || parts[0] === 'app') {
    // Check for nested routes under /app
    if (parts[0] === 'app' && parts.length > 1) {
      return parseRoute('/' + parts.slice(1).join('/'));
    }
    return { type: 'activity' };
  }

  switch (parts[0]) {
    case 'channel':
      return { type: 'channel', id: parts[1] || undefined };
    case 'dm':
      return { type: 'dm', id: parts[1] || undefined };
    case 'agent':
      return { type: 'agent', id: parts[1] || undefined };
    case 'settings':
      const validTabs = ['dashboard', 'workspace', 'team', 'billing'];
      const tab = parts[1] && validTabs.includes(parts[1])
        ? parts[1] as Route['tab']
        : 'dashboard';
      return { type: 'settings', tab };
    default:
      return { type: 'activity' };
  }
}

/**
 * Build a URL path from a Route object
 */
export function buildPath(route: Route): string {
  const base = '/app';

  switch (route.type) {
    case 'channel':
      return route.id ? `${base}/channel/${encodeURIComponent(route.id)}` : base;
    case 'dm':
      return route.id ? `${base}/dm/${encodeURIComponent(route.id)}` : base;
    case 'agent':
      return route.id ? `${base}/agent/${encodeURIComponent(route.id)}` : base;
    case 'settings':
      return route.tab && route.tab !== 'dashboard'
        ? `${base}/settings/${route.tab}`
        : `${base}/settings`;
    case 'activity':
    default:
      return base;
  }
}

export interface UseUrlRoutingOptions {
  onRouteChange: (route: Route) => void;
}

/**
 * Hook for managing URL-based routing
 */
export function useUrlRouting({ onRouteChange }: UseUrlRoutingOptions) {
  const isNavigatingRef = useRef(false);
  const lastPathRef = useRef<string>('');

  // Navigate to a new route
  const navigate = useCallback((route: Route, replace = false) => {
    if (typeof window === 'undefined') return;

    const path = buildPath(route);

    // Don't push if we're already at this path
    if (path === window.location.pathname) return;

    isNavigatingRef.current = true;
    lastPathRef.current = path;

    if (replace) {
      window.history.replaceState({ route }, '', path);
    } else {
      window.history.pushState({ route }, '', path);
    }

    // Reset navigation flag after a tick
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 0);
  }, []);

  // Navigate to channel
  const navigateToChannel = useCallback((channelId: string) => {
    navigate({ type: 'channel', id: channelId });
  }, [navigate]);

  // Navigate to DM
  const navigateToDm = useCallback((username: string) => {
    navigate({ type: 'dm', id: username });
  }, [navigate]);

  // Navigate to agent
  const navigateToAgent = useCallback((agentName: string) => {
    navigate({ type: 'agent', id: agentName });
  }, [navigate]);

  // Navigate to settings
  const navigateToSettings = useCallback((tab?: Route['tab']) => {
    navigate({ type: 'settings', tab });
  }, [navigate]);

  // Navigate to activity feed
  const navigateToActivity = useCallback(() => {
    navigate({ type: 'activity' });
  }, [navigate]);

  // Close settings (go back or to activity)
  const closeSettings = useCallback(() => {
    if (typeof window === 'undefined') return;

    // If there's history, go back; otherwise go to activity
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ type: 'activity' });
    }
  }, [navigate]);

  // Handle popstate (browser back/forward)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = (event: PopStateEvent) => {
      // Parse current URL
      const route = parseRoute(window.location.pathname);
      lastPathRef.current = window.location.pathname;
      onRouteChange(route);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [onRouteChange]);

  // Parse initial route on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const currentPath = window.location.pathname;

    // Only process if path is different from last processed
    if (currentPath !== lastPathRef.current) {
      lastPathRef.current = currentPath;
      const route = parseRoute(currentPath);

      // Only trigger route change if we have a specific route
      if (route.type !== 'activity' || currentPath.includes('/app')) {
        onRouteChange(route);
      }
    }
  }, [onRouteChange]);

  return {
    navigate,
    navigateToChannel,
    navigateToDm,
    navigateToAgent,
    navigateToSettings,
    navigateToActivity,
    closeSettings,
    parseRoute,
    buildPath,
  };
}
