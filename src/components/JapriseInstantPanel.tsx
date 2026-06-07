import { useEffect, useState } from 'react';

type InstantRef = { part: number; partName: string; directive: string; reference: string };

/**
 * ADR-005 Phase 2.4 — instant retrieval panel.
 *
 * Shows the active Japrise part's fully-local reference card the moment a part is
 * detected in the transcript. It's driven by the `intelligence-japrise-instant-
 * reference` IPC event, which the main process emits independently of the cloud
 * coaching stream — so this panel works instantly and offline. Self-contained:
 * mount <JapriseInstantPanel /> wherever the assist UI should surface local
 * reference material; it renders nothing until a part is detected.
 */
export default function JapriseInstantPanel() {
  const [data, setData] = useState<InstantRef | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.onJapriseInstantReference) return;
    const unsubscribe = window.electronAPI.onJapriseInstantReference((payload: InstantRef) => {
      setData(payload);
    });
    return () => unsubscribe();
  }, []);

  if (!data) return null;

  return (
    <div className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle">
      <div className="flex items-center gap-2 mb-2">
        <span className="bg-blue-500/10 text-blue-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-blue-500/20">
          PART {data.part}
        </span>
        <span className="text-xs font-medium text-text-primary">{data.partName}</span>
        <span className="text-[9px] text-text-secondary ml-auto">ローカル参考 · オフライン可</span>
      </div>
      <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-text-secondary font-sans m-0">
        {data.reference}
      </pre>
    </div>
  );
}
