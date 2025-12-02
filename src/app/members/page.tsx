'use client';

import { useState, useCallback, useEffect } from 'react';
import Navigation from '@/components/Navigation';
import { MemberWithBatch, NoPlayMemberWithBatch, PlayMemberWithBatch } from '@/lib/db';

export default function MembersPage() {
  const [members, setMembers] = useState<MemberWithBatch[]>([]);
  const [playMembers, setPlayMembers] = useState<PlayMemberWithBatch[]>([]);
  const [noPlayMembers, setNoPlayMembers] = useState<NoPlayMemberWithBatch[]>([]);
  const [loadingMembers, setLoadingMembers] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [totalMembers, setTotalMembers] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'quarterly' | 'play' | 'no-play'>('quarterly');

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

  const loadPlayMembers = useCallback(async (page: number, size: number) => {
    try {
      setLoadingMembers(true);
      const response = await fetch(`/api/list-play-members?page=${page}&pageSize=${size}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setPlayMembers(data.members || []);
          setTotalMembers(data.total || 0);
          setTotalPages(data.totalPages || 0);
          setCurrentPage(data.currentPage || 1);
        }
      }
    } catch (error) {
      console.error('Error loading play members:', error);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  const loadNoPlayMembers = useCallback(async (page: number, size: number) => {
    try {
      setLoadingMembers(true);
      const response = await fetch(`/api/list-no-play-members?page=${page}&pageSize=${size}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setNoPlayMembers(data.members || []);
          setTotalMembers(data.total || 0);
          setTotalPages(data.totalPages || 0);
          setCurrentPage(data.currentPage || 1);
        }
      }
    } catch (error) {
      console.error('Error loading no-play members:', error);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  const handleSelectMember = useCallback((memberId: string) => {
    setSelectedMembers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(memberId)) {
        newSet.delete(memberId);
      } else {
        newSet.add(memberId);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      const memberIds = activeTab === 'quarterly'
        ? members.map(m => m.id)
        : activeTab === 'play'
        ? playMembers.map(m => m.account_number)
        : noPlayMembers.map(m => m.account_number);
      setSelectedMembers(new Set(memberIds));
    } else {
      setSelectedMembers(new Set());
    }
  }, [members, playMembers, noPlayMembers, activeTab]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedMembers.size === 0) {
      alert('Please select at least one member to delete');
      return;
    }

    // Only allow deletion for quarterly members (pre-commitment members are not in the members table)
    if (activeTab === 'play' || activeTab === 'no-play') {
      alert('Deletion is not available for pre-commitment members. These are managed through batches.');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedMembers.size} member(s)? This action cannot be undone.`)) {
      return;
    }

    try {
      setDeleting(true);
      const response = await fetch('/api/delete-member', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberIds: Array.from(selectedMembers),
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        // Clear selection and reload members
        setSelectedMembers(new Set());
        await loadMembers(currentPage, pageSize);
        alert(`Successfully deleted ${data.deletedCount} member(s)`);
      } else {
        alert(`Error: ${data.error || 'Failed to delete members'}`);
      }
    } catch (error) {
      console.error('Error deleting members:', error);
      alert('Failed to delete members. Please try again.');
    } finally {
      setDeleting(false);
    }
  }, [selectedMembers, currentPage, pageSize, loadMembers, activeTab]);

  const exportToCSV = useCallback(() => {
    if (activeTab === 'quarterly') {
      if (members.length === 0) {
        alert('No members to export');
        return;
      }

      // Create CSV header
      const headers = ['Account', 'Name', 'Email', 'Address', 'Suburb', 'State', 'Post Code', 'Is Email', 'Is Postal', 'Latest Quarter', 'PDF Link'];
      
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
          member.is_email ? 'Yes' : 'No',
          member.is_postal ? 'Yes' : 'No',
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
      link.setAttribute('download', `quarterly_members_export_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (activeTab === 'play') {
      if (playMembers.length === 0) {
        alert('No members to export');
        return;
      }

      // Create CSV header for play
      const headers = ['Account', 'Name', 'Email', 'Address', 'Suburb', 'Statement Period', 'Statement Date', 'PDF Link'];
      
      // Create CSV rows
      const rows = playMembers.map(member => {
        const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || 'Name unavailable';
        const address = [member.address1, member.address2].filter(Boolean).join(', ').trim() || '';
        const pdfLink = member.latest_play_batch_id 
          ? `https://skycity.dailypress.agency/content/play/${member.account_number}/${member.latest_play_batch_id}/`
          : 'N/A';
        
        return [
          member.account_number,
          fullName,
          member.email || '',
          address,
          member.suburb || '',
          member.statement_period || '',
          member.statement_date || '',
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
      link.setAttribute('download', `play_members_export_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      if (noPlayMembers.length === 0) {
        alert('No members to export');
        return;
      }

      // Create CSV header for no-play
      const headers = ['Account', 'Name', 'Email', 'Address', 'Suburb', 'Statement Period', 'Statement Date', 'PDF Link'];
      
      // Create CSV rows
      const rows = noPlayMembers.map(member => {
        const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || 'Name unavailable';
        const address = [member.address1, member.address2].filter(Boolean).join(', ').trim() || '';
        const pdfLink = member.latest_no_play_batch_id 
          ? `https://skycity.dailypress.agency/content/no-play/${member.account_number}/${member.latest_no_play_batch_id}/`
          : 'N/A';
        
        return [
          member.account_number,
          fullName,
          member.email || '',
          address,
          member.suburb || '',
          member.statement_period || '',
          member.statement_date || '',
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
      link.setAttribute('download', `no_play_members_export_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [members, playMembers, noPlayMembers, activeTab]);

  // Load members on component mount and when page/tab changes
  useEffect(() => {
    if (activeTab === 'quarterly') {
      loadMembers(currentPage, pageSize);
    } else if (activeTab === 'play') {
      loadPlayMembers(currentPage, pageSize);
    } else {
      loadNoPlayMembers(currentPage, pageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, activeTab]);

  // Clear selection when page changes
  useEffect(() => {
    setSelectedMembers(new Set());
  }, [currentPage]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Member Information
          </h1>
          
          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => {
                  setActiveTab('quarterly');
                  setCurrentPage(1);
                  setSelectedMembers(new Set());
                }}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'quarterly'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Quarterly Statement
              </button>
              <button
                onClick={() => {
                  setActiveTab('play');
                  setCurrentPage(1);
                  setSelectedMembers(new Set());
                }}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'play'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Play Pre-Commitment
              </button>
              <button
                onClick={() => {
                  setActiveTab('no-play');
                  setCurrentPage(1);
                  setSelectedMembers(new Set());
                }}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'no-play'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                No-Play Pre-Commitment
              </button>
            </nav>
          </div>
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
                    `Showing ${activeTab === 'quarterly' ? members.length : activeTab === 'play' ? playMembers.length : noPlayMembers.length} of ${totalMembers.toLocaleString()} members (Page ${currentPage} of ${totalPages})`
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                {selectedMembers.size > 0 && activeTab === 'quarterly' && (
                  <button
                    onClick={handleDeleteSelected}
                    disabled={deleting || loadingMembers}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:bg-gray-400"
                  >
                    {deleting ? 'Deleting...' : `Delete Selected (${selectedMembers.size})`}
                  </button>
                )}
                <button
                  onClick={exportToCSV}
                  disabled={loadingMembers || (activeTab === 'quarterly' ? members.length === 0 : activeTab === 'play' ? playMembers.length === 0 : noPlayMembers.length === 0)}
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
                  onClick={() => {
                    if (activeTab === 'quarterly') {
                      loadMembers(currentPage, pageSize);
                    } else if (activeTab === 'play') {
                      loadPlayMembers(currentPage, pageSize);
                    } else {
                      loadNoPlayMembers(currentPage, pageSize);
                    }
                  }}
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
            ) : (activeTab === 'quarterly' ? members.length === 0 : activeTab === 'play' ? playMembers.length === 0 : noPlayMembers.length === 0) ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg mb-2">No members found for {activeTab === 'quarterly' ? 'Quarterly Statement' : activeTab === 'play' ? 'Play Pre-Commitment' : 'No-Play Pre-Commitment'}</p>
                <p className="text-sm">
                  {activeTab === 'quarterly' 
                    ? 'Members are automatically added when Activity Statement Templates are uploaded on the Quarterly Statement page.'
                    : 'Members with pre-commitment statements will appear here after batches are generated.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border border-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left border border-gray-200 font-semibold text-xs w-12">
                        <input
                          type="checkbox"
                          checked={(activeTab === 'quarterly' ? members.length : activeTab === 'play' ? playMembers.length : noPlayMembers.length) > 0 && selectedMembers.size === (activeTab === 'quarterly' ? members.length : activeTab === 'play' ? playMembers.length : noPlayMembers.length)}
                          ref={(input) => {
                            if (input) {
                              const total = activeTab === 'quarterly' ? members.length : activeTab === 'play' ? playMembers.length : noPlayMembers.length;
                              input.indeterminate = 
                                selectedMembers.size > 0 && 
                                selectedMembers.size < total;
                            }
                          }}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </th>
                      <th className="px-3 py-2 text-left border border-gray-200 font-semibold text-xs">Account</th>
                      <th className="px-3 py-2 text-left border border-gray-200 font-semibold text-xs">Name</th>
                      <th className="px-3 py-2 text-left border border-gray-200 font-semibold text-xs">Email</th>
                      <th className="px-3 py-2 text-left border border-gray-200 font-semibold text-xs">Address</th>
                      <th className="px-3 py-2 text-left border border-gray-200 font-semibold text-xs">Suburb</th>
                      {activeTab === 'quarterly' && (
                        <>
                          <th className="px-3 py-2 text-left border border-gray-200 font-semibold text-xs">State</th>
                          <th className="px-3 py-2 text-left border border-gray-200 font-semibold text-xs">Post Code</th>
                          <th className="px-3 py-2 text-left border border-gray-200 font-semibold text-xs">Is Email</th>
                          <th className="px-3 py-2 text-left border border-gray-200 font-semibold text-xs">Is Postal</th>
                        </>
                      )}
                      <th className="px-3 py-2 text-left border border-gray-200 font-semibold text-xs">PDF Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTab === 'quarterly' ? (
                      members.map((member) => {
                        const previewUrl = member.latest_batch_id
                          ? `/content/files/${member.account_number}/${member.latest_batch_id}/`
                          : null;
                      
                        return (
                          <tr key={member.id} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">
                              <input
                                type="checkbox"
                                checked={selectedMembers.has(member.id)}
                                onChange={() => handleSelectMember(member.id)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.account_number}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">
                              {[member.title, member.first_name, member.last_name].filter(Boolean).join(' ')}
                            </td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.email || '-'}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.address || '-'}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.suburb || '-'}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.state || '-'}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.post_code || '-'}</td>
                            <td className="px-3 py-1.5 border border-gray-200">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                member.is_email 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-gray-100 text-gray-800'
                              }`}>
                                {member.is_email ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 border border-gray-200">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                member.is_postal 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-gray-100 text-gray-800'
                              }`}>
                                {member.is_postal ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 border border-gray-200">
                              {previewUrl ? (
                                <a
                                  href={previewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:text-blue-800 text-xs underline"
                                >
                                  Preview
                                </a>
                              ) : (
                                <span className="text-gray-400 text-xs">No PDF available</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    ) : activeTab === 'play' ? (
                      playMembers.map((member) => {
                        const previewUrl = member.latest_play_batch_id
                          ? `/content/play/${member.account_number}/${member.latest_play_batch_id}/`
                          : null;
                        const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || 'Name unavailable';
                        const address = [member.address1, member.address2].filter(Boolean).join(', ').trim() || '-';
                      
                        return (
                          <tr key={member.account_number} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">
                              <input
                                type="checkbox"
                                checked={selectedMembers.has(member.account_number)}
                                onChange={() => handleSelectMember(member.account_number)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.account_number}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{fullName}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.email || '-'}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{address}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.suburb || '-'}</td>
                            <td className="px-3 py-1.5 border border-gray-200">
                              {previewUrl ? (
                                <a
                                  href={previewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:text-blue-800 text-xs underline"
                                >
                                  Preview
                                </a>
                              ) : (
                                <span className="text-gray-400 text-xs">No PDF available</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      noPlayMembers.map((member) => {
                        const previewUrl = member.latest_no_play_batch_id
                          ? `/content/no-play/${member.account_number}/${member.latest_no_play_batch_id}/`
                          : null;
                        const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || 'Name unavailable';
                        const address = [member.address1, member.address2].filter(Boolean).join(', ').trim() || '-';
                      
                        return (
                          <tr key={member.account_number} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">
                              <input
                                type="checkbox"
                                checked={selectedMembers.has(member.account_number)}
                                onChange={() => handleSelectMember(member.account_number)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.account_number}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{fullName}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.email || '-'}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{address}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-xs">{member.suburb || '-'}</td>
                            <td className="px-3 py-1.5 border border-gray-200">
                              {previewUrl ? (
                                <a
                                  href={previewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:text-blue-800 text-xs underline"
                                >
                                  Preview
                                </a>
                              ) : (
                                <span className="text-gray-400 text-xs">No PDF available</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
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

