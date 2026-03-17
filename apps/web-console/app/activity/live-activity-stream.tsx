"use client";

import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";

interface PresenceRow {
  id: string;
  projectId: string;
  userId: string;
  state: string;
  activeFilePath?: string | null;
  lastSeenAt: string;
}

interface LiveActivityStreamProps {
  projectId: string;
  initialPresence: PresenceRow[];
}

function resolveSocketUrl(): string {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/v1";
  try {
    return new URL(apiBaseUrl).origin;
  } catch {
    return "http://localhost:4000";
  }
}

async function fetchRealtimeToken(): Promise<string> {
  const response = await fetch("/api/realtime-token", {
    method: "GET",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch realtime token (${response.status})`);
  }
  const payload = (await response.json()) as { token?: string };
  if (!payload.token) {
    throw new Error("Realtime token missing from response");
  }
  return payload.token;
}

export function LiveActivityStream({ projectId, initialPresence }: LiveActivityStreamProps) {
  const [presence, setPresence] = useState<PresenceRow[]>(initialPresence);
  const [events, setEvents] = useState<string[]>([]);

  const socketUrl = useMemo(() => resolveSocketUrl(), []);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let socket: Socket | undefined;
    let disposed = false;

    const connect = async () => {
      const token = await fetchRealtimeToken();
      if (disposed) {
        return;
      }

      socket = io(socketUrl, {
        transports: ["websocket"],
        auth: {
          token
        }
      });

      socket.io.on("reconnect_attempt", async () => {
        try {
          const refreshedToken = await fetchRealtimeToken();
          if (socket) {
            socket.auth = { token: refreshedToken };
          }
        } catch {
          setEvents((previous) => ["realtime_token_refresh_failed", ...previous].slice(0, 20));
        }
      });

      socket.on("connect", () => {
        socket?.emit("join_project", {
          projectId
        });
        setEvents((previous) => [`connected:${socket?.id ?? "unknown"}`, ...previous].slice(0, 20));
      });

      socket.on(
        "activity.user_state_changed",
        (event: { actor?: { userId?: string }; payload?: { state?: string; activeFilePath?: string; presenceId?: string }; timestamp?: string }) => {
          const userId = event.actor?.userId;
          if (!userId) {
            return;
          }

          setPresence((previous) => {
            const next = [...previous];
            const existingIndex = next.findIndex((row) => row.userId === userId);
            const updated: PresenceRow = {
              id: event.payload?.presenceId ?? `presence:${userId}`,
              projectId,
              userId,
              state: event.payload?.state ?? "editing",
              activeFilePath: event.payload?.activeFilePath,
              lastSeenAt: event.timestamp ?? new Date().toISOString()
            };

            if (existingIndex === -1) {
              next.unshift(updated);
              return next.slice(0, 100);
            }

            next[existingIndex] = updated;
            return next;
          });

          setEvents((previous) => [`activity.user_state_changed:${userId}`, ...previous].slice(0, 20));
        }
      );

      socket.on(
        "activity.file_focus_changed",
        (event: { actor?: { userId?: string }; payload?: { activeFilePath?: string } }) => {
          const userId = event.actor?.userId ?? "unknown";
          const file = event.payload?.activeFilePath ?? "(no file)";
          setEvents((previous) => [`activity.file_focus_changed:${userId}:${file}`, ...previous].slice(0, 20));
        }
      );

      socket.on("conflict.detected", (event: { payload?: { severity?: string; suggestedAction?: string } }) => {
        const severity = event.payload?.severity ?? "unknown";
        const action = event.payload?.suggestedAction ?? "review";
        setEvents((previous) => [`conflict.detected:${severity}:${action}`, ...previous].slice(0, 20));
      });

      socket.on("branch.status_changed", (event: { payload?: { status?: string; pullRequestNumber?: number } }) => {
        const status = event.payload?.status ?? "unknown";
        const pullRequest = event.payload?.pullRequestNumber ? `#${event.payload.pullRequestNumber}` : "n/a";
        setEvents((previous) => [`branch.status_changed:${status}:${pullRequest}`, ...previous].slice(0, 20));
      });

      socket.on("quality_gate.completed", (event: { payload?: { status?: string } }) => {
        setEvents((previous) => [`quality_gate.completed:${event.payload?.status ?? "unknown"}`, ...previous].slice(0, 20));
      });

      socket.on("handoff.created", () => {
        setEvents((previous) => ["handoff.created", ...previous].slice(0, 20));
      });

      socket.on("pivot.mode_enabled", () => {
        setEvents((previous) => ["pivot.mode_enabled", ...previous].slice(0, 20));
      });
    };

    void connect().catch((error) => {
      setEvents((previous) => [`connect_error:${error instanceof Error ? error.message : "unknown"}`, ...previous].slice(0, 20));
    });

    return () => {
      disposed = true;
      socket?.emit("leave_project", {
        projectId
      });
      socket?.disconnect();
    };
  }, [projectId, socketUrl]);

  return (
    <>
      <h2>Presence</h2>
      <ul>
        {presence.map((row) => (
          <li key={row.id}>
            {row.userId} - {row.state} - {row.activeFilePath ?? "(no file)"}
          </li>
        ))}
      </ul>

      <h2>Live Event Feed</h2>
      <ul>
        {events.map((event, index) => (
          <li key={`${event}:${index}`}>{event}</li>
        ))}
      </ul>
    </>
  );
}
