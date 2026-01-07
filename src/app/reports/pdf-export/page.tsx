'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import AlertDialog from '@/components/AlertDialog';

interface UploadFolder {
  name: string;
  fileCount: number;
  size: number;
  lastModified: string;
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
  const [downloadingFolder, setDownloadingFolder] = useState<string | null>(null);
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

  const downloadFolder = async (folderName: string) => {
    // Prevent multiple clicks
    if (downloadingFolder) {
      return;
    }

    try {
      setDownloadingFolder(folderName);
      const response = await fetch(`/api/download-upload-folder?folder=${encodeURIComponent(folderName)}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to download folder' }));
        setAlertDialog({
          isOpen: true,
          message: errorData.error || 'Failed to download folder. It may not be available.',
          type: 'warning',
        });
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading folder:', error);
      setAlertDialog({
        isOpen: true,
        message: 'Failed to download folder. Please try again.',
        type: 'error',
      });
    } finally {
      setDownloadingFolder(null);
    }
  };

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
                        <button
                          onClick={() => downloadFolder(folder.name)}
                          disabled={downloadingFolder !== null}
                          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                            downloadingFolder === folder.name
                              ? 'bg-green-500 text-white cursor-wait'
                              : downloadingFolder !== null
                              ? 'bg-gray-400 text-white cursor-not-allowed opacity-50'
                              : 'bg-green-600 text-white hover:bg-green-700'
                          }`}
                        >
                          {downloadingFolder === folder.name ? (
                            <>
                              <svg
                                className="animate-spin w-4 h-4"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                />
                              </svg>
                              Downloading...
                            </>
                          ) : (
                            <>
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
                            </>
                          )}
                        </button>
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











