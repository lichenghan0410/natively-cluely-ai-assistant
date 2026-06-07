/**
 * ModesSettings - local implementation (replaces the empty premium stub).
 * Uses the modes* IPC already exposed in preload. Create a mode from a
 * template, activate/deactivate, view seeded reference files + note sections,
 * and delete. Enough to drive the Japrise acceptance flow without premium.
 */
import React, { useCallback, useEffect, useState } from 'react';

type Mode = { id: string; name: string; templateType: string; customContext: string; isActive: boolean; createdAt: string; referenceFileCount: number };
type RefFile = { id: string; modeId: string; fileName: string; content: string; createdAt: string };
type NoteSection = { id: string; modeId: string; title: string; description: string; sortOrder: number; createdAt: string };

const TEMPLATES: Array<{ value: string; label: string }> = [
  { value: 'japrise', label: 'Japrise (Japanese oral practice)' },
  { value: 'general', label: 'General' },
  { value: 'technical-interview', label: 'Technical Interview' },
  { value: 'looking-for-work', label: 'Looking for Work' },
  { value: 'sales', label: 'Sales' },
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'team-meet', label: 'Team Meeting' },
  { value: 'lecture', label: 'Lecture' },
];

export function ModesSettings(props: { onClose?: () => void } & Record<string, any>) {
  const api: any = (window as any).electronAPI;
  const [modes, setModes] = useState<Mode[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('Japrise Practice');
  const [tpl, setTpl] = useState('japrise');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [files, setFiles] = useState<RefFile[]>([]);
  const [notes, setNotes] = useState<NoteSection[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setModes(await api.modesGetAll()); }
    catch (e: any) { setErr(String(e?.message || e)); }
    setLoading(false);
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.modesCreate({ name: name.trim() || tpl, templateType: tpl });
      if (!r?.success) setErr(r?.error || 'create failed');
    } catch (e: any) { setErr(String(e?.message || e)); }
    await refresh(); setBusy(false);
  };

  const setActive = async (id: string | null) => {
    setBusy(true); setErr(null);
    try { await api.modesSetActive(id); } catch (e: any) { setErr(String(e?.message || e)); }
    await refresh(); setBusy(false);
  };

  const del = async (id: string) => {
    setBusy(true); setErr(null);
    try { await api.modesDelete(id); if (expanded === id) setExpanded(null); }
    catch (e: any) { setErr(String(e?.message || e)); }
    await refresh(); setBusy(false);
  };

  const toggle = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id); setFiles([]); setNotes([]);
    try {
      setFiles(await api.modesGetReferenceFiles(id));
      setNotes(await api.modesGetNoteSections(id));
    } catch (e: any) { setErr(String(e?.message || e)); }
  };

  const S: Record<string, React.CSSProperties> = {
    panel: { width: 560, maxWidth: '92vw', maxHeight: '82vh', overflow: 'auto', background: '#1b1b1e', color: '#e8e8ea', borderRadius: 16, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.08)', fontFamily: 'system-ui, sans-serif' },
    head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    h: { fontSize: 16, fontWeight: 700 },
    x: { cursor: 'pointer', background: 'transparent', border: 'none', color: '#aaa', fontSize: 18 },
    row: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' },
    input: { flex: 1, minWidth: 160, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#252528', color: '#fff' },
    sel: { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#252528', color: '#fff' },
    btn: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontWeight: 600 },
    gbtn: { padding: '6px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#ddd', cursor: 'pointer', fontSize: 12 },
    card: { border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, marginBottom: 10, background: '#212124' },
    badge: { fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#16a34a', color: '#fff', marginLeft: 8 },
    file: { borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8, marginTop: 8 },
    pre: { whiteSpace: 'pre-wrap', fontSize: 12, color: '#bbb', maxHeight: 140, overflow: 'auto', margin: '4px 0 0', background: '#161618', padding: 8, borderRadius: 6 },
    err: { color: '#f87171', fontSize: 13, marginBottom: 10 },
  };

  return (
    <div style={S.panel} onClick={(e) => e.stopPropagation()}>
      <div style={S.head}>
        <div style={S.h}>Modes Manager (local)</div>
        <button style={S.x} onClick={() => props.onClose?.()}>x</button>
      </div>

      <div style={S.row}>
        <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Mode name" />
        <select style={S.sel} value={tpl} onChange={(e) => setTpl(e.target.value)}>
          {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button style={S.btn} disabled={busy} onClick={create}>Create</button>
      </div>

      {err && <div style={S.err}>Error: {err}</div>}

      {loading ? <div>Loading...</div> : modes.length === 0 ? (
        <div style={{ color: '#999' }}>No modes yet. Create one above.</div>
      ) : (
        modes.map((m) => (
          <div key={m.id} style={S.card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <strong>{m.name}</strong>
                <span style={{ color: '#888', fontSize: 12, marginLeft: 8 }}>[{m.templateType}] - {m.referenceFileCount} files</span>
                {m.isActive && <span style={S.badge}>ACTIVE</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={S.gbtn} disabled={busy} onClick={() => setActive(m.isActive ? null : m.id)}>{m.isActive ? 'Deactivate' : 'Activate'}</button>
                <button style={S.gbtn} disabled={busy} onClick={() => toggle(m.id)}>{expanded === m.id ? 'Hide' : 'Details'}</button>
                <button style={{ ...S.gbtn, color: '#f87171' }} disabled={busy} onClick={() => del(m.id)}>Delete</button>
              </div>
            </div>
            {expanded === m.id && (
              <div style={S.file}>
                <div style={{ fontSize: 12, color: '#9ad' }}>Reference files ({files.length})</div>
                {files.map((file) => (
                  <div key={file.id} style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{file.fileName}</div>
                    <pre style={S.pre}>{file.content}</pre>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: '#9ad', marginTop: 10 }}>Note sections ({notes.length})</div>
                {notes.map((n) => (
                  <div key={n.id} style={{ fontSize: 12, color: '#ccc', marginTop: 4 }}>- {n.title}: {n.description}</div>
                ))}
              </div>
            )}
          </div>
        ))
      )}

      <div style={{ fontSize: 11, color: '#777', marginTop: 12 }}>Tip: activate the Japrise mode, then play a part opening line to trigger the instant panel.</div>
    </div>
  );
}

export default ModesSettings;