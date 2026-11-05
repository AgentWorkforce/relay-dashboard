// Graph label-spacing repair ported from Cloud fa7fec58a.
// Ported from Cloud session visualizations, head55bfc58fb.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLink as Link } from "./app-link";
import Markdown from "react-markdown";

import {
  ArrowRight,
  ChevronRight,
  List,
  Search,
  RefreshCw,
} from "lucide-react";
import { Button } from "../../shell/ui";
import { WorkspaceViewSlot } from "../../shell/view-slots";
import {
  fetchSessionPage,
  SessionsAuthorizationError,
} from "./graph-client";
import {
  exactTime,
  relativeTime,
  tools as sourceTools,
  type SessionRow,
} from "./session-data";
import {
  buildSessionWorkGraph,
  sessionGraphKey,
  type SessionGraphEvidence,
  type SessionGraphNode,
  type SessionGraphEdge,
} from "./session-graph-data";
import {
  layoutSessionGraph,
  GRAPH_CARD_HEIGHT,
  GRAPH_CARD_WIDTH,
} from "./graph-layout";
import { listHref, sessionHref } from "../route";
import type { SessionGraphDetail } from "./graph-client";
import styles from "./sessions-graph.module.css";

type Props = {
  onSignedOut?: () => void;
  accountId: string;
  workspaceId: string;
  initialNow: number;
  initialFocus?: { source: string; sessionId: string };
  loadDetail: (
    workspaceId: string,
    source: string,
    sessionId: string,
  ) => Promise<SessionGraphDetail>;
  loadRelationships?: (
    workspaceId: string,
    sessions: Array<{ source: string; sessionId: string }>,
  ) => Promise<{
    evidence: SessionGraphEvidence[];
    failed: Array<{ source: string; sessionId: string }>;
  }>;
};

function sourceLabel(source: string) {
  return sourceTools[source]?.label ?? source;
}

function relationshipLabel(
  edge: Pick<SessionGraphEdge, "relationship" | "provenance">,
) {
  if (edge.provenance === "catalog_summary") return "Parent recorded";
  return {
    delegated: "Delegated",
    materialized_local: "Local child",
    continuation: "Continued",
    fork: "Forked",
    resume: "Resumed",
    unknown: "Related",
  }[edge.relationship];
}

function cardTitle(node: SessionGraphNode) {
  return (
    node.title?.trim() ||
    (node.present ? "Untitled session" : "Session outside loaded results")
  );
}

function isControlOnlyRequest(value: string) {
  return /^\s*<external_codex_apps_[\w-]+(?:\s[^>]*)?>/i.test(value);
}

function mergeEvidence(
  previous: SessionGraphEvidence | undefined,
  incoming: SessionGraphEvidence,
): SessionGraphEvidence {
  if (!previous) return incoming;
  const priorReplay = previous.replay;
  const nextReplay = incoming.replay;
  const mergedReplay = mergeReplay(priorReplay, nextReplay);
  return {
    ...previous,
    ...incoming,
    catalog:
      incoming.catalog === undefined ||
      (incoming.catalog === null && previous.catalog)
        ? previous.catalog
        : incoming.catalog,
    replay: mergedReplay,
    pullRequests:
      incoming.pullRequests?.length || !previous.pullRequests?.length
        ? incoming.pullRequests
        : previous.pullRequests,
  };
}

function mergeReplay(
  previous: SessionGraphEvidence["replay"],
  incoming: SessionGraphEvidence["replay"],
): SessionGraphEvidence["replay"] {
  if (!previous) return incoming ?? previous;
  if (!incoming) return previous;
  const mergeEvents = <T extends { eventId: string; ts: string | null }>(
    first: T[],
    second: T[],
  ) =>
    [
      ...new Map(
        [...first, ...second].map((item) => [item.eventId, item]),
      ).values(),
    ].sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));
  const priorComplete =
    !previous.error && !previous.nextCursor && !previous.turnsNextCursor;
  const nextComplete =
    !incoming.error && !incoming.nextCursor && !incoming.turnsNextCursor;
  const preferred =
    (nextComplete && !priorComplete) ||
    (nextComplete === priorComplete &&
      incoming.events.length >= previous.events.length)
      ? incoming
      : previous;
  return {
    ...preferred,
    events: mergeEvents(previous.events, incoming.events),
    ...(previous.streams || incoming.streams
      ? {
          streams: {
            events: mergeEvents(
              previous.streams?.events ?? previous.events,
              incoming.streams?.events ?? incoming.events,
            ),
            turns: mergeEvents(
              previous.streams?.turns ?? [],
              incoming.streams?.turns ?? [],
            ),
          },
        }
      : {}),
  };
}

