'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import Navigation from '@/components/Navigation';
import {
  parseActivityExcel,
  parseActivityCSV,
  validateActivityFile,
} from '@/lib/activity-parser';
import { ActivityStatementRow } from '@/types/player-data';
import { Member } from '@/lib/db';

interface ActivityUpload {
  file: File;
  rows: ActivityStatementRow[];
  errors: string[];
}

export default function MembersPage() {
  const [activityUpload, setActivityUpload] = useState<ActivityUpload | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'upload' | 'list'>('upload');
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [totalMembers, setTotalMembers] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) {
      alert('Please upload the activity statement file');
      return;
    }

    const validation = validateActivityFile(file);
    if (!validation.isValid) {
      alert(`Activity file validation failed: ${validation.errors.join(', ')}`);
      return;
    }

    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    const parseFile = extension === '.xlsx' ? parseActivityExcel : parseActivityCSV;

    parseFile(file)
      .then(rows => {
        setActivityUpload({
          file,
          rows,
          errors: [],
        });
        setStatus(`Loaded activity statement for ${rows.length} accounts`);
      })
      .catch(error => {
        console.error('Error parsing activity statement:', error);
        setActivityUpload({
          file,
          rows: [],
          errors: [`Error parsing activity statement: ${error.message ?? error}`],
        });
        setStatus('Error parsing activity statement');
      });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv']
    },
    multiple: false
  });

  const loadMembers = useCallback(async (page: number, size: number) => {
    try {
      setLoadingMembers(true);
      const response = await fetch(`/api/list-members?page=${page}&pageSize=${size}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setMembers(data.members || []);
          setTotalMembers(data.total || 0);
          setTotalPages(data.totalPages || 0);
          setCurrentPage(data.currentPage || 1);
        }
      }
    } catch (error) {
      console.error('Error loading members:', error);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  // Load members when switching to list tab or page changes
  useEffect(() => {
    if (activeTab === 'list') {
      loadMembers(currentPage, pageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentPage, pageSize]);

  const saveMembers = async () => {
    if (!activityUpload || activityUpload.rows.length === 0) {
      alert('No activity statement data to save');
      return;
    }

    setIsSaving(true);
    setStatus('Saving members to database...');

    try {
      const response = await fetch('/api/save-members', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activityRows: activityUpload.rows,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save members');
      }

      const data = await response.json();
      if (data.success) {
        setStatus(`Successfully saved ${data.savedCount} new members and updated ${data.updatedCount} existing members`);
        // Refresh member list if on list tab
        if (activeTab === 'list') {
          loadMembers(currentPage, pageSize);
        }
      } else {
        throw new Error(data.error || 'Failed to save members');
      }
    } catch (error) {
      console.error('Error saving members:', error);
      setStatus('Error saving members to database');
    } finally {
      setIsSaving(false);
    }
  };

  const removeFile = () => {
    setActivityUpload(null);
    setStatus('');
  };

  const downloadTemplate = async () => {
    try {
      const response = await fetch('/api/download-activity-template');
      
      if (!response.ok) {
        throw new Error('Failed to download template');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Activity_Statement_Template.xlsx';
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error downloading template:', error);
      alert('Failed to download template. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Members Registration
          </h1>
          <p className="text-gray-600">
            Upload activity statements to register members in the database. This will populate member information (name, address, suburb, etc.) that will be used in PDF generation.
          </p>
          
          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6 mt-6">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('upload')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'upload'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Upload
              </button>
              <button
                onClick={() => setActiveTab('list')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'list'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Member List
              </button>
            </nav>
          </div>
        </div>

        {/* Status */}
        {status && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
            <p className="text-sm text-blue-800">{status}</p>
          </div>
        )}

        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <>
        {/* Upload Area */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-semibold">Upload Activity Statement</h2>
              <p className="text-sm text-gray-600">Upload Excel (.xlsx) or CSV files containing activity statement data to register members.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={downloadTemplate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                📥 Download Template
              </button>
              {activityUpload && (
                <button
                  onClick={removeFile}
                  className="text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input {...getInputProps()} />
            <div className="text-gray-600">
              {isDragActive ? (
                <p>Drop the file here...</p>
              ) : (
                <div>
                  <p className="text-lg mb-2">Drag & drop Excel or CSV file here, or click to select</p>
                  <p className="text-sm text-gray-500">
                    Supports .xlsx and .csv formats. The file should contain activity statement data with member information.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Uploaded File Info */}
        {activityUpload && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-semibold">Uploaded File</h2>
              <button
                onClick={removeFile}
                className="text-red-600 hover:text-red-800"
              >
                Remove
              </button>
            </div>
            
            <div className="mb-4">
              <h3 className="font-medium">{activityUpload.file.name}</h3>
              <p className="text-sm text-gray-600">
                Accounts found: {activityUpload.rows.length}
              </p>
              {activityUpload.errors.length > 0 && (
                <div className="text-red-600 text-sm mt-2">
                  <p>Errors:</p>
                  <ul className="list-disc list-inside">
                    {activityUpload.errors.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Preview Table */}
            {activityUpload.rows.length > 0 && (
              <div className="mt-6">
                <h3 className="font-medium mb-3">Preview (first 10 accounts):</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full border border-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left border border-gray-200">Account</th>
                        <th className="px-4 py-2 text-left border border-gray-200">Name</th>
                        <th className="px-4 py-2 text-left border border-gray-200">Address</th>
                        <th className="px-4 py-2 text-left border border-gray-200">Suburb</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityUpload.rows.slice(0, 10).map((row, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-2 border border-gray-200">{row.acct}</td>
                          <td className="px-4 py-2 border border-gray-200">
                            {[row.title, row.firstName, row.lastName].filter(Boolean).join(' ')}
                          </td>
                          <td className="px-4 py-2 border border-gray-200">{row.address}</td>
                          <td className="px-4 py-2 border border-gray-200">{row.suburb}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {activityUpload.rows.length > 10 && (
                  <p className="text-sm text-gray-500 mt-2">
                    ... and {activityUpload.rows.length - 10} more accounts
                  </p>
                )}
              </div>
            )}

            {/* Save Button */}
            {activityUpload.rows.length > 0 && (
              <div className="mt-6 pt-6 border-t">
                <button
                  onClick={saveMembers}
                  disabled={isSaving}
                  className={`w-full py-3 px-6 rounded-lg font-medium ${
                    isSaving
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700'
                  } text-white transition-colors`}
                >
                  {isSaving ? 'Saving Members...' : `Save ${activityUpload.rows.length} Members to Database`}
                </button>
              </div>
            )}
          </div>
        )}
          </>
        )}

        {/* Member List Tab */}
        {activeTab === 'list' && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xl font-semibold">Member List</h2>
                <p className="text-sm text-gray-600">
                  {loadingMembers ? (
                    'Loading...'
                  ) : (
                    `Showing ${members.length} of ${totalMembers.toLocaleString()} members (Page ${currentPage} of ${totalPages})`
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1); // Reset to first page when changing page size
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  disabled={loadingMembers}
                >
                  <option value="25">25 per page</option>
                  <option value="50">50 per page</option>
                  <option value="100">100 per page</option>
                </select>
                <button
                  onClick={() => loadMembers(currentPage, pageSize)}
                  disabled={loadingMembers}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium disabled:bg-gray-400"
                >
                  {loadingMembers ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>

            {loadingMembers ? (
              <div className="text-center py-12 text-gray-500">
                <p>Loading members...</p>
              </div>
            ) : members.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg mb-2">No members found</p>
                <p className="text-sm">Upload an activity statement to register members</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border border-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Account</th>
                      <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Name</th>
                      <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Email</th>
                      <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Address</th>
                      <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Suburb</th>
                      <th className="px-4 py-3 text-left border border-gray-200 font-semibold">State</th>
                      <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Post Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 border border-gray-200">{member.account_number}</td>
                        <td className="px-4 py-2 border border-gray-200">
                          {[member.title, member.first_name, member.last_name].filter(Boolean).join(' ')}
                        </td>
                        <td className="px-4 py-2 border border-gray-200">{member.email || '-'}</td>
                        <td className="px-4 py-2 border border-gray-200">{member.address || '-'}</td>
                        <td className="px-4 py-2 border border-gray-200">{member.suburb || '-'}</td>
                        <td className="px-4 py-2 border border-gray-200">{member.state || '-'}</td>
                        <td className="px-4 py-2 border border-gray-200">{member.post_code || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {!loadingMembers && totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <span className="px-4 py-2 text-sm text-gray-700">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Last
                  </button>
                </div>
                <div className="text-sm text-gray-600">
                  Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalMembers)} of {totalMembers.toLocaleString()} members
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

