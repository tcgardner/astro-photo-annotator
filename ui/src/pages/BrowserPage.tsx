import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface CatalogImage {
  id: number;
  catalog_id: string;
  filename: string;
  common_name: string | null;
  url: string;
  hasAnnotations: boolean;
}

export function BrowserPage() {
  const navigate = useNavigate();
  const [images, setImages] = useState<CatalogImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/images')
      .then(r => r.json() as Promise<{ images: CatalogImage[] }>)
      .then(data => {
        setImages(data.images);
        setLoading(false);
      })
      .catch(err => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-4">astro-db images</div>

      {loading && <div className="text-gray-500 text-sm">Loading…</div>}
      {error && <div className="text-red-400 text-sm">{error}</div>}

      {!loading && !error && images.length === 0 && (
        <div className="text-gray-500 text-sm">
          No images in astro-db. Upload some via astro-photo-renamer.
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {images.map(img => (
            <button
              key={img.id}
              onClick={() => navigate(`/annotate?id=${img.id}`)}
              className="group relative rounded border border-gray-700 overflow-hidden bg-gray-900 hover:border-blue-500 transition-colors text-left"
            >
              <img
                src={img.url}
                alt={img.filename}
                className="w-full aspect-square object-cover opacity-80 group-hover:opacity-100"
                loading="lazy"
              />
              <div className="p-1.5">
                <div className="text-xs text-white truncate font-medium">{img.catalog_id}</div>
                <div className="text-xs text-gray-400 truncate">{img.filename}</div>
                {img.hasAnnotations && (
                  <div className="text-xs text-green-400 mt-0.5">Annotated ✓</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
