import { useState, useEffect } from 'react';
import { StylePanel } from '../components/StylePanel';
import { PRESETS } from '../presets';
import type { StyleConfig } from '../types';

export function SettingsPage() {
  const [style, setStyle] = useState<StyleConfig>(PRESETS['dense']);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json() as Promise<{ defaultStyle: StyleConfig | null }>)
      .then(data => {
        if (data.defaultStyle) setStyle(data.defaultStyle);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function save() {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultStyle: style }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return <div className="p-6 text-gray-500 text-sm">Loading…</div>;

  return (
    <div className="max-w-sm mx-auto p-6">
      <h1 className="text-lg font-semibold text-white mb-1">Global Default Style</h1>
      <p className="text-xs text-gray-500 mb-6">
        Applied when opening an image with no saved annotation. Can be overridden per-image in the editor.
      </p>

      <StylePanel
        style={style}
        defaultStyle={style}
        isOverride={false}
        onChange={setStyle}
      />

      <button
        onClick={save}
        className="mt-6 w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
      >
        {saved ? 'Saved ✓' : 'Save as Default'}
      </button>
    </div>
  );
}
