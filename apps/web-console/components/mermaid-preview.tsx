"use client";

import { useEffect, useMemo, useState } from "react";

interface MermaidPreviewProps {
  source: string;
}

export function MermaidPreview({ source }: MermaidPreviewProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const graphId = useMemo(
    () => `mermaid-${Math.random().toString(36).slice(2, 10)}`,
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function renderMermaid() {
      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "default"
        });
        const rendered = await mermaid.render(graphId, source);
        if (!cancelled) {
          setSvg(rendered.svg);
          setError(null);
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg(null);
          setError(renderError instanceof Error ? renderError.message : "Failed to render mermaid diagram");
        }
      }
    }

    void renderMermaid();

    return () => {
      cancelled = true;
    };
  }, [graphId, source]);

  if (error) {
    return <p className="error-text">Mermaid render failed: {error}</p>;
  }

  if (!svg) {
    return <p>Rendering diagram preview...</p>;
  }

  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}
