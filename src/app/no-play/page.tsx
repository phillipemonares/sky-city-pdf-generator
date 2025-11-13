'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import Navigation from '@/components/Navigation';
import { parseExcelFile, parseExcelFileWithMemberContacts, parseCSVFile, validatePreCommitmentFile } from '@/lib/pc-parser';
import { PreCommitmentPlayer } from '@/types/player-data';

interface UploadedFile {
  file: File;
  players: PreCommitmentPlayer[];
  errors: string[];
}

interface NoPlayBatch {
  id: string;
  statement_period: string;
  statement_date: string;
  generation_date: string;
  total_players: number;
  created_at: string;
  updated_at: string;
}

interface MemberInfo {
  accountNumber: string;
  member: {
    id: string;
    account_number: string;
    title: string;
    first_name: string;
    last_name: string;
    email: string;
    address: string;
    suburb: string;
    state: string;
    post_code: string;
    country: string;
    player_type: string;
  } | null;
}

export default function NoPlayPage() {
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendingAccount, setSendingAccount] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<string>('');
  const [previousBatches, setPreviousBatches] = useState<NoPlayBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState<boolean>(false);
  const [loadingBatch, setLoadingBatch] = useState<string | null>(null);
  const [savingBatch, setSavingBatch] = useState<boolean>(false);
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'generation' | 'history'>('generation');
  const [loadedBatchId, setLoadedBatchId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [memberInfoMap, setMemberInfoMap] = useState<Map<string, MemberInfo['member']>>(new Map());
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // Pagination calculations
  const totalPlayers = uploadedFile?.players.length || 0;
  const totalPages = Math.ceil(totalPlayers / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedPlayers = uploadedFile?.players.slice(startIndex, endIndex) || [];

  // Reset to page 1 when players change
  useEffect(() => {
    setCurrentPage(1);
  }, [uploadedFile?.players]);

  // Format dates for statement period display
  const formatStatementPeriod = (start: string, end: string): string => {
    if (!start || !end) return 'Current Period';
    
    try {
      const startDateObj = new Date(start);
      const endDateObj = new Date(end);
      
      const startMonth = startDateObj.toLocaleDateString('en-US', { month: 'long' });
      const startDay = startDateObj.getDate();
      const startYear = startDateObj.getFullYear();
      
      const endMonth = endDateObj.toLocaleDateString('en-US', { month: 'long' });
      const endDay = endDateObj.getDate();
      const endYear = endDateObj.getFullYear();
      
      return `${startDay} ${startMonth} ${startYear} - ${endDay} ${endMonth} ${endYear}`;
    } catch (error) {
      return 'Current Period';
    }
  };

  // Update players' statementPeriod when dates change
  const updatePlayersStatementPeriod = (players: PreCommitmentPlayer[], start: string, end: string): PreCommitmentPlayer[] => {
    const formattedPeriod = formatStatementPeriod(start, end);
    const statementDate = end ? new Date(end).toLocaleDateString() : new Date().toLocaleDateString();
    
    return players.map(player => ({
      ...player,
      statementPeriod: formattedPeriod,
      statementDate: statementDate
    }));
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    // Clear loaded batch ID when new files are uploaded
    setLoadedBatchId(null);
    
    const file = acceptedFiles[0];
    
    if (!file) {
      alert('Please upload a file');
      return;
    }

    const validation = validatePreCommitmentFile(file);
    if (!validation.isValid) {
      alert(`File validation failed: ${validation.errors.join(', ')}`);
      return;
    }

    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    
    if (fileExtension === '.xlsx') {
      // For Excel files, use the new parser that extracts Member Contact data
      parseExcelFileWithMemberContacts(file)
        .then(async result => {
          const { players, memberContacts } = result;
          
          // Update statement period if dates are set
          const updatedPlayers = (startDate && endDate) 
            ? updatePlayersStatementPeriod(players, startDate, endDate)
            : players;
          
          setUploadedFile({
            file,
            players: updatedPlayers,
            errors: []
          });
          
          // Save member contacts to database if available
          if (memberContacts && memberContacts.length > 0) {
            try {
              setGenerationStatus(`Successfully parsed ${updatedPlayers.length} players. Saving member information...`);
              
              const response = await fetch('/api/save-member-contacts', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  memberContacts,
                }),
              });

              if (response.ok) {
                const data = await response.json();
                if (data.success) {
                  setGenerationStatus(
                    `Successfully parsed ${updatedPlayers.length} players with "No Play" status. ` +
                    `Saved ${data.savedCount} new members and updated ${data.updatedCount} existing members from Member Contact sheet.`
                  );
                } else {
                  console.error('Error saving member contacts:', data.error);
                  setGenerationStatus(
                    `Successfully parsed ${updatedPlayers.length} players with "No Play" status. ` +
                    `Warning: Failed to save member information.`
                  );
                }
              } else {
                console.error('Failed to save member contacts:', response.statusText);
                setGenerationStatus(
                  `Successfully parsed ${updatedPlayers.length} players with "No Play" status. ` +
                  `Warning: Failed to save member information.`
                );
              }
            } catch (error) {
              console.error('Error saving member contacts:', error);
              setGenerationStatus(
                `Successfully parsed ${updatedPlayers.length} players with "No Play" status. ` +
                `Warning: Failed to save member information.`
              );
            }
          } else {
            setGenerationStatus(`Successfully parsed ${updatedPlayers.length} players with "No Play" status`);
          }
        })
        .catch(error => {
          console.error('Error parsing file:', error);
          setUploadedFile({
            file,
            players: [],
            errors: [`Error parsing file: ${error.message}`]
          });
          setGenerationStatus('Error parsing file');
        });
    } else {
      // For CSV files, use the regular parser (no Member Contact sheet)
      parseCSVFile(file)
        .then(players => {
          // Update statement period if dates are set
          const updatedPlayers = (startDate && endDate) 
            ? updatePlayersStatementPeriod(players, startDate, endDate)
            : players;
          
          setUploadedFile({
            file,
            players: updatedPlayers,
            errors: []
          });
          setGenerationStatus(`Successfully parsed ${updatedPlayers.length} players with "No Play" status`);
        })
        .catch(error => {
          console.error('Error parsing file:', error);
          setUploadedFile({
            file,
            players: [],
            errors: [`Error parsing file: ${error.message}`]
          });
          setGenerationStatus('Error parsing file');
        });
    }
  }, [startDate, endDate]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv']
    },
    multiple: false
  });

  // Update players when dates change
  useEffect(() => {
    if (uploadedFile && uploadedFile.players.length > 0 && startDate && endDate) {
      const updatedPlayers = updatePlayersStatementPeriod(uploadedFile.players, startDate, endDate);
      setUploadedFile({
        ...uploadedFile,
        players: updatedPlayers
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  // Fetch member info when players are loaded
  useEffect(() => {
    const fetchMemberInfo = async () => {
      if (!uploadedFile || uploadedFile.players.length === 0) {
        return;
      }

      try {
        const accountNumbers = uploadedFile.players.map(p => p.playerInfo.playerAccount);
        const response = await fetch('/api/get-members-by-accounts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ accountNumbers }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.members) {
            const newMap = new Map<string, MemberInfo['member']>();
            data.members.forEach((item: MemberInfo) => {
              if (item.member) {
                newMap.set(item.accountNumber, item.member);
              }
            });
            setMemberInfoMap(newMap);
          }
        }
      } catch (error) {
        console.error('Error fetching member info:', error);
      }
    };

    fetchMemberInfo();
  }, [uploadedFile]);

  // Load previous batches on component mount
  useEffect(() => {
    loadPreviousBatches();
  }, []);

  const loadPreviousBatches = async () => {
    try {
      setLoadingBatches(true);
      const response = await fetch('/api/list-no-play-batches');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setPreviousBatches(data.batches);
        }
      }
    } catch (error) {
      console.error('Error loading batches:', error);
    } finally {
      setLoadingBatches(false);
    }
  };

  const loadBatch = async (batchId: string) => {
    try {
      setLoadingBatch(batchId);
      setGenerationStatus(`Loading batch ${batchId}...`);
      
      const response = await fetch(`/api/load-no-play-batch?batchId=${batchId}`);
      if (!response.ok) {
        throw new Error('Failed to load batch');
      }

      const data = await response.json();
      if (data.success) {
        setLoadedBatchId(batchId);
        
        if (data.players && data.players.length > 0) {
          // Extract dates from statement period if possible
          const statementPeriod = data.batch.statement_period || '';
          // Try to parse dates from statement period (e.g., "June 30, 2025 - September 2025")
          const dateMatch = statementPeriod.match(/(\w+)\s+(\d+),\s+(\d+)\s+-\s+(\w+)\s+(\d+)/);
          if (dateMatch) {
            // Set dates if we can parse them
            // Note: This is a simple extraction, might need refinement
            const [, startMonth, startDay, startYear, endMonth, endYear] = dateMatch;
            // Create date strings (approximate - using first day of end month)
            const startDateStr = `${startYear}-${String(new Date(`${startMonth} 1, ${startYear}`).getMonth() + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
            const endDateStr = `${endYear}-${String(new Date(`${endMonth} 1, ${endYear}`).getMonth() + 1).padStart(2, '0')}-01`;
            setStartDate(startDateStr);
            setEndDate(endDateStr);
          }
          
          setUploadedFile({
            file: new File([], 'loaded-from-database'),
            players: data.players,
            errors: [],
          });
        }

        setGenerationStatus(`Loaded batch: ${data.batch.statement_period} with ${data.batch.total_players} players`);
      }
    } catch (error) {
      console.error('Error loading batch:', error);
      setGenerationStatus('Error loading batch');
    } finally {
      setLoadingBatch(null);
    }
  };

  const saveBatch = async () => {
    if (!uploadedFile || uploadedFile.players.length === 0) {
      alert('No players to save');
      return;
    }

    if (loadedBatchId) {
      alert('This batch is already saved. Loading a batch from history prevents duplicate saves. Upload new files to create a new batch.');
      return;
    }

    try {
      setSavingBatch(true);
      setGenerationStatus('Saving batch to database...');

      const response = await fetch('/api/save-no-play-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          players: uploadedFile.players,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save batch');
      }

      const data = await response.json();
      if (data.success) {
        setLoadedBatchId(data.batchId);
        setGenerationStatus(
          `Batch saved successfully! ${data.statementPeriod} with ${data.totalPlayers} players`
        );
        loadPreviousBatches();
      }
    } catch (error) {
      console.error('Error saving batch:', error);
      setGenerationStatus('Error saving batch to database');
    } finally {
      setSavingBatch(false);
    }
  };

  const deleteBatch = async (batchId: string) => {
    if (!confirm('Are you sure you want to delete this batch? This action cannot be undone.')) {
      return;
    }

    try {
      setDeletingBatch(batchId);
      setGenerationStatus('Deleting batch...');

      const response = await fetch(`/api/delete-no-play-batch?batchId=${batchId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete batch');
      }

      const data = await response.json();
      if (data.success) {
        setGenerationStatus('Batch deleted successfully');
        loadPreviousBatches();
      }
    } catch (error) {
      console.error('Error deleting batch:', error);
      setGenerationStatus('Error deleting batch');
    } finally {
      setDeletingBatch(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const previewPDF = async (player: PreCommitmentPlayer) => {
    setIsPreviewing(true);
    setGenerationStatus('Generating preview...');

    try {
      const response = await fetch('/api/preview-pc-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          players: [player]
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate preview');
      }

      const html = await response.text();
      
      // Open preview in new window
      const previewWindow = window.open('', '_blank');
      if (previewWindow) {
        // Use document.open() to clear any existing content
        // This ensures it works even when navigating back in history
        previewWindow.document.open();
        previewWindow.document.write(html);
        previewWindow.document.close();
      }

      setGenerationStatus('Preview generated successfully!');
    } catch (error) {
      console.error('Error generating preview:', error);
      setGenerationStatus('Error generating preview');
    } finally {
      setIsPreviewing(false);
    }
  };

  const generatePDF = async (player: PreCommitmentPlayer) => {
    setIsGenerating(true);
    setGenerationStatus('Generating PDF...');

    try {
      const response = await fetch('/api/generate-pc-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          players: [player]
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `skycity-precommitment-${player.playerInfo.playerAccount}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setGenerationStatus('PDF generated successfully!');
    } catch (error) {
      console.error('Error generating PDF:', error);
      setGenerationStatus('Error generating PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  const sendEmail = async (player: PreCommitmentPlayer) => {
    const member = memberInfoMap.get(player.playerInfo.playerAccount);
    
    if (!member || !member.email) {
      alert('No email address found for this account. Cannot send PDF.');
      return;
    }

    setIsSending(true);
    setSendingAccount(player.playerInfo.playerAccount);
    setGenerationStatus(`Sending PDF to ${member.email}...`);

    try {
      const response = await fetch('/api/send-pc-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          players: [player]
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to send PDF' }));
        throw new Error(errorData.error || 'Failed to send PDF');
      }

      const data = await response.json();
      if (data.success) {
        setGenerationStatus(`PDF sent successfully to ${member.email}!`);
      } else {
        throw new Error(data.error || 'Failed to send PDF');
      }
    } catch (error) {
      console.error('Error sending PDF:', error);
      setGenerationStatus(`Error sending PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSending(false);
      setSendingAccount(null);
    }
  };

  const generateAllPDFs = async () => {
    if (!uploadedFile || uploadedFile.players.length === 0) {
      alert('No players to generate PDFs for');
      return;
    }

    setIsGenerating(true);
    setGenerationStatus('Generating PDFs for all players...');

    try {
      // Generate PDFs one by one
      for (let i = 0; i < uploadedFile.players.length; i++) {
        const player = uploadedFile.players[i];
        setGenerationStatus(`Generating PDF ${i + 1} of ${uploadedFile.players.length}...`);
        
        const response = await fetch('/api/generate-pc-pdf', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            players: [player]
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to generate PDF for player ${player.playerInfo.playerAccount}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `skycity-precommitment-${player.playerInfo.playerAccount}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        // Small delay between downloads
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setGenerationStatus('All PDFs generated successfully!');
      
      // Save batch to database after generating all PDFs
      if (!loadedBatchId && uploadedFile && uploadedFile.players.length > 0) {
        try {
          const response = await fetch('/api/save-no-play-batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              players: uploadedFile.players,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              setLoadedBatchId(data.batchId);
              loadPreviousBatches();
            }
          }
        } catch (error) {
          console.error('Error auto-saving batch:', error);
        }
      }
    } catch (error) {
      console.error('Error generating PDFs:', error);
      setGenerationStatus('Error generating PDFs');
    } finally {
      setIsGenerating(false);
    }
  };

  const removeFile = () => {
    setUploadedFile(null);
    setGenerationStatus('');
    setStartDate('');
    setEndDate('');
  };

  const downloadTemplate = async () => {
    try {
      const response = await fetch('/api/download-template');
      
      if (!response.ok) {
        throw new Error('Failed to download template');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'PreCommitment_Template.xlsx';
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
            No Play - Pre-commitment Statement Generator
          </h1>
          
          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('generation')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'generation'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Generation
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'history'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                History
              </button>
            </nav>
          </div>
        </div>

        {/* Generation Status */}
        {generationStatus && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
            <p className="text-sm text-blue-800">{generationStatus}</p>
          </div>
        )}

        {/* Generation Tab */}
        {activeTab === 'generation' && (
          <div>

        {/* Date Input Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Statement Period</h2>
          <p className="text-sm text-gray-600 mb-4">Enter the start and end dates for the statement period. This will be used in the generated PDFs.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-2">
                Start Date
              </label>
              <input
                type="date"
                id="startDate"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-2">
                End Date
              </label>
              <input
                type="date"
                id="endDate"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          {startDate && endDate && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Statement Period:</strong> {formatStatementPeriod(startDate, endDate)}
              </p>
            </div>
          )}
        </div>

        {/* Upload Area */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-semibold">Upload File</h2>
              <p className="text-sm text-gray-600">Upload Excel (.xlsx) or CSV files to generate pre-commitment statements for players with "No Play" status.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={downloadTemplate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                📥 Download Template
              </button>
              {uploadedFile && (
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
                    Supports .xlsx and .csv formats. Only players with "No Play" status will be processed.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

            {/* Players List */}
            {uploadedFile && uploadedFile.players.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-8">
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-xl font-semibold">Players Found</h2>
                  <div className="flex gap-2">
                    {!loadedBatchId && (
                      <button
                        onClick={saveBatch}
                        disabled={savingBatch || isGenerating || isPreviewing}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors text-white ${
                          savingBatch || isGenerating || isPreviewing
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'bg-indigo-600 hover:bg-indigo-700'
                        }`}
                      >
                        {savingBatch ? 'Saving...' : 'Save Batch'}
                      </button>
                    )}
                    {loadedBatchId && (
                      <div className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm">
                        Batch already saved (loaded from history)
                      </div>
                    )}
                    <button
                      onClick={removeFile}
                      className="text-red-600 hover:text-red-800 font-medium"
                    >
                      Remove All
                    </button>
                  </div>
                </div>

                {uploadedFile.errors.length > 0 && (
                  <div className="text-red-600 text-sm mb-4">
                    <p>Errors:</p>
                    <ul className="list-disc list-inside">
                      {uploadedFile.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Players Table */}
                {uploadedFile.players.length > 0 && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-medium">
                    {totalPages > 1 
                      ? `Showing ${startIndex + 1} to ${Math.min(endIndex, totalPlayers)} of ${totalPlayers.toLocaleString()} players (Page ${currentPage} of ${totalPages})`
                      : `Players Found: ${totalPlayers.toLocaleString()}`
                    }
                  </h3>
                  <div className="flex gap-2">
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      disabled={isGenerating || isPreviewing || isSending}
                    >
                      <option value="25">25 per page</option>
                      <option value="50">50 per page</option>
                      <option value="100">100 per page</option>
                    </select>
                    <button
                      onClick={generateAllPDFs}
                      disabled={isGenerating || isPreviewing || isSending}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors text-white ${
                        isGenerating || isPreviewing || isSending
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-purple-600 hover:bg-purple-700'
                      }`}
                    >
                      {isGenerating ? 'Exporting...' : `Export All (${totalPlayers})`}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full border border-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Account</th>
                        <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Name</th>
                        <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Email</th>
                        <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Statement Period</th>
                        <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedPlayers.map((player, index) => {
                        // Use KnownAs and LastName from template (playerInfo)
                        const knownAs = player.playerInfo.firstName || '';
                        const lastName = player.playerInfo.lastName || '';
                        const fullName = [knownAs, lastName].filter(Boolean).join(' ').trim() || 'Name unavailable';
                        const email = player.playerInfo.email || '-';
                        const isSendingThis = sendingAccount === player.playerInfo.playerAccount;
                        
                        return (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-4 py-2 border border-gray-200">{player.playerInfo.playerAccount}</td>
                            <td className="px-4 py-2 border border-gray-200">{fullName}</td>
                            <td className="px-4 py-2 border border-gray-200">{email}</td>
                            <td className="px-4 py-2 border border-gray-200">{player.statementPeriod}</td>
                            <td className="px-4 py-2 border border-gray-200">
                              <div className="flex gap-2">
                                <button
                                  onClick={() => previewPDF(player)}
                                  disabled={isPreviewing || isGenerating || isSending}
                                  className={`px-3 py-1 rounded text-sm font-medium ${
                                    isPreviewing || isGenerating || isSending
                                      ? 'bg-gray-400 cursor-not-allowed'
                                      : 'bg-emerald-600 hover:bg-emerald-700'
                                  } text-white transition-colors`}
                                >
                                  Preview
                                </button>
                                <button
                                  onClick={() => generatePDF(player)}
                                  disabled={isGenerating || isPreviewing || isSending}
                                  className={`px-3 py-1 rounded text-sm font-medium ${
                                    isGenerating || isPreviewing || isSending
                                      ? 'bg-gray-400 cursor-not-allowed'
                                      : 'bg-blue-600 hover:bg-blue-700'
                                  } text-white transition-colors`}
                                >
                                  Export
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
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
                      Showing {startIndex + 1} to {Math.min(endIndex, totalPlayers)} of {totalPlayers.toLocaleString()} players
                    </div>
                  </div>
                )}
                </div>
              )}
            </div>
          )}

          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div>
            <div className="bg-white rounded-lg shadow-md p-6 mb-8">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Previous No-Play Batches</h2>
                  <p className="text-sm text-gray-600">Load a previous batch to regenerate PDFs</p>
                </div>
                <button
                  onClick={loadPreviousBatches}
                  disabled={loadingBatches}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium disabled:bg-gray-400"
                >
                  {loadingBatches ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              {previousBatches.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-lg mb-2">No previous batches found</p>
                  <p className="text-sm">Generate PDFs to create batches that will appear here</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {previousBatches.map(batch => {
                    const isLoading = loadingBatch === batch.id;
                    const isDeleting = deletingBatch === batch.id;
                    return (
                      <div
                        key={batch.id}
                        className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {batch.statement_period} - {batch.total_players} {batch.total_players === 1 ? 'player' : 'players'}
                          </p>
                          <p className="text-xs text-gray-600 mt-1">
                            Generated: {formatDate(batch.generation_date)}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              loadBatch(batch.id);
                              setActiveTab('generation');
                            }}
                            disabled={isLoading || isDeleting || isGenerating || isPreviewing}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors text-white ${
                              isLoading || isDeleting || isGenerating || isPreviewing
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-purple-600 hover:bg-purple-700'
                            }`}
                          >
                            {isLoading ? 'Loading...' : 'Load & Switch to Generation'}
                          </button>
                          <button
                            onClick={() => deleteBatch(batch.id)}
                            disabled={isLoading || isDeleting || isGenerating || isPreviewing}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors text-white ${
                              isDeleting || isGenerating || isPreviewing
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-red-600 hover:bg-red-700'
                            }`}
                          >
                            {isDeleting ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
