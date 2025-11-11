'use client';

import { useState, useCallback, useEffect } from 'react';
import Navigation from '@/components/Navigation';
import { MemberWithBatch } from '@/lib/db';

export default function MembersPage() {
  const [members, setMembers] = useState<MemberWithBatch[]>([]);
  const [loadingMembers, setLoadingMembers] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [totalMembers, setTotalMembers] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);

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

  const exportToCSV = useCallback(() => {
    if (members.length === 0) {
      alert('No members to export');
      return;
    }

    // Create CSV header
    const headers = ['Account', 'Name', 'Email', 'Address', 'Suburb', 'State', 'Post Code', 'Latest Quarter', 'PDF Link'];
    
    // Create CSV rows
    const rows = members.map(member => {
      const fullName = [member.title, member.first_name, member.last_name].filter(Boolean).join(' ');
      const quarterInfo = member.latest_quarter && member.latest_year 
        ? `Q${member.latest_quarter} ${member.latest_year}`
        : 'N/A';
      const pdfLink = member.latest_batch_id 
        ? `https://skycity.dailypress.agency/content/files/${member.account_number}/${member.latest_batch_id}/`
        : 'N/A';
      
      return [
        member.account_number,
        fullName,
        member.email || '',
        member.address || '',
        member.suburb || '',
        member.state || '',
        member.post_code || '',
        quarterInfo,
        pdfLink
      ];
    });

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `members_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [members]);

  // Load members on component mount and when page changes
  useEffect(() => {
    loadMembers(currentPage, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Member Information
          </h1>
        </div>

        {/* Member List */}
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
                <button
                  onClick={exportToCSV}
                  disabled={loadingMembers || members.length === 0}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:bg-gray-400"
                >
                  Export to CSV
                </button>
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
                <p className="text-sm">Members are automatically added when Activity Statement Templates are uploaded on the Quarterly Statement page</p>
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
                      <th className="px-4 py-3 text-left border border-gray-200 font-semibold">PDF Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => {
                      const previewUrl = member.latest_batch_id
                        ? `/content/files/${member.account_number}/${member.latest_batch_id}/`
                        : null;
                      
                      return (
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
                          <td className="px-4 py-2 border border-gray-200">
                            {previewUrl ? (
                              <a
                                href={previewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 text-sm underline"
                              >
                                Preview
                              </a>
                            ) : (
                              <span className="text-gray-400 text-sm">No PDF available</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
      </div>
    </div>
  );
}

