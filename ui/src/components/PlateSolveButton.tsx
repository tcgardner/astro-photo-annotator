import type { SolveStatus } from '../types';

interface Props {
  status: SolveStatus;
  onSolve: () => void;
}

const STATUS_LABEL: Record<SolveStatus, string> = {
  none: 'Plate Solve',
  uploading: 'Uploading…',
  solving: 'Solving…',
  solved: 'Re-solve ↺',
  failed: 'Failed — Retry',
};

const STATUS_CLASS: Record<SolveStatus, string> = {
  none: 'bg-blue-600 hover:bg-blue-500 text-white',
  uploading: 'bg-gray-600 text-gray-300 cursor-wait',
  solving: 'bg-gray-600 text-gray-300 cursor-wait',
  solved: 'bg-green-800 hover:bg-green-700 text-green-200',
  failed: 'bg-red-700 hover:bg-red-600 text-white',
};

export function PlateSolveButton({ status, onSolve }: Props) {
  const busy = status === 'uploading' || status === 'solving';

  return (
    <div>
      <button
        onClick={onSolve}
        disabled={busy}
        className={`w-full py-2 px-3 rounded text-sm font-medium transition-colors ${STATUS_CLASS[status]}`}
      >
        {STATUS_LABEL[status]}
      </button>
      {(status === 'uploading' || status === 'solving') && (
        <p className="text-xs text-gray-500 mt-1 text-center">
          {status === 'uploading' ? 'Uploading to Astrometry.net…' : 'Plate solving, polling every 5s…'}
        </p>
      )}
    </div>
  );
}
