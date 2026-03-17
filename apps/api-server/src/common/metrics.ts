import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

const globalMetrics = globalThis as typeof globalThis & {
  __branchlineMetricsRegistry?: Registry;
  __branchlineMetricsInitialized?: boolean;
  __branchlineHttpDuration?: Histogram<"method" | "route" | "status_code">;
  __branchlineWebsocketEvents?: Counter<"event">;
  __branchlineGithubAutomation?: Counter<"operation" | "outcome">;
};

const registry =
  globalMetrics.__branchlineMetricsRegistry ??
  new Registry();

if (!globalMetrics.__branchlineMetricsInitialized) {
  collectDefaultMetrics({
    register: registry
  });
  globalMetrics.__branchlineMetricsInitialized = true;
  globalMetrics.__branchlineMetricsRegistry = registry;
}

const httpRequestDurationSeconds =
  globalMetrics.__branchlineHttpDuration ??
  new Histogram({
    name: "branchline_api_http_request_duration_seconds",
    help: "HTTP request duration for Branchline API routes",
    labelNames: ["method", "route", "status_code"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]
  });

if (!globalMetrics.__branchlineHttpDuration) {
  registry.registerMetric(httpRequestDurationSeconds);
  globalMetrics.__branchlineHttpDuration = httpRequestDurationSeconds;
}

const websocketEventsTotal =
  globalMetrics.__branchlineWebsocketEvents ??
  new Counter({
    name: "branchline_realtime_events_total",
    help: "Count of websocket events emitted by Branchline",
    labelNames: ["event"] as const
  });

if (!globalMetrics.__branchlineWebsocketEvents) {
  registry.registerMetric(websocketEventsTotal);
  globalMetrics.__branchlineWebsocketEvents = websocketEventsTotal;
}

const githubAutomationTotal =
  globalMetrics.__branchlineGithubAutomation ??
  new Counter({
    name: "branchline_github_automation_total",
    help: "Count of GitHub automation operations and outcomes",
    labelNames: ["operation", "outcome"] as const
  });

if (!globalMetrics.__branchlineGithubAutomation) {
  registry.registerMetric(githubAutomationTotal);
  globalMetrics.__branchlineGithubAutomation = githubAutomationTotal;
}

export function observeHttpRequest(input: {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}) {
  httpRequestDurationSeconds.observe(
    {
      method: input.method,
      route: input.route,
      status_code: String(input.statusCode)
    },
    input.durationSeconds
  );
}

export function incrementRealtimeEvent(event: string) {
  websocketEventsTotal.inc({
    event
  });
}

export function incrementGithubAutomation(operation: string, outcome: string) {
  githubAutomationTotal.inc({
    operation,
    outcome
  });
}

export function getMetricsRegistry() {
  return registry;
}

