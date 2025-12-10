'use client';

import { useState, useCallback, useEffect } from 'react';
import Navigation from '@/components/Navigation';
import EditMemberModal from '@/components/EditMemberModal';
import { MemberWithBatch, NoPlayMemberWithBatch, PlayMemberWithBatch } from '@/lib/db';
import JSZip from 'jszip';

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
  const [editingMember, setEditingMember] = useState<{ account: string; batchId: string } | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);

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

  const exportPDFs = useCallback(async (exportAll: boolean = false) => {
    const currentMembers = activeTab === 'quarterly' ? members : activeTab === 'play' ? playMembers : noPlayMembers;
    
    if (currentMembers.length === 0) {
      alert('No members to export');
      return;
    }

    // Determine which members to export
    let membersToExport: Array<{ account: string; batchId: string; name: string }> = [];
    
    if (exportAll) {
      // For export all, we need to get the total count first
      const totalCount = totalMembers;
      
      // Warn user for very large exports
      if (totalCount > 1000) {
        const confirmed = confirm(
          `You are about to export ${totalCount.toLocaleString()} PDFs. This may take a very long time and could cause your browser to become unresponsive.\n\n` +
          `For exports over 1,000 PDFs, we recommend exporting in smaller batches or contact support for a server-side bulk export solution.\n\n` +
          `Do you want to continue?`
        );
        if (!confirmed) return;
      }

      // Export all members with PDFs - but we only have the current page loaded
      // For true "export all", we'd need to fetch from server in batches
      // For now, we'll export what's available and warn the user
      if (totalCount > currentMembers.length) {
        alert(
          `Note: You have ${totalCount.toLocaleString()} total members, but only ${currentMembers.length} are loaded on this page.\n\n` +
          `This export will only include the currently loaded members. For a full export of all ${totalCount.toLocaleString()} members, ` +
          `please use the server-side export feature or export in batches using pagination.`
        );
      }

      if (activeTab === 'quarterly') {
        membersToExport = members
          .filter(m => m.latest_batch_id)
          .map(m => ({
            account: m.account_number,
            batchId: m.latest_batch_id!,
            name: [m.title, m.first_name, m.last_name].filter(Boolean).join(' ') || m.account_number
          }));
      } else if (activeTab === 'play') {
        membersToExport = playMembers
          .filter(m => m.latest_play_batch_id)
          .map(m => ({
            account: m.account_number,
            batchId: m.latest_play_batch_id!,
            name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.account_number
          }));
      } else {
        membersToExport = noPlayMembers
          .filter(m => m.latest_no_play_batch_id)
          .map(m => ({
            account: m.account_number,
            batchId: m.latest_no_play_batch_id!,
            name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.account_number
          }));
      }
    } else {
      // Export selected members, or all if none selected
      if (selectedMembers.size > 0) {
        // Export selected members
        if (activeTab === 'quarterly') {
          membersToExport = members
            .filter(m => selectedMembers.has(m.id) && m.latest_batch_id)
            .map(m => ({
              account: m.account_number,
              batchId: m.latest_batch_id!,
              name: [m.title, m.first_name, m.last_name].filter(Boolean).join(' ') || m.account_number
            }));
        } else if (activeTab === 'play') {
          membersToExport = playMembers
            .filter(m => selectedMembers.has(m.account_number) && m.latest_play_batch_id)
            .map(m => ({
              account: m.account_number,
              batchId: m.latest_play_batch_id!,
              name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.account_number
            }));
        } else {
          membersToExport = noPlayMembers
            .filter(m => selectedMembers.has(m.account_number) && m.latest_no_play_batch_id)
            .map(m => ({
              account: m.account_number,
              batchId: m.latest_no_play_batch_id!,
              name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.account_number
            }));
        }
      } else {
        // No members selected - export all on current page
        if (activeTab === 'quarterly') {
          membersToExport = members
            .filter(m => m.latest_batch_id)
            .map(m => ({
              account: m.account_number,
              batchId: m.latest_batch_id!,
              name: [m.title, m.first_name, m.last_name].filter(Boolean).join(' ') || m.account_number
            }));
        } else if (activeTab === 'play') {
          membersToExport = playMembers
            .filter(m => m.latest_play_batch_id)
            .map(m => ({
              account: m.account_number,
              batchId: m.latest_play_batch_id!,
              name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.account_number
            }));
        } else {
          membersToExport = noPlayMembers
            .filter(m => m.latest_no_play_batch_id)
            .map(m => ({
              account: m.account_number,
              batchId: m.latest_no_play_batch_id!,
              name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.account_number
            }));
        }
      }
    }

    if (membersToExport.length === 0) {
      alert('No members with PDFs available to export');
      return;
    }

    // Warn for large exports
    if (membersToExport.length > 500) {
      const confirmed = confirm(
        `You are about to export ${membersToExport.length} PDFs. This may take several minutes and could cause your browser to become unresponsive.\n\n` +
        `Do you want to continue?`
      );
      if (!confirmed) return;
    }

    try {
      setExporting(true);
      setExportProgress({ current: 0, total: membersToExport.length });
      const zip = new JSZip();

      // Determine the API endpoint based on tab
      const getPdfUrl = (account: string, batchId: string) => {
        if (activeTab === 'quarterly') {
          return `/api/member-pdf?account=${encodeURIComponent(account)}&batch=${encodeURIComponent(batchId)}`;
        } else if (activeTab === 'play') {
          return `/api/play-member-pdf?account=${encodeURIComponent(account)}&batch=${encodeURIComponent(batchId)}`;
        } else {
          return `/api/no-play-member-pdf?account=${encodeURIComponent(account)}&batch=${encodeURIComponent(batchId)}`;
        }
      };

      // Process PDFs in batches to avoid overwhelming the browser
      const BATCH_SIZE = 50; // Process 50 PDFs at a time
      let successCount = 0;
      let failedCount = 0;
      let processedCount = 0;
      const allFailedAccounts: Array<{ account: string; error: string }> = [];

      for (let i = 0; i < membersToExport.length; i += BATCH_SIZE) {
        const batch = membersToExport.slice(i, i + BATCH_SIZE);

        // Fetch batch of PDFs with progress tracking
        const pdfPromises = batch.map(async (member) => {
          try {
            const url = getPdfUrl(member.account, member.batchId);
            const response = await fetch(url);
            
            // Update progress after each fetch
            processedCount++;
            setExportProgress({ current: processedCount, total: membersToExport.length });
            
            if (!response.ok) {
              // Try to get error message from response
              let errorMsg = response.statusText;
              try {
                const errorData = await response.json();
                if (errorData.error) {
                  errorMsg = errorData.error;
                }
              } catch {
                // Ignore JSON parse errors
              }
              
              console.error(`Failed to fetch PDF for ${member.account} (batch: ${member.batchId}): ${errorMsg}`);
              failedCount++;
              const errorResult = { account: member.account, error: errorMsg };
              allFailedAccounts.push(errorResult);
              return errorResult;
            }

            const blob = await response.blob();
            const sanitizedAccount = member.account.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
            const sanitizedName = member.name.replace(/[^a-zA-Z0-9_-]/g, '_') || sanitizedAccount;
            const filename = `${sanitizedAccount}_${sanitizedName}.pdf`;
            
            return { filename, blob };
          } catch (error) {
            // Update progress even on error
            processedCount++;
            setExportProgress({ current: processedCount, total: membersToExport.length });
            
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`Error fetching PDF for ${member.account}:`, errorMsg);
            failedCount++;
            const errorResult = { account: member.account, error: errorMsg };
            allFailedAccounts.push(errorResult);
            return errorResult;
          }
        });

        const pdfResults = await Promise.all(pdfPromises);
        
        // Add successful PDFs to zip
        pdfResults.forEach((result) => {
          if (result && 'filename' in result && 'blob' in result && result.filename && result.blob) {
            zip.file(result.filename, result.blob);
            successCount++;
          }
        });

        // Small delay between batches to prevent overwhelming the browser
        if (i + BATCH_SIZE < membersToExport.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      setExportProgress({ current: membersToExport.length, total: membersToExport.length });

      if (successCount === 0) {
        alert('Failed to export any PDFs. Please try again.');
        return;
      }

      // Generate zip file with progress updates
      setExportProgress({ current: membersToExport.length, total: membersToExport.length + 1 });
      const zipBlob = await zip.generateAsync({ 
        type: 'blob',
        streamFiles: true, // Use streaming for large files
        compression: 'DEFLATE',
        compressionOptions: { level: 6 } // Balance between size and speed
      });
      
      // Download zip file
      const link = document.createElement('a');
      const url = URL.createObjectURL(zipBlob);
      const tabName = activeTab === 'quarterly' ? 'quarterly' : activeTab === 'play' ? 'play' : 'no-play';
      const dateStr = new Date().toISOString().split('T')[0];
      link.setAttribute('href', url);
      link.setAttribute('download', `${tabName}_members_pdfs_${dateStr}.zip`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const message = `Successfully exported ${successCount} PDF${successCount !== 1 ? 's' : ''}`;
      if (failedCount > 0) {
        const failedAccountNumbers = allFailedAccounts
          .map(r => r.account)
          .slice(0, 10); // Show first 10 failed accounts
        
        const failedList = failedAccountNumbers.length > 0 
          ? `\n\nFailed accounts: ${failedAccountNumbers.join(', ')}${failedAccountNumbers.length < failedCount ? '...' : ''}`
          : '';
        
        alert(`${message}\n\nNote: ${failedCount} PDF${failedCount !== 1 ? 's' : ''} failed to export.${failedList}\n\nCheck the console for more details.`);
      } else {
        alert(message);
      }
    } catch (error) {
      console.error('Error exporting PDFs:', error);
      alert('Failed to export PDFs. Please try again.');
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }, [members, playMembers, noPlayMembers, activeTab, totalMembers, selectedMembers]);

  // Calculate export count based on selected members only
  const getExportCount = useCallback(() => {
    if (selectedMembers.size === 0) {
      return 0;
    }
    if (activeTab === 'quarterly') {
      return members.filter(m => selectedMembers.has(m.id) && m.latest_batch_id).length;
    } else if (activeTab === 'play') {
      return playMembers.filter(m => selectedMembers.has(m.account_number) && m.latest_play_batch_id).length;
    } else {
      return noPlayMembers.filter(m => selectedMembers.has(m.account_number) && m.latest_no_play_batch_id).length;
    }
  }, [members, playMembers, noPlayMembers, activeTab, selectedMembers]);

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
              <div className="flex gap-2 items-center">
                {selectedMembers.size > 0 && activeTab === 'quarterly' && (
                  <button
                    onClick={handleDeleteSelected}
                    disabled={deleting || loadingMembers}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:bg-gray-400"
                  >
                    {deleting ? 'Deleting...' : `Delete Selected (${selectedMembers.size})`}
                  </button>
                )}
                {(() => {
                  const exportCount = getExportCount();
                  return (
                    <button
                      onClick={() => exportPDFs(false)}
                      disabled={exporting || loadingMembers || selectedMembers.size === 0 || exportCount === 0}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:bg-gray-400"
                    >
                      {exporting ? (exportProgress ? `Exporting... ${exportProgress.current}/${exportProgress.total}` : 'Exporting...') : `Export (${exportCount}) PDF${exportCount !== 1 ? 's' : ''}`}
                    </button>
                  );
                })()}
                {exportProgress && (
                  <div className="text-sm text-gray-600 flex items-center">
                    <div className="w-32 bg-gray-200 rounded-full h-2 mr-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                        style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
                      ></div>
                    </div>
                    <span>{Math.round((exportProgress.current / exportProgress.total) * 100)}%</span>
                  </div>
                )}
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
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setEditingMember({ account: member.account_number, batchId: member.latest_batch_id! })}
                                    className="text-blue-600 hover:text-blue-800 text-xs underline"
                                  >
                                    Edit
                                  </button>
                                  <span className="text-gray-300">|</span>
                                  <a
                                    href={previewUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 text-xs underline"
                                  >
                                    Preview
                                  </a>
                                </div>
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

      {/* Edit Member Modal */}
      {editingMember && (
        <EditMemberModal
          isOpen={!!editingMember}
          onClose={() => setEditingMember(null)}
          account={editingMember.account}
          batchId={editingMember.batchId}
          onSave={() => {
            // Refresh the current tab's data
            if (activeTab === 'quarterly') {
              loadMembers(currentPage, pageSize);
            } else if (activeTab === 'play') {
              loadPlayMembers(currentPage, pageSize);
            } else {
              loadNoPlayMembers(currentPage, pageSize);
            }
          }}
        />
      )}
    </div>
  );
}

