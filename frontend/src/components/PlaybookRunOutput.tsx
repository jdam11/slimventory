/**
 * PlaybookRunOutput — SSE-powered live output viewer.
 *
 * Connects to /api/playbook-runs/{id}/stream and renders output in a
 * dark monospace terminal block. Falls back to replaying the stored
 * output if the run is already complete.
 */
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Space, Spin, Tag, Typography, theme as antdTheme } from "antd";
import { ReloadOutlined, VerticalAlignBottomOutlined } from "@ant-design/icons";
import type { PlaybookRunStatus } from "../types";

const { Text } = Typography;

interface SseEvent {
  type: "chunk" | "done" | "error";
  text?: string;
  exit_code?: number | null;
  message?: string;
}

interface Props {
  runId: number;
  initialOutput?: string | null;
  initialStatus?: PlaybookRunStatus;
  onStatusChange?: (status: PlaybookRunStatus, exitCode: number | null) => void;
}

const STATUS_COLOR: Record<PlaybookRunStatus, string> = {
  pending: "default",
  running: "processing",
  success: "success",
  failed: "error",
  cancelled: "warning",
};

export default function PlaybookRunOutput({ runId, initialOutput, initialStatus, onStatusChange }: Props) {
  const { token } = antdTheme.useToken();
  const [output, setOutput] = useState<string>(initialOutput ?? "");
  const [status, setStatus] = useState<PlaybookRunStatus>(initialStatus ?? "pending");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followTail, setFollowTail] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const outputPanelRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const finished =
    status === "success" || status === "failed" || status === "cancelled";
  const badgeStatus = (streaming ? "processing" : STATUS_COLOR[status]) as
    | "success"
    | "processing"
    | "default"
    | "error"
    | "warning";

  function connect() {
    if (esRef.current) {
      esRef.current.close();
    }
    setError(null);
    setStreaming(true);
    setExitCode(null);
    setFollowTail(true);
    if (!finished) {
      setStatus("running");
      onStatusChange?.("running", null);
    }

    const es = new EventSource(`/api/playbook-runs/${runId}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg: SseEvent = JSON.parse(e.data);
        if (msg.type === "chunk" && msg.text) {
          setOutput((prev) => prev + msg.text);
        } else if (msg.type === "done") {
          const ec = msg.exit_code ?? null;
          const finalStatus: PlaybookRunStatus = ec === 0 ? "success" : "failed";
          setExitCode(ec);
          setStatus(finalStatus);
          setStreaming(false);
          onStatusChange?.(finalStatus, ec);
          es.close();
        } else if (msg.type === "error") {
          setError(msg.message ?? "Unknown streaming error");
          setStreaming(false);
          es.close();
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStreaming(false);
      }
    };
  }

  function handleScroll() {
    const panel = outputPanelRef.current;
    if (!panel) return;
    const distanceFromBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    setFollowTail(distanceFromBottom < 48);
  }

  // Auto-connect if the run isn't already finished
  useEffect(() => {
    if (!finished) {
      connect();
    }
    return () => {
      esRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (followTail) {
      outputPanelRef.current?.scrollTo({ top: outputPanelRef.current.scrollHeight, behavior: "smooth" });
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [followTail, output]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Space wrap>
        <Badge status={badgeStatus} text={status.toUpperCase()} />
        {streaming && <Tag color="processing">Live</Tag>}
        {!streaming && finished && <Tag color="default">Replay</Tag>}
        {exitCode !== null && <Text type="secondary">exit {exitCode}</Text>}
        {streaming && <Spin size="small" />}
        {finished && (
          <Button size="small" icon={<ReloadOutlined />} onClick={connect}>
            Re-stream
          </Button>
        )}
        <Button
          size="small"
          icon={<VerticalAlignBottomOutlined />}
          onClick={() => {
            if (followTail) {
              setFollowTail(false);
            } else {
              setFollowTail(true);
              outputPanelRef.current?.scrollTo({ top: outputPanelRef.current.scrollHeight, behavior: "smooth" });
            }
          }}
        >
          {followTail ? "Pause tail" : "Follow tail"}
        </Button>
      </Space>

      {error && <Alert type="error" showIcon message="Playbook stream error" description={error} />}

      <div
        ref={outputPanelRef}
        onScroll={handleScroll}
        style={{
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          padding: 12,
          minHeight: 200,
          maxHeight: 520,
          overflowY: "auto",
          fontFamily: "monospace",
          fontSize: 12,
          color: token.colorText,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {output || (streaming ? "Waiting for output…" : "No output.")}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
