'use client';

import { useState, useEffect } from 'react';

interface AdvancedFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (filters: { is_email: string | null; is_postal: string | null }) => void;
  activeTab: 'quarterly' | 'play' | 'no-play';
  currentFilters: { is_email: string | null; is_postal: string | null };
}

export default function AdvancedFilterModal({
  isOpen,
  onClose,
  onApply,
  activeTab,
  currentFilters,
}: AdvancedFilterModalProps) {
  const [isEmail, setIsEmail] = useState<string | null>(currentFilters.is_email);
  const [isPostal, setIsPostal] = useState<string | null>(currentFilters.is_postal);

  useEffect(() => {
    if (isOpen) {
      setIsEmail(currentFilters.is_email);
      setIsPostal(currentFilters.is_postal);
    }
  }, [isOpen, currentFilters]);

  if (!isOpen) return null;

  const handleApply = () => {
    onApply({
      is_email: isEmail,
      is_postal: isPostal,
    });
    onClose();
  };

  const handleClear = () => {
    setIsEmail(null);
    setIsPostal(null);
  };

  const hasFilters = isEmail !== null || isPostal !== null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Advanced Filter</h2>
        </div>
        
        <div className="px-6 py-4 space-y-4">
          {/* Is Email Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Is Email
            </label>
            <select
              value={isEmail || ''}
              onChange={(e) => setIsEmail(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All</option>
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </div>

          {/* Is Postal Filter - only show for quarterly tab */}
          {activeTab === 'quarterly' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Is Postal
              </label>
              <select
                value={isPostal || ''}
                onChange={(e) => setIsPostal(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All</option>
                <option value="1">Yes</option>
                <option value="0">No</option>
              </select>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={handleClear}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Apply Filter{hasFilters ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}




