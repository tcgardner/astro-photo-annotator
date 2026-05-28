import { useState, useEffect, useCallback, useRef } from 'react';
import type { Annotation, Marker, StyleConfig, SolveStatus } from '../types';
import { PRESETS } from '../presets';

interface AnnotationState {
  annotation: Annotation | null;
  markers: Marker[];
  style: StyleConfig;
  defaultStyle: StyleConfig;
  solveStatus: SolveStatus;
  loading: boolean;
  error: string | null;
  exportResult: { astroDbImageId: number; fileUrl: string } | null;
}

export function useAnnotation(imageId: string | null) {
  const [state, setState] = useState<AnnotationState>({
    annotation: null,
    markers: [],
    style: PRESETS['dense'],
    defaultStyle: PRESETS['dense'],
    solveStatus: 'none',
    loading: false,
    error: null,
    exportResult: null,
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const annotationIdRef = useRef<number | null>(null);

  function clearPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  // Load annotation on mount / when imageId changes (imageId is the astro-db numeric ID as string)
  useEffect(() => {
    if (!imageId) return;
    clearPoll();
    setState(s => ({ ...s, loading: true, error: null, exportResult: null }));

    fetch(`/api/annotations?imagePath=${encodeURIComponent(imageId)}`)
      .then(r => r.json() as Promise<{
        annotation: (Annotation & { style: StyleConfig }) | null;
        defaultStyle: StyleConfig;
        resolvedStyle: StyleConfig;
      }>)
      .then(data => {
        const ann = data.annotation;
        annotationIdRef.current = ann?.id ?? null;

        setState(s => ({
          ...s,
          annotation: ann,
          markers: ann?.markers ?? [],
          style: data.resolvedStyle,
          defaultStyle: data.defaultStyle,
          solveStatus: (ann?.solveStatus ?? 'none') as SolveStatus,
          loading: false,
        }));

        // Resume polling if in-progress from a previous session
        if (ann && (ann.solveStatus === 'solving' || ann.solveStatus === 'uploading')) {
          startPollStatus(ann.id);
        }
      })
      .catch(err => {
        setState(s => ({ ...s, loading: false, error: String(err) }));
      });

    return () => { clearPoll(); };
  }, [imageId]);

  function startPollStatus(annId: number) {
    clearPoll();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/solve/${annId}/status`);
        const data = await r.json() as {
          status: SolveStatus; markers?: Marker[]; wcs?: unknown; catalogId?: string;
        };
        setState(s => ({
          ...s,
          solveStatus: data.status,
          markers: data.markers ?? s.markers,
          annotation: s.annotation
            ? { ...s.annotation, solveStatus: data.status, markers: data.markers ?? s.annotation.markers, catalogId: data.catalogId ?? s.annotation.catalogId }
            : s.annotation,
        }));
        if (data.status === 'solved' || data.status === 'failed') {
          clearPoll();
        }
      } catch {
        // network error, keep polling
      }
    }, 5000);
  }

  const plateSolve = useCallback(async () => {
    if (!imageId) return;
    setState(s => ({ ...s, solveStatus: 'uploading', error: null }));

    try {
      // Create annotation row if needed
      if (!annotationIdRef.current) {
        const cr = await fetch('/api/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imagePath: imageId }),
        });
        const cd = await cr.json() as { id: number };
        annotationIdRef.current = cd.id;
      }

      const r = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: Number(imageId) }),
      });
      const data = await r.json() as { id: number; status: SolveStatus; markers?: Marker[]; wcs?: unknown };
      annotationIdRef.current = data.id;

      setState(s => ({
        ...s,
        solveStatus: data.status,
        markers: data.markers ?? s.markers,
      }));

      if (data.status === 'solving') {
        startPollStatus(data.id);
      }
    } catch (err) {
      setState(s => ({ ...s, solveStatus: 'failed', error: String(err) }));
    }
  }, [imageId]);

  const scheduleSave = useCallback((markers: Marker[], style: StyleConfig) => {
    if (!annotationIdRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (!annotationIdRef.current) return;
      fetch(`/api/annotations/${annotationIdRef.current}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markers, style }),
      }).catch(console.error);
    }, 1000);
  }, []);

  const updateMarkers = useCallback((markers: Marker[]) => {
    setState(s => {
      scheduleSave(markers, s.style);
      return { ...s, markers };
    });
  }, [scheduleSave]);

  const updateStyle = useCallback((style: StyleConfig) => {
    setState(s => {
      scheduleSave(s.markers, style);
      return { ...s, style };
    });
  }, [scheduleSave]);

  const updateCatalogId = useCallback((catalogId: string) => {
    setState(s => ({
      ...s,
      annotation: s.annotation ? { ...s.annotation, catalogId } : s.annotation,
    }));
    if (annotationIdRef.current) {
      fetch(`/api/annotations/${annotationIdRef.current}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogId }),
      }).catch(console.error);
    }
  }, []);

  const exportImage = useCallback(async () => {
    if (!annotationIdRef.current) return;
    setState(s => ({ ...s, loading: true, exportResult: null, error: null }));
    try {
      const r = await fetch(`/api/annotations/${annotationIdRef.current}/export`, { method: 'POST' });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as { astroDbImageId: number; fileUrl: string };
      setState(s => ({ ...s, loading: false, exportResult: data }));
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: String(err) }));
    }
  }, []);

  return {
    ...state,
    annotationId: annotationIdRef.current,
    plateSolve,
    updateMarkers,
    updateStyle,
    updateCatalogId,
    exportImage,
  };
}
