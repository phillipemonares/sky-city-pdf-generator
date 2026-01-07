'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import AlertDialog from '@/components/AlertDialog';

interface UploadFolder {
  name: string;
  fileCount: number;
  size: number;
  lastModified: string;
  hasZip: boolean;
}

interface AlertDialogState {
  isOpen: boolean;
  message: string;
  title?: string;
  type?: 'info' | 'error' | 'warning';
}

export default function PDFExportPage() {
  const [folders, setFolders] = useState<UploadFolder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [alertDialog, setAlertDialog] = useState<AlertDialogState | null>(null);

  const loadFolders = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/list-upload-folders');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setFolders(data.folders || []);
        }
      }
    } catch (error) {
      console.error('Error loading folders:', error);
      setAlertDialog({
        isOpen: true,
        message: 'Failed to load folders. Please try again.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);


  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="w-full px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            PDF Export
          </h1>
          <p className="text-gray-600">
            View and download PDF folders from uploads directory
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          {loading ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">Loading folders...</p>
            </div>
          ) : folders.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg mb-2">No folders found</p>
              <p className="text-sm">Folders will appear here once PDFs are generated and saved to the uploads directory.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Folder Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Files
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Size
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Modified
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {folders.map((folder) => (
                    <tr key={folder.name} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-semibold text-gray-900">
                          {folder.name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">
                          {folder.fileCount.toLocaleString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">
                          {formatFileSize(folder.size)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600">
                          {new Date(folder.lastModified).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        {folder.hasZip ? (
                          <a
                            href={`/api/download-upload-folder?folder=${encodeURIComponent(folder.name)}`}
                            download={`${folder.name}.zip`}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium bg-green-600 text-white hover:bg-green-700"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                              />
                            </svg>
                            Download ZIP
                          </a>
                        ) : (
                          <span className="text-sm text-gray-400 italic">
                            ZIP not available
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Alert Dialog */}
      {alertDialog && (
        <AlertDialog
          isOpen={alertDialog.isOpen}
          onClose={() => setAlertDialog(null)}
          message={alertDialog.message}
          title={alertDialog.title}
          type={alertDialog.type}
        />
      )}
    </div>
  );
}