export function SessionsGraph({
  onSignedOut,
  accountId,
  workspaceId,
  initialNow,
  initialFocus,
  loadDetail,
  loadRelationships,
}: Props) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState(false);
  const [failedCursor, setFailedCursor] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [userFocused, setUserFocused] = useState(false);
  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(
    null,
  );
  const [focused, setFocused] = useState<{
    kind: "group" | "individual";
    id: string;
    anchorId?: string;
  } | null>(null);
  const [evidence, setEvidence] = useState<SessionGraphEvidence[]>([]);
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const [relationshipFailures, setRelationshipFailures] = useState<
    Array<{ source: string; sessionId: string }>
  >([]);
  const [relationshipScanned, setRelationshipScanned] = useState(0);
  const [relationshipRevision, setRelationshipRevision] = useState(0);
  const [detailErrors, setDetailErrors] = useState<Record<string, boolean>>({});
  const [contextualLoading, setContextualLoading] = useState(false);
  const [contextualUnavailable, setContextualUnavailable] = useState(false);
  const [detailLoadedIds, setDetailLoadedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [catalogErrors, setCatalogErrors] = useState<Record<string, boolean>>(
    {},
  );
  const [revision, setRevision] = useState(0);
  const [clockNow, setClockNow] = useState(initialNow);
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const controllers = useRef(new Set<AbortController>());
  const pageElement = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const groupScroll = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const relationshipQueue = useRef<
    Array<{ source: string; sessionId: string }>
  >([]);
  const relationshipQueued = useRef(new Set<string>());
  const relationshipAttempted = useRef(new Set<string>());
  const relationshipRunning = useRef<number | null>(null);
  const detailLoaded = useRef(new Set<string>());
  const contextualAttempted = useRef(new Set<string>());
  const selectSession = (id: string) => {
    setUserFocused(true);
    setSelected(id);
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 760px)").matches
    ) {
      inspector.current?.scrollIntoView({ block: "start" });
    }
  };

  const load = useCallback(
    async (cursor: string, signal: AbortSignal, currentGeneration: number) => {
      const page = await fetchSessionPage(
        accountId,
        workspaceId,
        "",
        cursor,
        revision > 0,
        signal,
      );
      if (page.error) throw new Error("Session list unavailable");
      if (signal.aborted || currentGeneration !== generation.current) return;
      setRows((current) => {
        if (!cursor) return page.items;
        const items = new Map(
          current.map((row) => [
            sessionGraphKey(row.source, row.sessionId),
            row,
          ]),
        );
        for (const row of page.items)
          items.set(sessionGraphKey(row.source, row.sessionId), row);
        return [...items.values()];
      });
      setNextCursor(page.nextCursor);
      if (!cursor) setLastRefreshAt(Date.now());
      setLoaded(true);

    },
    [accountId, workspaceId, revision],
  );

  useEffect(() => {
    if (blocked) return;
    const activeControllers = controllers.current;
    const controller = new AbortController();
    activeControllers.add(controller);
    const currentGeneration = generation.current;
    void load("", controller.signal, currentGeneration)
      .catch((error) => {
        if (
          controller.signal.aborted ||
          currentGeneration !== generation.current
        )
          return;
        if (error instanceof SessionsAuthorizationError) onSignedOut?.();
        setFailedCursor("");
        setFailure(true);
      })
      .finally(() => {
        activeControllers.delete(controller);
      });
    return () => {
      controller.abort();
      activeControllers.delete(controller);
    };
  }, [load, onSignedOut, blocked]);

  useEffect(() => {
    const activeControllers = controllers.current;
    const activeGeneration = generation;
    const clear = () => {
      activeGeneration.current++;
      activeControllers.forEach((controller) => controller.abort());
      activeControllers.clear();
      setBlocked(true);
      setRows([]);
      setEvidence([]);
      setSelected(null);
      setSelectedHandoffId(null);
      setLoaded(false);
      setNextCursor(null);
      setLastRefreshAt(null);
      setLoading(false);
      setDetailErrors({});
      setContextualLoading(false);
      setContextualUnavailable(false);
      setCatalogErrors({});
      relationshipQueue.current = [];
      relationshipQueued.current.clear();
      relationshipAttempted.current.clear();
      relationshipRunning.current = null;
      detailLoaded.current.clear();
      contextualAttempted.current.clear();
      setDetailLoadedIds(new Set());
      setRelationshipFailures([]);
      setRelationshipScanned(0);
      setRelationshipLoading(false);
    };
    const authFailure = () => onSignedOut?.();
    window.addEventListener("sessions-cache-clear", clear);
    window.addEventListener("sessions-auth-failure", authFailure);
    return () => {
      activeGeneration.current++;
      activeControllers.forEach((controller) => controller.abort());
      activeControllers.clear();
      window.removeEventListener("sessions-cache-clear", clear);
      window.removeEventListener("sessions-auth-failure", authFailure);
    };
  }, [onSignedOut]);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const element = pageElement.current;
    if (!element) return;
    const update = (width: number) => {
      if (width > 0) setContentWidth(Math.round(width));
    };
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        update(entries[0]?.contentRect.width ?? 0);
      });
      observer.observe(element);
      return () => observer.disconnect();
    }
    const onResize = () => update(element.getBoundingClientRect().width);
    queueMicrotask(onResize);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const more = async () => {
    if (!nextCursor || loading || blocked) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    const currentGeneration = generation.current;
    setLoading(true);
    setFailure(false);
    try {
      await load(nextCursor, controller.signal, currentGeneration);
    } catch (error) {
      if (controller.signal.aborted || currentGeneration !== generation.current)
        return;
      if (error instanceof SessionsAuthorizationError) onSignedOut?.();
      setFailedCursor(nextCursor);
      setFailure(true);
    } finally {
      controllers.current.delete(controller);
      if (currentGeneration === generation.current) setLoading(false);
    }
  };
  const refresh = () => {
    generation.current++;
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    setRows([]);
    setEvidence([]);
    setSelectedHandoffId(null);
    setNextCursor(null);
    setLoaded(false);
    setFailure(false);
    setFailedCursor(null);
    setLastRefreshAt(null);
    setLoading(false);
    setDetailErrors({});
    setContextualLoading(false);
    setContextualUnavailable(false);
    setCatalogErrors({});
    relationshipQueue.current = [];
    relationshipQueued.current.clear();
    relationshipAttempted.current.clear();
    relationshipRunning.current = null;
    detailLoaded.current.clear();
    contextualAttempted.current.clear();
    setDetailLoadedIds(new Set());
    setRelationshipFailures([]);
    setRelationshipScanned(0);
    setRelationshipLoading(false);
    setRevision((value) => value + 1);
  };
  const drainRelationships = useCallback(async () => {
    if (
      !loadRelationships ||
      relationshipRunning.current === generation.current ||
      blocked
    )
      return;
    const currentGeneration = generation.current;
    relationshipRunning.current = currentGeneration;
    setRelationshipLoading(true);
    try {
      while (
        relationshipQueue.current.length &&
        currentGeneration === generation.current
      ) {
        const batch = relationshipQueue.current.splice(0, 4);
        let result: Awaited<
          ReturnType<NonNullable<Props["loadRelationships"]>>
        >;
        try {
          result = await loadRelationships(workspaceId, batch);
        } catch {
          result = { evidence: [], failed: batch };
        }
        if (currentGeneration !== generation.current) return;
        const batchKeys = new Set(
          batch.map((item) => sessionGraphKey(item.source, item.sessionId)),
        );
        const validEvidence = result.evidence.filter((item) =>
          batchKeys.has(sessionGraphKey(item.source, item.sessionId)),
        );
        const failedKeys = new Set(
          result.failed
            .filter((item) =>
              batchKeys.has(sessionGraphKey(item.source, item.sessionId)),
            )
            .map((item) => sessionGraphKey(item.source, item.sessionId)),
        );
        for (const item of batch) {
          const key = sessionGraphKey(item.source, item.sessionId);
          relationshipQueued.current.delete(key);
          relationshipAttempted.current.add(key);
          if (
            !validEvidence.some(
              (entry) => sessionGraphKey(entry.source, entry.sessionId) === key,
            )
          )
            failedKeys.add(key);
        }
        setEvidence((current) => {
          const byKey = new Map(
            current.map((item) => [
              sessionGraphKey(item.source, item.sessionId),
              item,
            ]),
          );
          for (const item of validEvidence) {
            const key = sessionGraphKey(item.source, item.sessionId);
            byKey.set(key, mergeEvidence(byKey.get(key), item));
          }
          return [...byKey.values()];
        });
        setRelationshipFailures((current) => {
          const byKey = new Map(
            current.map((item) => [
              sessionGraphKey(item.source, item.sessionId),
              item,
            ]),
          );
          for (const item of batch) {
            const key = sessionGraphKey(item.source, item.sessionId);
            if (failedKeys.has(key)) byKey.set(key, item);
            else byKey.delete(key);
          }
          return [...byKey.values()];
        });
        setRelationshipScanned(relationshipAttempted.current.size);
      }
    } finally {
      if (relationshipRunning.current === currentGeneration)
        relationshipRunning.current = null;
      if (currentGeneration === generation.current)
        setRelationshipLoading(false);
    }
  }, [blocked, loadRelationships, workspaceId]);
  const retryRelationships = () => {
    for (const item of relationshipFailures)
      relationshipAttempted.current.delete(
        sessionGraphKey(item.source, item.sessionId),
      );
    setRelationshipFailures([]);
    setRelationshipRevision((value) => value + 1);
  };
  const graph = useMemo(
    () =>
      buildSessionWorkGraph(rows, evidence, {
        listHasMore: !!nextCursor,
        now: clockNow,
        workspaceId,
      }),
    [rows, evidence, nextCursor, clockNow, workspaceId],
  );
  // Read every loaded row, then at most 80 additional exact identities revealed
  // by recorded relationships. The queue remains bounded across recursive passes.
  const discoveryIdentities = useMemo(() => {
    const loaded = rows.filter((row) => !row.liveOnly && row.source && row.source !== "—" && row.sessionId);
    const relatives = graph.nodes.filter((node) => !node.present && node.source && node.source !== "—" && node.sessionId).slice(0, 80);
    return [...loaded, ...relatives];
  }, [rows, graph]);
  const relativeDiscoveryLimited = graph.nodes.filter((node) => !node.present).length > 80;
  useEffect(() => {
    if (!loadRelationships || blocked) return;
    for (const row of discoveryIdentities) {
      if (!row.source || row.source === "—" || !row.sessionId)
        continue;
      const key = sessionGraphKey(row.source, row.sessionId);
      if (
        relationshipAttempted.current.has(key) ||
        relationshipQueued.current.has(key)
      )
        continue;
      relationshipQueued.current.add(key);
      relationshipQueue.current.push({
        source: row.source,
        sessionId: row.sessionId,
      });
    }
    void drainRelationships();
  }, [
    discoveryIdentities,
    loadRelationships,
    blocked,
    relationshipRevision,
    drainRelationships,
  ]);
  const rowByKey = useMemo(
    () =>
      new Map(
        rows.map((row) => [sessionGraphKey(row.source, row.sessionId), row]),
      ),
    [rows],
  );
  const sources = useMemo(
    () => [...new Set(rows.map((row) => row.source))].sort(),
    [rows],
  );
  const matches = useCallback(
    (node: SessionGraphNode) => {
      if (source !== "all" && node.source !== source) return false;
      const text = query.trim().toLocaleLowerCase();
      if (!text) return true;
      const row = rowByKey.get(node.id);
      return [
        node.title,
        node.sessionId,
        node.source,
        row?.project?.name,
        row?.pullRequest?.number,
      ].some((value) => value?.toLocaleLowerCase().includes(text));
    },
    [query, source, rowByKey],
  );
  const priorityIds = useMemo(
    () =>
      new Set(
        graph.nodes
          .filter((node) => node.present && matches(node))
          .map((node) => node.id),
      ),
    [graph, matches],
  );
  const initialFocusId = initialFocus
    ? sessionGraphKey(initialFocus.source, initialFocus.sessionId)
    : null;
  const invalidInitialFocus =
    !!initialFocus &&
    (!initialFocus.source ||
      initialFocus.source === "—" ||
      initialFocus.source.length > 128 ||
      !initialFocus.sessionId ||
      initialFocus.sessionId.length > 512);
  const contextualNode = initialFocusId
    ? (graph.nodes.find((node) => node.id === initialFocusId) ?? null)
    : null;
  const requestedFocusMissing =
    !userFocused && !!initialFocusId && loaded && !contextualNode;
  useEffect(() => {
    if (
      !loaded ||
      blocked ||
      userFocused ||
      !initialFocus ||
      !initialFocusId ||
      invalidInitialFocus ||
      contextualNode ||
      contextualAttempted.current.has(initialFocusId)
    )
      return;
    contextualAttempted.current.add(initialFocusId);
    const currentGeneration = generation.current;
    let active = true;
    queueMicrotask(() => {
      if (active && currentGeneration === generation.current) {
        setContextualLoading(true);
        setContextualUnavailable(false);
      }
    });
    void loadDetail(workspaceId, initialFocus.source, initialFocus.sessionId)
      .then((detail) => {
        if (!active || currentGeneration !== generation.current) return;
        const catalog = detail.catalog;
        const catalogValid =
          !!catalog &&
          typeof catalog === "object" &&
          !Array.isArray(catalog) &&
          "source" in catalog &&
          catalog.source === initialFocus.source &&
          "sessionId" in catalog &&
          catalog.sessionId === initialFocus.sessionId &&
          "workspaceId" in catalog &&
          catalog.workspaceId === workspaceId &&
          "parents" in catalog &&
          Array.isArray(catalog.parents) &&
          "children" in catalog &&
          Array.isArray(catalog.children);
        const replay = detail.replay;
        const replayValid =
          !!replay &&
          (!replay.source || replay.source === initialFocus.source) &&
          (replay.events.length > 0 ||
            !!replay.streams?.events.length ||
            !!replay.streams?.turns.length);
        if (!catalogValid && !replayValid) {
          setContextualUnavailable(true);
          return;
        }
        detailLoaded.current.add(initialFocusId);
        setDetailLoadedIds(new Set(detailLoaded.current));
        setEvidence((current) => {
          const prior = current.find(
            (item) =>
              sessionGraphKey(item.source, item.sessionId) === initialFocusId,
          );
          return [
            ...current.filter(
              (item) =>
                sessionGraphKey(item.source, item.sessionId) !== initialFocusId,
            ),
            mergeEvidence(prior, {
              source: initialFocus.source,
              sessionId: initialFocus.sessionId,
              catalog: catalogValid ? detail.catalog : null,
              replay: replayValid ? detail.replay : null,
              pullRequests: detail.pullRequests,
            }),
          ];
        });
      })
      .catch(() => {
        if (active && currentGeneration === generation.current)
          setContextualUnavailable(true);
      })
      .finally(() => {
        if (active && currentGeneration === generation.current)
          setContextualLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    loaded,
    blocked,
    userFocused,
    initialFocus,
    initialFocusId,
    invalidInitialFocus,
    contextualNode,
    workspaceId,
    loadDetail,
  ]);
  const preferredSelected = userFocused ? selected : initialFocusId;
  const layout = useMemo(
    () =>
      layoutSessionGraph(graph, {
        orientation:
          contentWidth !== null && contentWidth < 700
            ? "vertical"
            : "horizontal",
        expandedIds: expandedGroups,
        priorityIds,
        focusId:
          preferredSelected &&
          (priorityIds.has(preferredSelected) ||
            graph.nodes.some(
              (node) => node.id === preferredSelected && !node.present,
            ))
            ? preferredSelected
            : null,
      }),
    [graph, expandedGroups, priorityIds, preferredSelected, contentWidth],
  );
  const visibleGroups = layout.groups.filter((group) =>
    group.nodes.some(
      (node) =>
        (node.present && matches(node)) || node.id === contextualNode?.id,
    ),
  );
  const visibleUnlinked = [
    ...layout.unlinked.filter(matches),
    ...(contextualNode &&
    !contextualNode.present &&
    !layout.groups.some((group) =>
      group.nodes.some((node) => node.id === contextualNode.id),
    )
      ? [contextualNode]
      : []),
  ];
  const focusedIndividual =
    focused?.kind === "individual"
      ? (visibleUnlinked.find((node) => node.id === focused.id) ?? null)
      : focused?.kind === "group"
        ? null
        : (visibleUnlinked.find((node) => node.id === preferredSelected) ??
          null);
  const selectedGroup = preferredSelected
    ? visibleGroups.find((group) =>
        group.nodes.some((node) => node.id === preferredSelected),
      )
    : null;
  const focusedGroup =
    focusedIndividual || requestedFocusMissing
      ? null
      : ((focused?.kind === "group"
          ? visibleGroups.find(
              (group) =>
                group.id === focused.id ||
                (focused.anchorId &&
                  group.nodes.some((node) => node.id === focused.anchorId)),
            )
          : null) ??
        selectedGroup ??
        visibleGroups[0] ??
        null);
  const fallbackIndividual =
    focusedGroup || requestedFocusMissing
      ? null
      : (focusedIndividual ?? visibleUnlinked[0] ?? null);
  const visibleIds = new Set(
    focusedGroup?.nodes.map((node) => node.id) ??
      (fallbackIndividual ? [fallbackIndividual.id] : []),
  );
  const visibleSelected =
    preferredSelected && visibleIds.has(preferredSelected)
      ? preferredSelected
      : null;
  const chosenId =
    visibleSelected ??
    focusedGroup?.nodes.find((node) => node.present && matches(node))?.id ??
    fallbackIndividual?.id ??
    null;
  const chosen = graph.nodes.find((node) => node.id === chosenId) ?? null;
  const chosenSource = chosen?.source;
  const chosenSessionId = chosen?.sessionId;
  const detailLoading =
    !!chosen &&
    chosen.source !== "—" &&
    !detailLoadedIds.has(chosen.id) &&
    !detailErrors[chosen.id];
  const detailError = !!chosen && !!detailErrors[chosen.id];
  const catalogError = !!chosen && !!catalogErrors[chosen.id];
  const directEdges = chosen
    ? graph.edges.filter(
        (edge) => edge.from === chosen.id || edge.to === chosen.id,
      )
    : [];
  const unresolved = chosen
    ? graph.unresolved.filter((item) => item.parent === chosen.id)
    : [];

  useEffect(() => {
    if (
      !chosenId ||
      !chosenSource ||
      !chosenSessionId ||
      chosenSource === "—" ||
      detailLoaded.current.has(chosenId) ||
      detailErrors[chosenId]
    )
      return;
    let active = true;
    void loadDetail(workspaceId, chosenSource, chosenSessionId)
      .then((detail) => {
        if (!active) return;
        detailLoaded.current.add(chosenId);
        setDetailLoadedIds(new Set(detailLoaded.current));
        setEvidence((current) => [
          ...current.filter(
            (item) => sessionGraphKey(item.source, item.sessionId) !== chosenId,
          ),
          mergeEvidence(
            current.find(
              (item) =>
                sessionGraphKey(item.source, item.sessionId) === chosenId,
            ),
            {
              source: chosenSource,
              sessionId: chosenSessionId,
              catalog: detail.catalog,
              replay: detail.replay,
              pullRequests: detail.pullRequests,
            },
          ),
        ]);
        if (detail.catalogError)
          setCatalogErrors((current) => ({ ...current, [chosenId]: true }));
      })
      .catch(() => {
        if (active)
          setDetailErrors((current) => ({ ...current, [chosenId]: true }));
      });
    return () => {
      active = false;
    };
  }, [
    chosenId,
    chosenSource,
    chosenSessionId,
    workspaceId,
    detailErrors,
    loadDetail,
  ]);

  const count = rows.filter((row) => !row.liveOnly).length;
  const discoverableCount = discoveryIdentities.length;
  const relationshipsPending =
    !!loadRelationships &&
    (relationshipLoading || relationshipScanned < discoverableCount);
  const relationshipsComplete =
    !!loadRelationships &&
    !relationshipsPending &&
    relationshipFailures.length === 0 &&
    !nextCursor &&
    graph.nodes
      .filter((node) => node.present)
      .every(
        (node) =>
          node.catalogStatus === "loaded" && node.replayStatus === "loaded",
      );
  const partialEvidenceCount = graph.nodes.filter(
    (node) =>
      node.present &&
      (node.catalogStatus === "partial" ||
        node.catalogStatus === "unavailable" ||
        node.replayStatus === "partial" ||
        node.replayStatus === "unavailable"),
  ).length;
  const focusedNode = focusedGroup?.nodes.find((node) => node.id === chosenId);
  const focusedNodeX = focusedNode?.x;
  const focusedNodeY = focusedNode?.y;
  useEffect(() => {
    const viewport = groupScroll.current;
    if (!viewport || focusedNodeX === undefined || focusedNodeY === undefined)
      return;
    if (
      focusedNodeX + GRAPH_CARD_WIDTH >
        viewport.scrollLeft + viewport.clientWidth ||
      focusedNodeX < viewport.scrollLeft ||
      focusedNodeY + GRAPH_CARD_HEIGHT >
        viewport.scrollTop + viewport.clientHeight ||
      focusedNodeY < viewport.scrollTop
    ) {
      viewport.scrollTo?.({
        left: Math.max(0, focusedNodeX - 24),
        top: Math.max(0, focusedNodeY - 24),
      });
    }
  }, [focusedNodeX, focusedNodeY, focusedGroup?.id]);
  const matchCount = graph.nodes.filter(
    (node) => node.present && matches(node),
  ).length;
  const latestResponse = [...(chosen?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant");
  const selectedName = chosen ? recordedAgent(chosen) : null;
  const selectedAssignment = chosen ? recordedAssignment(chosen) : null;
  const selectedOutcome = chosen ? recordedOutcome(chosen) : null;
  const selectedHandoff = selectedHandoffId
    ? (graph.handoffs.find((handoff) => handoff.id === selectedHandoffId) ??
      null)
    : null;
  const navigatorGroup = (group: (typeof visibleGroups)[number]) => {
    const namedAgents = new Set(
      group.nodes.map((node) => node.agentName).filter(Boolean),
    );
    return {
      title: group.title,
      present: group.presentCount,
      active: group.activeCount,
      prs: group.pullRequestCount,
      agents: namedAgents.size,
    };
  };
  const focusGroup = (id: string) => {
    setUserFocused(true);
    const group = visibleGroups.find((item) => item.id === id);
    const anchorId = group?.nodes.some((node) => node.id === group.rootId)
      ? group.rootId
      : group?.nodes[0]?.id;
    setFocused({
      kind: "group",
      id,
      anchorId,
    });
    setSelected(anchorId ?? null);
    setSelectedHandoffId(null);
  };
  const focusIndividual = (id: string) => {
    setUserFocused(true);
    setFocused({ kind: "individual", id });
    setSelectedHandoffId(null);
    selectSession(id);
  };
  const [individualsOpen, setIndividualsOpen] = useState(false);
  const [allIndividuals, setAllIndividuals] = useState(false);
  const showIndividuals =
    individualsOpen || !visibleGroups.length || focused?.kind === "individual";
  const shownIndividuals = allIndividuals
    ? visibleUnlinked
    : visibleUnlinked.slice(0, 8);

  return (
    <div className={styles.page} ref={pageElement}>
      <WorkspaceViewSlot name="heading">
        <h1 className={styles.shellHeading}>Work graph</h1>
      </WorkspaceViewSlot>
      <header className={styles.topbar}>
        <div className={styles.heading}>
          <div className={styles.eyebrow}>
            <Link href={listHref()}>Sessions</Link>
            <ChevronRight size={12} aria-hidden="true" /> Work graph
          </div>
          <p>Recorded collaboration across sessions in this workspace</p>
        </div>
        <Link className={styles.listLink} href={listHref()}>
          <List size={15} /> List view
        </Link>
      </header>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search loaded sessions</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find work or session"
          />
        </label>
        <label className={styles.sourceFilter}>
          <span>Source</span>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="all">All sources</option>
            {sources.map((item) => (
              <option key={item} value={item}>
                {sourceLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <span className={styles.scope}>
          {loaded
            ? `${matchCount} of ${count} loaded sessions`
            : "Loading sessions"}
          {nextCursor ? " · More available" : ""}
          {lastRefreshAt
            ? ` · Updated ${relativeTime(new Date(lastRefreshAt).toISOString(), clockNow)}`
            : ""}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={blocked}
          aria-label="Refresh sessions"
        >
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>
      {requestedFocusMissing && (
        <div className={styles.notice} role="status">
          {contextualLoading
            ? "Loading requested session evidence…"
            : contextualUnavailable || invalidInitialFocus
              ? "Requested session evidence is unavailable in this workspace."
              : "Finding requested session…"}
        </div>
      )}
      {loaded &&
        loadRelationships &&
        (relationshipsPending ||
          relationshipFailures.length > 0 ||
          partialEvidenceCount > 0) && (
          <div className={styles.discoveryStatus} role="status">
            <span>
              {relationshipFailures.length > 0
                ? `${relationshipFailures.length} session${relationshipFailures.length === 1 ? "" : "s"} could not be checked for relationships`
                : !relationshipsPending && partialEvidenceCount > 0
                  ? `${partialEvidenceCount} session${partialEvidenceCount === 1 ? " has" : "s have"} incomplete relationship evidence`
                  : `Checking recorded relationships · ${relationshipScanned} of ${discoverableCount}`}
            </span>
            {relationshipFailures.length > 0 && (
              <button type="button" onClick={retryRelationships}>
                Retry failed
              </button>
            )}
          </div>
        )}
      {failure && (
        <div role="alert" className={styles.notice}>
          Could not load sessions.{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={failedCursor ? more : refresh}
          >
            Retry
          </Button>
        </div>
      )}
      {blocked && (
        <div role="status" className={styles.notice}>
          Session access changed. Refresh this page to continue.
        </div>
      )}
      {loaded &&
        count === 0 &&
        !contextualNode &&
        !requestedFocusMissing &&
        !failure && (
          <div className={styles.empty}>
            No recorded sessions in this workspace.
          </div>
        )}
      {loaded &&
        count > 0 &&
        matchCount === 0 &&
        !contextualNode &&
        !requestedFocusMissing && (
          <div className={styles.empty}>
            No loaded sessions match these filters.
          </div>
        )}
      {((count > 0 && matchCount > 0) || !!contextualNode) && (
        <div className={styles.explorer}>
          <nav className={styles.navigator} aria-label="Work groups">
            <div className={styles.navigatorHead}>
              <strong>Work groups</strong>
              <span>{visibleGroups.length}</span>
            </div>
            {visibleGroups.length > 0 && (
              <div className={styles.workGroupList}>
                {visibleGroups.map((group) => {
                  const info = navigatorGroup(group);
                  return (
                    <button
                      type="button"
                      key={group.id}
                      className={`${styles.workGroupItem} ${focusedGroup?.id === group.id ? styles.workGroupActive : ""}`}
                      aria-current={
                        focusedGroup?.id === group.id ? "true" : undefined
                      }
                      onClick={() => focusGroup(group.id)}
                    >
                      <span className={styles.workGroupTitle}>
                        {info.title}
                      </span>
                      <span className={styles.workGroupStats}>
                        {info.present} sessions
                        {group.totalEdges
                          ? ` · ${group.totalEdges} parent link${group.totalEdges === 1 ? "" : "s"}`
                          : ""}
                        {group.totalHandoffs
                          ? ` · ${group.totalHandoffs} message${group.totalHandoffs === 1 ? "" : "s"}`
                          : ""}
                        {info.agents
                          ? ` · ${info.agents} named agent${info.agents === 1 ? "" : "s"}`
                          : ""}
                        {info.active ? ` · ${info.active} active` : ""}
                        {info.prs
                          ? ` · ${info.prs} PR${info.prs === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {visibleUnlinked.length > 0 && (
              <div className={styles.individualSection}>
                <button
                  type="button"
                  className={styles.individualToggle}
                  aria-expanded={showIndividuals}
                  onClick={() => setIndividualsOpen((open) => !open)}
                >
                  <span>Individual sessions</span>
                  <span>{visibleUnlinked.length}</span>
                </button>
                {showIndividuals && (
                  <div className={styles.individualList}>
                    {shownIndividuals.map((node) => (
                      <button
                        type="button"
                        key={node.id}
                        className={`${styles.individualItem} ${fallbackIndividual?.id === node.id ? styles.individualActive : ""}`}
                        onClick={() => focusIndividual(node.id)}
                        aria-current={
                          fallbackIndividual?.id === node.id
                            ? "true"
                            : undefined
                        }
                      >
                        <span>{cardTitle(node)}</span>
                        <small>
                          {sourceLabel(node.source)} ·{" "}
                          {relativeTime(node.lastTs, clockNow)}
                        </small>
                      </button>
                    ))}
                    {!allIndividuals &&
                      visibleUnlinked.length > shownIndividuals.length && (
                        <button
                          type="button"
                          className={styles.moreIndividuals}
                          onClick={() => setAllIndividuals(true)}
                        >
                          Show all {visibleUnlinked.length}
                        </button>
                      )}
                  </div>
                )}
              </div>
            )}
          </nav>

          <main className={styles.focusColumn}>
            {focusedGroup && (
              <>
                <div className={styles.focusHeader}>
                  <div>
                    <span className={styles.kicker}>
                      {focusedGroup.hasStructuralEdges
                        ? "Connected work"
                        : focusedGroup.handoffs.length
                          ? "Recorded communication"
                          : "Unlinked delegation"}
                    </span>
                    <h2>{navigatorGroup(focusedGroup).title}</h2>
                    <p>
                      {navigatorGroup(focusedGroup).present} recorded sessions ·{" "}
                      {focusedGroup.totalNodes} identified in this group
                    </p>
                  </div>
                  <span className={styles.focusTime}>
                    {relativeTime(
                      new Date(focusedGroup.lastTs).toISOString(),
                      clockNow,
                    )}
                  </span>
                </div>
                <div className={styles.group}>
                  <div className={styles.groupScroll} ref={groupScroll}>
                    <div
                      className={styles.canvas}
                      style={{
                        width: focusedGroup.width,
                        height: focusedGroup.height,
                      }}
                    >
                      <svg
                        className={styles.edges}
                        width={focusedGroup.width}
                        height={focusedGroup.height}
                        aria-hidden="true"
                      >
                        <defs>
                          <marker
                            id="session-graph-arrow"
                            markerWidth="7"
                            markerHeight="7"
                            refX="6"
                            refY="3.5"
                            orient="auto"
                          >
                            <path
                              d="M 0 0 L 7 3.5 L 0 7"
                              className={styles.arrowHead}
                            />
                          </marker>
                        </defs>
                        {focusedGroup.edges.map((edge) => {
                          const from = focusedGroup.nodes.find(
                            (node) => node.id === edge.from,
                          )!;
                          const to = focusedGroup.nodes.find(
                            (node) => node.id === edge.to,
                          )!;
                          const vertical =
                            focusedGroup.orientation === "vertical";
                          const x1 = from.x + GRAPH_CARD_WIDTH;
                          const y1 = from.y + GRAPH_CARD_HEIGHT / 2;
                          const x2 = to.x - 7;
                          const y2 = to.y + GRAPH_CARD_HEIGHT / 2;
                          const midpoint = x1 + (x2 - x1) / 2;
                          const intervening =
                            vertical &&
                            focusedGroup.nodes.some(
                              (node) =>
                                node.id !== from.id &&
                                node.id !== to.id &&
                                node.y > from.y &&
                                node.y < to.y,
                            );
                          const directDown =
                            vertical && to.y > from.y && !intervening;
                          const aroundLeft =
                            vertical && to.y > from.y && intervening;
                          const path = directDown
                            ? `M ${from.x + GRAPH_CARD_WIDTH / 2} ${from.y + GRAPH_CARD_HEIGHT} L ${to.x + GRAPH_CARD_WIDTH / 2} ${to.y - 7}`
                            : aroundLeft
                              ? `M ${from.x} ${y1} C 16 ${y1}, 16 ${to.y - 20}, 16 ${to.y - 20} L ${to.x + GRAPH_CARD_WIDTH / 2} ${to.y - 20} L ${to.x + GRAPH_CARD_WIDTH / 2} ${to.y - 7}`
                              : vertical
                                ? `M ${x1} ${y1} C ${x1 + 32} ${y1}, ${x1 + 32} ${y2}, ${to.x + GRAPH_CARD_WIDTH + 7} ${y2}`
                                : `M ${x1} ${y1} C ${midpoint} ${y1}, ${midpoint} ${y2}, ${x2} ${y2}`;
                          const labelX = directDown
                            ? from.x + GRAPH_CARD_WIDTH / 2 + 10
                            : aroundLeft
                              ? to.x + GRAPH_CARD_WIDTH / 2 + 8
                              : vertical
                                ? x1 + 8
                                : midpoint;
                          const labelY = directDown
                            ? (from.y + GRAPH_CARD_HEIGHT + to.y) / 2 - 3
                            : aroundLeft
                              ? to.y - 23
                              : vertical
                                ? (y1 + y2) / 2 - 7
                                : (y1 + y2) / 2 - 7;
                          const short =
                            to.autoReview &&
                            edge.provenance !== "catalog_summary"
                              ? "Review"
                              : edge.provenance === "catalog_summary"
                                ? "Parent"
                                : edge.relationship === "delegated"
                                  ? "Delegate"
                                  : edge.relationship === "materialized_local"
                                    ? "Local child"
                                    : edge.relationship === "continuation"
                                      ? "Continue"
                                      : edge.relationship === "fork"
                                        ? "Fork"
                                        : edge.relationship === "resume"
                                          ? "Resume"
                                          : "Related";
                          return (
                            <g key={edge.id}>
                              <path
                                className={
                                  edge.provenance === "catalog_summary"
                                    ? styles.edgeUnknown
                                    : styles.edge
                                }
                                markerEnd="url(#session-graph-arrow)"
                                d={path}
                              />
                              <text
                                className={styles.edgeLabel}
                                x={labelX}
                                y={labelY}
                                textAnchor={vertical ? "start" : "middle"}
                              >
                                {short}
                              </text>
                            </g>
                          );
                        })}
                        {focusedGroup.handoffs.map((handoff) => {
                          const from = focusedGroup.nodes.find(
                            (node) => node.id === handoff.from,
                          )!;
                          const to = focusedGroup.nodes.find(
                            (node) => node.id === handoff.to,
                          )!;
                          const sameColumn = from.x === to.x;
                          const x1 = sameColumn
                            ? from.x + GRAPH_CARD_WIDTH
                            : from.x < to.x
                              ? from.x + GRAPH_CARD_WIDTH
                              : from.x;
                          const x2 = sameColumn
                            ? to.x + GRAPH_CARD_WIDTH
                            : from.x < to.x
                              ? to.x - 7
                              : to.x + GRAPH_CARD_WIDTH + 7;
                          const y1 = from.y + GRAPH_CARD_HEIGHT / 2;
                          const y2 = to.y + GRAPH_CARD_HEIGHT / 2;
                          const bend = sameColumn
                            ? x1 + 32
                            : x1 + (x2 - x1) / 2;
                          return (
                            <path
                              key={handoff.id}
                              className={styles.handoffEdge}
                              markerEnd="url(#session-graph-arrow)"
                              d={`M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`}
                            />
                          );
                        })}
                      </svg>
                      {focusedGroup.handoffs.map((handoff) => {
                        const from = focusedGroup.nodes.find(
                          (node) => node.id === handoff.from,
                        )!;
                        const to = focusedGroup.nodes.find(
                          (node) => node.id === handoff.to,
                        )!;
                        const sameColumn = from.x === to.x;
                        const x = sameColumn
                          ? from.x + GRAPH_CARD_WIDTH + 7
                          : (from.x + to.x + GRAPH_CARD_WIDTH) / 2 - 26;
                        const sharedRelationship = !sameColumn && focusedGroup.edges.some(
                          (edge) => (edge.from === handoff.from && edge.to === handoff.to)
                            || (edge.from === handoff.to && edge.to === handoff.from),
                        );
                        // Relationship text sits above this shared midpoint;
                        // keep the interactive message badge below it.
                        const y = (from.y + to.y + GRAPH_CARD_HEIGHT) / 2 + (sharedRelationship ? 10 : -10);
                        return (
                          <button
                            type="button"
                            key={handoff.id}
                            className={`${styles.handoffLabel} ${selectedHandoffId === handoff.id ? styles.handoffLabelSelected : ""}`}
                            style={{ left: x, top: y }}
                            onClick={() => {
                              setSelectedHandoffId(handoff.id);
                              selectSession(handoff.from);
                            }}
                            aria-label={`Inspect recorded message from ${graph.nodes.find((node) => node.id === handoff.from)?.title || "session"} to ${graph.nodes.find((node) => node.id === handoff.to)?.title || "session"}`}
                            title={handoff.text || "Recorded message"}
                          >
                            Message →
                          </button>
                        );
                      })}
                      {focusedGroup.nodes.map((node) => (
                        <SessionCard
                          key={node.id}
                          node={node}
                          selected={chosenId === node.id}
                          dimmed={
                            !!query.trim() && node.present && !matches(node)
                          }
                          now={clockNow}
                          onSelect={() => selectSession(node.id)}
                          x={node.x}
                          y={node.y}
                        />
                      ))}
                    </div>
                  </div>
                  <div className={styles.groupFoot}>
                    <span>
                      {focusedGroup.totalEdges
                        ? "Solid arrows show recorded parent → child links. "
                        : ""}
                      {focusedGroup.totalHandoffs
                        ? "Blue dashed arrows show recorded messages. "
                        : ""}
                      {focusedGroup.edges.some(
                        (edge) => edge.provenance === "catalog_summary",
                      )
                        ? "Grey dashed links have no recorded type."
                        : ""}
                      {focusedGroup.hiddenEdges || focusedGroup.hiddenHandoffs
                        ? ` ${focusedGroup.hiddenEdges} parent links and ${focusedGroup.hiddenHandoffs} messages are outside this view.`
                        : ""}
                      {focusedGroup.width > 600 || focusedGroup.height > 520
                        ? " Scroll to explore this group."
                        : ""}
                    </span>
                    {(focusedGroup.hiddenNodes > 0 ||
                      focusedGroup.hiddenUnresolved > 0) && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGroups((current) =>
                            new Set(current).add(focusedGroup.id),
                          )
                        }
                      >
                        {focusedGroup.hiddenNodes > 0
                          ? `Show all ${focusedGroup.totalNodes} sessions`
                          : "Show all delegate records"}
                      </button>
                    )}
                  </div>
                </div>
                {selectedHandoff &&
                  focusedGroup.handoffs.some(
                    (handoff) => handoff.id === selectedHandoff.id,
                  ) && (
                    <div className={styles.handoffDetail}>
                      <span className={styles.kicker}>
                        Recorded message ·{" "}
                        {selectedHandoff.status || "status unknown"}
                      </span>
                      <strong>
                        {cardTitle(
                          graph.nodes.find(
                            (node) => node.id === selectedHandoff.from,
                          )!,
                        )}{" "}
                        →{" "}
                        {cardTitle(
                          graph.nodes.find(
                            (node) => node.id === selectedHandoff.to,
                          )!,
                        )}
                      </strong>
                      {selectedHandoff.text && (
                        <p>{selectedHandoff.text.slice(0, 480)}</p>
                      )}
                      <small>
                        {selectedHandoff.ts
                          ? exactTime(selectedHandoff.ts)
                          : "Time unrecorded"}{" "}
                        · Event {selectedHandoff.evidenceEventId}
                      </small>
                    </div>
                  )}
                {focusedGroup.unresolved.length > 0 && (
                  <div className={styles.unresolvedBlock}>
                    <strong>Unlinked delegate records</strong>
                    {focusedGroup.unresolved.map((item) => (
                      <p key={item.id}>
                        {item.childAgentName ||
                          item.childAgentType ||
                          "Delegate"}
                        {item.task ? ` · ${item.task}` : ""} · Child session
                        identity was not recorded
                      </p>
                    ))}
                    {focusedGroup.hiddenUnresolved > 0 && (
                      <p>
                        {focusedGroup.hiddenUnresolved} additional unlinked
                        delegate records are hidden with this group.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            {!focusedGroup && fallbackIndividual && (
              <div className={styles.individualFocus}>
                <span className={styles.kicker}>Individual session</span>
                <h2>{cardTitle(fallbackIndividual)}</h2>
                <p>
                  {relationshipsComplete
                    ? "No recorded link among loaded sessions."
                    : "Recorded relationships are still being checked."}
                </p>
              </div>
            )}

            {chosen && (
              <section
                ref={inspector}
                className={styles.evidence}
                aria-label="Selected session evidence"
              >
                <div className={styles.evidenceHeader}>
                  <div>
                    <span className={styles.kicker}>Selected session</span>
                    <h2>{cardTitle(chosen)}</h2>
                    <p>
                      {chosen.autoReview ? "Auto-review · " : ""}
                      {selectedName ? `${selectedName} · ` : ""}
                      {sourceLabel(chosen.source)} ·{" "}
                      {chosen.status === "unknown"
                        ? "Status unrecorded"
                        : chosen.status}{" "}
                      · {relativeTime(chosen.lastTs, clockNow)}
                    </p>
                  </div>
                  <Link className={styles.openLink} href={sessionHref(chosen.sessionId, chosen.source, null, null, workspaceId)}>
                    Open session <ArrowRight size={14} />
                  </Link>
                </div>
                {selectedAssignment && selectedAssignment !== chosen.title && (
                  <div className={styles.evidenceLead}>
                    <span>Assignment</span>
                    <p>{selectedAssignment}</p>
                  </div>
                )}
                {chosen.initialRequest &&
                  !isControlOnlyRequest(chosen.initialRequest) && (
                    <div className={styles.evidenceLead}>
                      <span>Recorded request</span>
                      <p>{chosen.initialRequest.slice(0, 420)}</p>
                    </div>
                  )}
                {selectedOutcome ? (
                  <div className={styles.evidenceLead}>
                    <span>Recorded outcome</span>
                    <p>{selectedOutcome.slice(0, 420)}</p>
                  </div>
                ) : (
                  latestResponse && (
                    <div className={styles.evidenceLead}>
                      <span>Latest recorded response</span>
                      <div className={styles.excerptBody}>
                        <Markdown
                          skipHtml
                          allowedElements={[
                            "p",
                            "strong",
                            "em",
                            "code",
                            "ul",
                            "ol",
                            "li",
                            "a",
                            "br",
                          ]}
                          unwrapDisallowed
                        >
                          {latestResponse.text.slice(0, 300)}
                        </Markdown>
                      </div>
                    </div>
                  )
                )}
                {(chosen.flowRun || chosen.pullRequests.length > 0) && (
                  <div className={styles.linkedWork}>
                    {chosen.flowRun && (
                      <span>
                        Flow: {chosen.flowRun.flowName || chosen.flowRun.runId}
                      </span>
                    )}
                    {chosen.pullRequests.map((pr) => {
                      const tool = pr.toolUseId
                        ? chosen.tools.find(
                            (item) => item.toolUseId === pr.toolUseId,
                          )
                        : null;
                      return (
                        <a
                          key={pr.url}
                          href={pr.url}
                          target="_blank"
                          rel="noreferrer"
                          title={
                            [pr.role, pr.evidence, pr.detectedAt]
                              .filter(Boolean)
                              .join(" · ") || undefined
                          }
                        >
                          PR #{pr.number}
                          {tool ? ` · via ${tool.name}` : ""} ↗
                        </a>
                      );
                    })}
                  </div>
                )}
                <div className={styles.evidenceStats}>
                  <span>{directEdges.length} recorded links</span>
                  <span>
                    {chosen.messages.length}{" "}
                    {chosen.replayStatus === "partial" ? "loaded" : "recorded"}{" "}
                    messages
                  </span>
                  <span>
                    {chosen.tools.length}{" "}
                    {chosen.replayStatus === "partial" ? "loaded" : "recorded"}{" "}
                    tools
                  </span>
                </div>
                {detailLoading && (
                  <p className={styles.evidenceStatus} role="status">
                    Loading session evidence…
                  </p>
                )}
                {detailError && (
                  <p className={styles.evidenceStatus} role="alert">
                    Session evidence could not be loaded.
                  </p>
                )}
                {catalogError && (
                  <p className={styles.evidenceStatus}>
                    Additional relationship details unavailable.
                  </p>
                )}
                <div className={styles.disclosures}>
                  <details
                    className={styles.disclosure}
                    open={
                      directEdges.length > 0 ||
                      unresolved.length > 0 ||
                      undefined
                    }
                  >
                    <summary>
                      Relationships{" "}
                      <span>{directEdges.length + unresolved.length}</span>
                    </summary>
                    <div className={styles.disclosureBody}>
                      {directEdges.length === 0 && unresolved.length === 0 && (
                        <p>
                          {relationshipsComplete
                            ? "No recorded link among loaded sessions."
                            : "No link found in loaded evidence yet."}
                        </p>
                      )}
                      {directEdges.map((edge) => {
                        const peer = graph.nodes.find(
                          (node) =>
                            node.id ===
                            (edge.from === chosen.id ? edge.to : edge.from),
                        );
                        return (
                          <div className={styles.relationship} key={edge.id}>
                            <strong>
                              {edge.from === chosen.id ? "Child" : "Parent"} ·{" "}
                              {graph.nodes.find((node) => node.id === edge.to)
                                ?.autoReview &&
                              edge.provenance !== "catalog_summary"
                                ? "Review"
                                : relationshipLabel(edge)}
                            </strong>
                            <span>
                              {peer
                                ? cardTitle(peer)
                                : "Session outside loaded results"}
                            </span>
                            {edge.childAgentName && (
                              <small>{edge.childAgentName}</small>
                            )}
                          </div>
                        );
                      })}
                      {unresolved.map((item) => (
                        <div className={styles.relationship} key={item.id}>
                          <strong>Unlinked delegate</strong>
                          <span>
                            {item.childAgentName ||
                              item.childAgentType ||
                              "Child identity unrecorded"}
                          </span>
                        </div>
                      ))}

                    </div>
                  </details>
                  <details className={styles.disclosure}>
                    <summary>
                      Messages <span>{chosen.messages.length}</span>
                    </summary>
                    <div className={styles.disclosureBody}>
                      {chosen.messages.length === 0 ? (
                        <p>
                          {chosen.replayStatus === "unavailable"
                            ? "Conversation evidence unavailable."
                            : "No messages in loaded evidence."}
                        </p>
                      ) : (
                        [...chosen.messages]
                          .slice(-6)
                          .reverse()
                          .map((message) => (
                            <div
                              className={styles.messageItem}
                              key={message.id}
                            >
                              <strong>
                                {message.role === "user" ? "User" : "Assistant"}
                              </strong>
                              <p>
                                {message.text.slice(0, 320)}
                                {message.truncated || message.text.length > 320
                                  ? "…"
                                  : ""}
                              </p>
                            </div>
                          ))
                      )}
                      {chosen.replayStatus === "partial" && (
                        <p className={styles.caveat}>
                          Activity is partial. Open the session for the full
                          record.
                        </p>
                      )}
                    </div>
                  </details>
                  <details className={styles.disclosure}>
                    <summary>
                      Tools <span>{chosen.tools.length}</span>
                    </summary>
                    <div className={styles.disclosureBody}>
                      {chosen.tools.length === 0 ? (
                        <p>No tools in loaded evidence.</p>
                      ) : (
                        <ul className={styles.toolList}>
                          {[...chosen.tools]
                            .slice(-8)
                            .reverse()
                            .map((tool) => {
                              const linked = tool.toolUseId
                                ? chosen.pullRequests.filter(
                                    (pr) => pr.toolUseId === tool.toolUseId,
                                  )
                                : [];
                              return (
                                <li key={tool.id}>
                                  <span>
                                    {tool.name}
                                    {linked.map((pr) => (
                                      <a
                                        key={pr.url}
                                        href={pr.url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {" "}
                                        → PR #{pr.number}
                                      </a>
                                    ))}
                                  </span>
                                  <span>
                                    {tool.status === "unknown"
                                      ? "Result unknown"
                                      : tool.status === "succeeded"
                                        ? "Succeeded"
                                        : "Failed"}
                                  </span>
                                </li>
                              );
                            })}
                        </ul>
                      )}
                    </div>
                  </details>
                </div>
                <div className={styles.identity}>
                  {chosen.source} · {chosen.sessionId}
                </div>
              </section>
            )}

          </main>
        </div>
      )}
            {loaded && !blocked && nextCursor && (
              <div className={styles.loadMore}>
                <Button variant="outline" onClick={more} disabled={loading}>
                  {loading ? "Loading…" : "Load more sessions"}
                </Button>
                <span>
                  Additional relationships may be outside loaded pages.
                </span>
              </div>
            )}
      {relativeDiscoveryLimited && <p className={styles.caveat}>Automatic discovery is limited to 80 related sessions. Select another session to inspect its recorded evidence.</p>}
    </div>
  );
}

function recordedAgent(node: SessionGraphNode): string | null {
  return (
    (node as SessionGraphNode & { agentName?: string | null }).agentName || null
  );
}
function recordedAssignment(node: SessionGraphNode): string | null {
  return (
    (node as SessionGraphNode & { assignment?: string | null }).assignment ||
    null
  );
}
function recordedOutcome(node: SessionGraphNode): string | null {
  return (
    (node as SessionGraphNode & { outcome?: string | null }).outcome || null
  );
}
function SessionCard({
  node,
  selected,
  dimmed = false,
  now,
  onSelect,
  x,
  y,
}: {
  node: SessionGraphNode;
  selected: boolean;
  dimmed?: boolean;
  now: number;
  onSelect: () => void;
  x?: number;
  y?: number;
}) {
  const agentName = recordedAgent(node);
  const assignment = recordedAssignment(node);
  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSelected : ""} ${!node.present ? styles.cardMissing : ""} ${dimmed ? styles.cardDimmed : ""}`}
      style={x === undefined ? undefined : { left: x, top: y }}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${cardTitle(node)}, ${sourceLabel(node.source)}${node.present ? "" : ", outside loaded results"}`}
    >
      <span className={styles.cardTop}>
        <span
          className={styles.cardRole}
          title={
            node.autoReview
              ? `Auto-review · ${agentName || sourceLabel(node.source)}`
              : agentName
                ? `${agentName} · ${sourceLabel(node.source)}`
                : sourceLabel(node.source)
          }
        >
          {node.autoReview
            ? "Auto-review"
            : agentName || sourceLabel(node.source)}
        </span>
        <span
          className={`${styles.statusDot} ${styles[`status_${node.status}`]}`}
          title={node.status === "unknown" ? "Status unrecorded" : node.status}
        />
      </span>
      <strong>{cardTitle(node)}</strong>
      {assignment && assignment !== node.title && (
        <span className={styles.cardAssignment}>{assignment}</span>
      )}
      <span className={styles.cardBottom}>
        <span>
          {node.present
            ? `${node.status === "unknown" ? "Status unknown" : node.status}${agentName || node.autoReview ? ` · ${agentName || sourceLabel(node.source)}` : ""}`
            : "Not loaded"}
        </span>
        <span>
          {node.pullRequests.length
            ? `${node.pullRequests.length} PR${node.pullRequests.length === 1 ? "" : "s"}`
            : node.tools.length
              ? `${node.tools.length} tools`
              : ""}
        </span>
        <time title={exactTime(node.lastTs) ?? undefined}>
          {node.present ? relativeTime(node.lastTs, now) : ""}
        </time>
      </span>
    </button>
  );
}
