'use client';

import { useEffect } from 'react';

interface ExportResultsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  successCount: number;
  failedCount: number;
  failedAccounts?: string[];
}

export default function ExportResultsDialog({
  isOpen,
  onClose,
  successCount,
  failedCount,
  failedAccounts = [],
}: ExportResultsDialogProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Export Results</h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <div className="space-y-3 text-white">
            <p className="text-base">
              Successfully exported {successCount} PDF{successCount !== 1 ? 's' : ''}
            </p>
            
            {failedCount > 0 && (
              <>
                <p className="text-base">
                  Note: {failedCount} PDF{failedCount !== 1 ? 's' : ''} failed to export.
                </p>
                
                {failedAccounts.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-medium mb-2">Failed accounts:</p>
                    <div className="bg-gray-700 rounded p-3 max-h-32 overflow-y-auto">
                      <p className="text-sm text-gray-300 break-words">
                        {failedAccounts.join(', ')}
                        {failedAccounts.length < failedCount && '...'}
                      </p>
                    </div>
                  </div>
                )}
                
                <p className="text-sm text-gray-400 mt-3">
                  Check the console for more details.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}















