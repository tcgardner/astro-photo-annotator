import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface FolderEntry { type: 'dir'; name: string }
interface ImageEntry { type: 'image'; name: string; rel: string; url: string; hasAnnotations: boolean }
type Entry = FolderEntry | ImageEntry;

interface DirListing {
  folders: string[];
  images: { name: string; rel: string; url: string; hasAnnotations: boolean }[];
}

export function BrowserPage() {
  const navigate = useNavigate();
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/images?path=${encodeURIComponent(currentPath)}`)
      .then(r => r.json() as Promise<DirListing>)
      .then(data => {
        const dirs: Entry[] = data.folders.sort().map(name => ({ type: 'dir', name }));
        const imgs: Entry[] = data.images.map(img => ({ type: 'image', ...img }));
        setEntries([...dirs, ...imgs]);
        setLoading(false);
      })
      .catch(err => {
        setError(String(err));
        setLoading(false);
      });
  }, [currentPath]);

  function breadcrumbs(): { label: string; path: string }[] {
    const parts = currentPath ? currentPath.replace(/\\/g, '/').split('/').filter(Boolean) : [];
    const crumbs = [{ label: 'Stacks', path: '' }];
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }

  function navigateInto(folderName: string) {
    const next = currentPath
      ? `${currentPath.replace(/\\/g, '/')}/${folderName}`
      : folderName;
    setCurrentPath(next);
  }

  function openImage(rel: string) {
    navigate(`/annotate?path=${encodeURIComponent(rel)}`);
  }

  const crumbs = breadcrumbs();

  return (
    <div className="p-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm mb-4 flex-wrap">
        {crumbs.map((c, i) => (
          <span key={c.path} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-600">/</span>}
            <button
              onClick={() => setCurrentPath(c.path)}
              className={`hover:text-white ${i === crumbs.length - 1 ? 'text-white' : 'text-gray-400'}`}
            >
              {c.label}
            </button>
          </span>
        ))}
      </nav>

      {loading && <div className="text-gray-500 text-sm">Loading…</div>}
      {error && <div className="text-red-400 text-sm">{error}</div>}

      {!loading && !error && entries.length === 0 && (
        <div className="text-gray-500 text-sm">
          {currentPath ? 'No images or folders found here.' : 'STACKS_DIR is empty or not configured.'}
        </div>
      )}

      {/* Folders */}
      {entries.filter(e => e.type === 'dir').length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Folders</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {(entries.filter(e => e.type === 'dir') as FolderEntry[]).map(d => (
              <button
                key={d.name}
                onClick={() => navigateInto(d.name)}
                className="flex items-center gap-2 p-2 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 text-left"
              >
                <span className="text-yellow-400">📁</span>
                <span className="text-sm text-gray-200 truncate">{d.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Images */}
      {(entries.filter(e => e.type === 'image') as ImageEntry[]).length > 0 && (
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Images</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {(entries.filter(e => e.type === 'image') as ImageEntry[]).map(img => (
              <button
                key={img.rel}
                onClick={() => openImage(img.rel)}
                className="group relative rounded border border-gray-700 overflow-hidden bg-gray-900 hover:border-blue-500 transition-colors text-left"
              >
                <img
                  src={img.url}
                  alt={img.name}
                  className="w-full aspect-square object-cover opacity-80 group-hover:opacity-100"
                  loading="lazy"
                />
                <div className="p-1.5">
                  <div className="text-xs text-gray-300 truncate">{img.name}</div>
                  {img.hasAnnotations && (
                    <div className="text-xs text-green-400 mt-0.5">Annotated ✓</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
