'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';

interface ExportJob {
  id: string;
  tab_type: string;
  status: string;
  total_members: number;
  processed_members: number;
  failed_members: number;
  progress_percentage: number;
  created_at: string;
  completed_at: string | null;
  file_size: number | null;
  error_message: string | null;
}

export default function PDFExportPage() {
  const [exportHistory, setExportHistory] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const loadExportHistory = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/export-pdfs-bulk/list?limit=50');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setExportHistory(data.exports || []);
        }
      }
    } catch (error) {
      console.error('Error loading export history:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExportHistory();
  }, [loadExportHistory]);

  // Poll for updates if there are any processing exports
  useEffect(() => {
    const hasProcessing = exportHistory.some(exp => exp.status === 'processing');
    if (hasProcessing) {
      const interval = setInterval(() => {
        loadExportHistory();
      }, 3000); // Poll every 3 seconds
      return () => clearInterval(interval);
    }
  }, [exportHistory, loadExportHistory]);

  const downloadExport = async (exportId: string) => {
    try {
      const response = await fetch(`/api/export-pdfs-bulk/${exportId}/download`);
      if (!response.ok) {
        alert('Failed to download export. It may not be ready yet.');
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bulk_export_${exportId.substring(0, 8)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading export:', error);
      alert('Failed to download export. Please try again.');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'processing':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getProgressBarColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-600';
      case 'processing':
        return 'bg-blue-600';
      case 'failed':
        return 'bg-red-600';
      default:
        return 'bg-gray-400';
    }
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
            View and download completed PDF export jobs
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          {exportHistory.length === 0 && !loading ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg mb-2">No export history</p>
              <p className="text-sm">Export jobs will appear here once you start a bulk export.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {exportHistory.map((exp) => (
                <div
                  key={exp.id}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900 capitalize">
                          {exp.tab_type.replace('-', ' ')}
                        </h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(exp.status)}`}>
                          {exp.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <div>
                          Created: {new Date(exp.created_at).toLocaleString()}
                        </div>
                        {exp.completed_at && (
                          <div>
                            Completed: {new Date(exp.completed_at).toLocaleString()}
                          </div>
                        )}
                        {exp.file_size && (
                          <div>
                            File Size: {(exp.file_size / 1024 / 1024).toFixed(2)} MB
                          </div>
                        )}
                      </div>
                    </div>
                    {exp.status === 'completed' && (
                      <button
                        onClick={() => downloadExport(exp.id)}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                      >
                        Download
                      </button>
                    )}
                  </div>

                  <div className="mt-3">
                    <div className="flex justify-between text-sm text-gray-600 mb-2">
                      <span>
                        {exp.processed_members.toLocaleString()} / {exp.total_members.toLocaleString()} processed
                        {exp.failed_members > 0 && (
                          <span className="text-red-600 ml-2">
                            ({exp.failed_members} failed)
                          </span>
                        )}
                      </span>
                      <span className="font-medium">{exp.progress_percentage}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${getProgressBarColor(exp.status)}`}
                        style={{ width: `${exp.progress_percentage}%` }}
                      ></div>
                    </div>
                  </div>

                  {exp.error_message && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                      <strong>Error:</strong> {exp.error_message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
