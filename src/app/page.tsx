'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import Navigation from '@/components/Navigation';
import {
  parseCSVFile as parseMonthlyCSVFile,
  transformCSVToPlayerData,
  aggregateQuarterlyData,
  validateCSVStructure,
} from '@/lib/csv-parser';
import { getQuarterStartDate, getQuarterEndDate } from '@/lib/pdf-shared';
import {
  parseActivityExcel,
  parseActivityCSV,
  validateActivityFile,
} from '@/lib/activity-parser';
import {
  parseExcelFile as parsePreCommitmentExcel,
  parseCSVFile as parsePreCommitmentCSV,
  validatePreCommitmentFile,
} from '@/lib/pc-parser';
import { buildAnnotatedPlayers } from '@/lib/annotated-pdf-template';
import {
  PlayerData,
  QuarterlyData,
  ActivityStatementRow,
  PreCommitmentPlayer,
  AnnotatedStatementPlayer,
} from '@/types/player-data';

interface UploadedFile {
  file: File;
  content: string;
  month: number;
  year: number;
  data: PlayerData[];
  errors: string[];
}

interface ActivityUpload {
  file: File;
  rows: ActivityStatementRow[];
  errors: string[];
}

interface PreCommitmentUpload {
  file: File;
  players: PreCommitmentPlayer[];
  errors: string[];
}

interface GenerationBatch {
  id: string;
  quarter: number;
  year: number;
  generation_date: string;
  total_accounts: number;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export default function UploadInterface() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [activityUpload, setActivityUpload] = useState<ActivityUpload | null>(null);
  const [preCommitmentUpload, setPreCommitmentUpload] = useState<PreCommitmentUpload | null>(null);
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyData | null>(null);
  const [generatingAccount, setGeneratingAccount] = useState<string | null>(null);
  const [previewingAccount, setPreviewingAccount] = useState<string | null>(null);
  const [sendingAccount, setSendingAccount] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<string>('');
  const [previousBatches, setPreviousBatches] = useState<GenerationBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState<boolean>(false);
  const [loadingBatch, setLoadingBatch] = useState<string | null>(null);
  const [savingBatch, setSavingBatch] = useState<boolean>(false);
  const [saveProgress, setSaveProgress] = useState<number>(0);
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'generation' | 'history'>('generation');
  const [loadedBatchId, setLoadedBatchId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [savingStatementPeriod, setSavingStatementPeriod] = useState<boolean>(false);
  const [statementPeriodSaved, setStatementPeriodSaved] = useState<boolean>(false);
  const [batchQuarter, setBatchQuarter] = useState<number | null>(null);
  const [batchYear, setBatchYear] = useState<number | null>(null);
  const [allAnnotatedPlayers, setAllAnnotatedPlayers] = useState<AnnotatedStatementPlayer[]>([]);
  const [loadedBatchPagination, setLoadedBatchPagination] = useState<{
    page: number;
    pageSize: number;
    totalAccounts: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  } | null>(null);
  const [batchSearchQuery, setBatchSearchQuery] = useState<string>('');
  const [searchDebounceTimer, setSearchDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  // Use allAnnotatedPlayers if we have them (from loaded batch), otherwise build from uploads
  const annotatedPlayers = useMemo<AnnotatedStatementPlayer[]>(() => {
    // If we have loaded batch data, use that (server-side paginated)
    if (allAnnotatedPlayers.length > 0 && loadedBatchId) {
      return allAnnotatedPlayers;
    }

    // Otherwise, build from uploaded files (normal flow)
    // Only activity statement is required; preCommitment and cashless are optional
    if (!activityUpload) {
      return [];
    }

    return buildAnnotatedPlayers(
      activityUpload.rows,
      preCommitmentUpload?.players || [],
      quarterlyData || { quarter: 0, year: 0, players: [], monthlyBreakdown: [] }
    );
  }, [allAnnotatedPlayers, loadedBatchId, activityUpload, preCommitmentUpload, quarterlyData]);

  // Pagination calculations
  const totalAccounts = annotatedPlayers.length;
  const totalPages = Math.ceil(totalAccounts / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedPlayers = annotatedPlayers.slice(startIndex, endIndex);

  // Reset to page 1 when annotatedPlayers changes
  useEffect(() => {
    setCurrentPage(1);
  }, [annotatedPlayers]);

  const isGenerating = generatingAccount !== null;
  const isPreviewing = previewingAccount !== null;
  const isSending = sendingAccount !== null;

  // Load previous batches on component mount
  useEffect(() => {
    loadPreviousBatches();
  }, []);

  // Update quarterlyData when statement period dates change
  useEffect(() => {
    if (quarterlyData && startDate && endDate) {
      const formatDateToDDMMYYYY = (dateStr: string): string => {
        const date = new Date(dateStr);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
      };

      setQuarterlyData({
        ...quarterlyData,
        statementPeriod: {
          startDate: formatDateToDDMMYYYY(startDate),
          endDate: formatDateToDDMMYYYY(endDate),
        },
      });
    }
  }, [startDate, endDate]);

  // Auto-fill start and end dates from quarter when quarterlyData is set (only if dates not already set)
  useEffect(() => {
    const quarter = quarterlyData?.quarter;
    const year = quarterlyData?.year;
    
    // Only auto-fill if we have a valid quarter (not 0) and year, and dates aren't already set
    if (quarter && quarter > 0 && year && year > 0 && !startDate && !endDate) {
      // Convert DD/MM/YYYY to YYYY-MM-DD format for date input
      const formatDateToYYYYMMDD = (dateStr: string): string => {
        // Convert DD/MM/YYYY to YYYY-MM-DD
        const [day, month, yearStr] = dateStr.split('/');
        return `${yearStr}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      };
      
      const startDateStr = getQuarterStartDate(quarter, year);
      const endDateStr = getQuarterEndDate(quarter, year);
      
      setStartDate(formatDateToYYYYMMDD(startDateStr));
      setEndDate(formatDateToYYYYMMDD(endDateStr));
      console.log(`Auto-filled statement period dates for Q${quarter} ${year}: ${startDateStr} to ${endDateStr}`);
    }
  }, [quarterlyData?.quarter, quarterlyData?.year, startDate, endDate]);

  // Load saved statement period when quarterlyData or batch is available (only if dates not already set)
  useEffect(() => {
    const loadSavedStatementPeriod = async () => {
      const quarter = quarterlyData?.quarter || batchQuarter;
      const year = quarterlyData?.year || batchYear;
      
      if (quarter && year && !startDate && !endDate) {
        try {
          const response = await fetch(
            `/api/save-statement-period?quarter=${quarter}&year=${year}`
          );
          const data = await response.json();
          
          if (data.success && data.statementPeriod) {
            // Convert DD/MM/YYYY to YYYY-MM-DD format
            const formatDateToYYYYMMDD = (dateStr: string): string => {
              // Convert DD/MM/YYYY to YYYY-MM-DD
              const [day, month, yearStr] = dateStr.split('/');
              return `${yearStr}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            };
            
            setStartDate(formatDateToYYYYMMDD(data.statementPeriod.startDate));
            setEndDate(formatDateToYYYYMMDD(data.statementPeriod.endDate));
            setStatementPeriodSaved(true);
          }
        } catch (error) {
          console.error('Error loading saved statement period:', error);
        }
      }
    };

    loadSavedStatementPeriod();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quarterlyData?.quarter, quarterlyData?.year, batchQuarter, batchYear, startDate, endDate]);

  const saveStatementPeriod = async () => {
    // Get quarter and year from loaded batch first, then quarterlyData
    let quarter = batchQuarter || quarterlyData?.quarter;
    let year = batchYear || quarterlyData?.year;

    // If we have a loaded batch but no quarter/year yet, fetch it from the batch
    if (loadedBatchId && (!quarter || !year)) {
      try {
        const response = await fetch(`/api/load-batch?batchId=${loadedBatchId}&page=1&pageSize=1`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.batch) {
            quarter = data.batch.quarter;
            year = data.batch.year;
            if (quarter !== undefined) setBatchQuarter(quarter);
            if (year !== undefined) setBatchYear(year);
          }
        }
      } catch (error) {
        console.error('Error fetching batch quarter/year:', error);
      }
    }

    // If still no quarter/year, show error
    if (!quarter || !year) {
      if (loadedBatchId) {
        alert('Unable to determine quarter and year from the loaded batch. Please try reloading the batch.');
      } else {
        alert('Please load a batch or upload activity statement first to determine quarter and year');
      }
      return;
    }

    if (!startDate || !endDate) {
      alert('Please enter both start and end dates');
      return;
    }

    setSavingStatementPeriod(true);
    setStatementPeriodSaved(false);

    try {
      const response = await fetch('/api/save-statement-period', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quarter,
          year,
          startDate,
          endDate,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setStatementPeriodSaved(true);
        setTimeout(() => setStatementPeriodSaved(false), 3000); // Hide message after 3 seconds
        
        // Show success message indicating batches were updated
        const message = loadedBatchId 
          ? 'Statement period saved and existing batches updated successfully!'
          : 'Statement period saved successfully!';
        console.log(message);
      } else {
        alert(`Failed to save statement period: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error saving statement period:', error);
      alert('Failed to save statement period. Please try again.');
    } finally {
      setSavingStatementPeriod(false);
    }
  };

  const loadPreviousBatches = async () => {
    try {
      setLoadingBatches(true);
      const response = await fetch('/api/list-batches');
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

  const loadBatch = async (batchId: string, loadPage: number = 1, searchQuery: string = '') => {
    try {
      setLoadingBatch(batchId);
      setGenerationStatus(searchQuery ? `Searching batch ${batchId}...` : `Loading batch ${batchId}...`);
      
      // If loading a different batch (not just searching/paginating the current one), clear the search
      if (loadedBatchId !== batchId && !searchQuery) {
        setBatchSearchQuery('');
      }
      
      const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : '';
      const response = await fetch(`/api/load-batch?batchId=${batchId}&page=${loadPage}&pageSize=${pageSize}${searchParam}`);
      if (!response.ok) {
        throw new Error('Failed to load batch');
      }

      const data = await response.json();
      if (data.success) {
        // Set the loaded batch ID to prevent duplicate saves
        setLoadedBatchId(batchId);
        
        // Store batch quarter and year for statement period saving
        if (data.batch) {
          setBatchQuarter(data.batch.quarter);
          setBatchYear(data.batch.year);
        }
        
        // For paginated loading, we need to handle data differently
        // Store quarterlyData and preCommitmentPlayers once (they're the same for all pages)
        if (data.quarterlyData) {
          setQuarterlyData(data.quarterlyData);

          // Restore statement period dates if they exist
          if (data.quarterlyData.statementPeriod) {
            const formatDateToYYYYMMDD = (dateStr: string): string => {
              // Convert DD/MM/YYYY to YYYY-MM-DD
              const [day, month, year] = dateStr.split('/');
              return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            };

            setStartDate(formatDateToYYYYMMDD(data.quarterlyData.statementPeriod.startDate));
            setEndDate(formatDateToYYYYMMDD(data.quarterlyData.statementPeriod.endDate));
          }
        }

        if (data.preCommitmentPlayers && data.preCommitmentPlayers.length > 0) {
          setPreCommitmentUpload({
            file: new File([], 'loaded-from-database'),
            players: data.preCommitmentPlayers,
            errors: [],
          });
        }

        // For server-side pagination, we use the annotatedPlayers directly from the API
        // instead of rebuilding them from activityRows
        // When searching or on first page, replace all data
        if (loadPage === 1 || searchQuery) {
          // First page or search - replace all data
          setAllAnnotatedPlayers(data.annotatedPlayers || []);
          if (data.activityRows && data.activityRows.length > 0) {
            setActivityUpload({
              file: new File([], 'loaded-from-database'),
              rows: data.activityRows,
              errors: [],
            });
          }
        } else {
          // Subsequent pages (non-search) - append to existing data
          setAllAnnotatedPlayers(prev => [...prev, ...(data.annotatedPlayers || [])]);
          if (data.activityRows && data.activityRows.length > 0) {
            setActivityUpload(prev => prev ? {
              ...prev,
              rows: [...prev.rows, ...data.activityRows],
            } : {
              file: new File([], 'loaded-from-database'),
              rows: data.activityRows,
              errors: [],
            });
          }
        }

        // Store pagination info - update page number for subsequent loads
        if (data.pagination) {
          setLoadedBatchPagination(prev => {
            if (prev && loadPage > 1) {
              // Update the page number for subsequent loads
              return {
                ...data.pagination,
                page: loadPage,
              };
            }
            return data.pagination;
          });
        }

        const statusMsg = searchQuery 
          ? `Found ${data.pagination?.totalAccounts || 0} accounts matching "${searchQuery}" in Q${data.batch.quarter} ${data.batch.year}`
          : `Loaded batch: Q${data.batch.quarter} ${data.batch.year} with ${data.batch.total_accounts} accounts (page ${loadPage}/${data.pagination?.totalPages || 1})`;
        setGenerationStatus(statusMsg);
      }
    } catch (error) {
      console.error('Error loading batch:', error);
      setGenerationStatus('Error loading batch');
    } finally {
      setLoadingBatch(null);
    }
  };

  // Load more pages when needed
  const loadBatchPage = async (batchId: string, page: number) => {
    await loadBatch(batchId, page, batchSearchQuery);
  };

  // Handle search input with debounce
  const handleBatchSearch = (query: string) => {
    setBatchSearchQuery(query);
    
    // Clear existing timer
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    
    // Only search if we have a loaded batch
    if (loadedBatchId) {
      const timer = setTimeout(() => {
        // Reset to page 1 when searching
        setCurrentPage(1);
        loadBatch(loadedBatchId, 1, query);
      }, 300); // 300ms debounce
      
      setSearchDebounceTimer(timer);
    }
  };

  // Clear search and reload all data
  const clearBatchSearch = () => {
    setBatchSearchQuery('');
    if (loadedBatchId) {
      setCurrentPage(1);
      loadBatch(loadedBatchId, 1, '');
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

  const saveBatch = async () => {
    // Prevent saving if a batch is already loaded (to avoid duplicates)
    if (loadedBatchId) {
      alert('This batch is already saved. Loading a batch from history prevents duplicate saves. Upload new files to create a new batch.');
      return;
    }

    if (!activityUpload || activityUpload.rows.length === 0) {
      alert('Upload an activity statement before saving');
      return;
    }

    // Pre-commitment and cashless are optional - proceed without confirmation

    if (annotatedPlayers.length === 0) {
      alert('No matched accounts to save');
      return;
    }

    try {
      setSavingBatch(true);
      setSaveProgress(0);
      setGenerationStatus('Initializing batch...');

      // Send data in chunks to avoid memory issues
      const chunkSize = 1000;
      const totalRows = activityUpload.rows.length;
      let batchId: string | null = null;

      // First, create the batch and get batchId
      // Send quarterlyData and preCommitmentPlayers once during init to avoid sending with every chunk
      
      // Use defaults if quarterlyData is missing - ensure quarter and year are always set
      const finalQuarterlyData = quarterlyData || { quarter: 0, year: new Date().getFullYear(), players: [], monthlyBreakdown: [] };
      
      // Ensure quarter and year are set even if quarterlyData exists but has undefined values
      if (!finalQuarterlyData.quarter && finalQuarterlyData.quarter !== 0) {
        finalQuarterlyData.quarter = 0;
      }
      if (!finalQuarterlyData.year && finalQuarterlyData.year !== 0) {
        finalQuarterlyData.year = new Date().getFullYear();
      }

      const initResponse = await fetch('/api/save-batch-init', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quarter: finalQuarterlyData.quarter || 0,
          year: finalQuarterlyData.year || new Date().getFullYear(),
          totalAccounts: annotatedPlayers.length,
          quarterlyData: finalQuarterlyData,
          preCommitmentPlayers: preCommitmentUpload?.players || [],
          startDate: startDate || null,
          endDate: endDate || null,
        }),
      });

      if (!initResponse.ok) {
        const errorData = await initResponse.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.details 
          ? `${errorData.error}${errorData.details ? `: ${JSON.stringify(errorData.details)}` : ''}`
          : 'Failed to initialize batch';
        console.error('Batch init error:', errorData);
        console.error('Request payload:', {
          quarter: finalQuarterlyData.quarter || 0,
          year: finalQuarterlyData.year || new Date().getFullYear(),
          totalAccounts: annotatedPlayers.length,
          hasQuarterlyData: !!finalQuarterlyData,
        });
        throw new Error(errorMessage);
      }

      const initData = await initResponse.json();
      if (!initData.success) {
        const errorMessage = initData.error || initData.details 
          ? `${initData.error}${initData.details ? `: ${JSON.stringify(initData.details)}` : ''}`
          : 'Failed to initialize batch';
        throw new Error(errorMessage);
      }
      batchId = initData.batchId;
      setSaveProgress(5);
      setGenerationStatus('Saving data to database...');

      // Calculate total chunks
      const totalChunks = Math.ceil(totalRows / chunkSize);

      // Send data in chunks
      for (let i = 0; i < totalRows; i += chunkSize) {
        const chunk = activityUpload.rows.slice(i, i + chunkSize);
        const currentChunk = Math.floor(i / chunkSize) + 1;
        const progress = Math.min(i + chunkSize, totalRows);
        
        // Update progress (5% for init, 90% for chunks, 5% for finalize)
        const chunkProgress = 5 + Math.floor((currentChunk / totalChunks) * 90);
        setSaveProgress(chunkProgress);
        setGenerationStatus(`Saving batch to database... ${progress}/${totalRows} rows (${currentChunk}/${totalChunks} chunks)`);

        const chunkResponse = await fetch('/api/save-batch-chunk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            batchId,
            activityRows: chunk,
            preCommitmentPlayers: preCommitmentUpload?.players || [],
            quarterlyData: quarterlyData || { quarter: 0, year: 0, players: [], monthlyBreakdown: [] },
            chunkIndex: Math.floor(i / chunkSize),
            isLastChunk: i + chunkSize >= totalRows,
          }),
        });

        if (!chunkResponse.ok) {
          throw new Error(`Failed to save chunk ${currentChunk}`);
        }

        const chunkData = await chunkResponse.json();
        if (!chunkData.success) {
          throw new Error(chunkData.error || `Failed to save chunk ${currentChunk}`);
        }
      }

      setSaveProgress(95);
      setGenerationStatus('Finalizing batch...');

      // Finalize the batch
      const finalizeResponse = await fetch('/api/save-batch-finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          batchId,
          startDate: startDate || null,
          endDate: endDate || null,
        }),
      });

      if (!finalizeResponse.ok) {
        throw new Error('Failed to finalize batch');
      }

      const finalizeData = await finalizeResponse.json();
      if (finalizeData.success) {
        setSaveProgress(100);
        setLoadedBatchId(batchId!);
        setGenerationStatus(
          `Batch saved successfully! Q${finalQuarterlyData.quarter} ${finalQuarterlyData.year} with ${annotatedPlayers.length} accounts`
        );
        loadPreviousBatches();
        
        // Reset progress after a short delay
        setTimeout(() => setSaveProgress(0), 2000);
      }
    } catch (error) {
      console.error('Error saving batch:', error);
      setGenerationStatus('Error saving batch to database');
      setSaveProgress(0);
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

      const response = await fetch(`/api/delete-batch?batchId=${batchId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete batch');
      }

      const data = await response.json();
      if (data.success) {
        setGenerationStatus('Batch deleted successfully');
        // Reload batches list to remove the deleted batch
        loadPreviousBatches();
      }
    } catch (error) {
      console.error('Error deleting batch:', error);
      setGenerationStatus('Error deleting batch');
    } finally {
      setDeletingBatch(null);
    }
  };

  const onMonthlyDrop = useCallback((acceptedFiles: File[]) => {
    // Clear loaded batch ID when new files are uploaded
    setLoadedBatchId(null);
    setBatchQuarter(null);
    setBatchYear(null);
    
    const csvFiles = acceptedFiles.filter(file => 
      file.type === 'text/csv' || file.name.endsWith('.csv')
    );

    if (csvFiles.length === 0) {
      alert('Please upload CSV files only');
      return;
    }

    csvFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        
        try {
          const csvRows = parseMonthlyCSVFile(content);
          const validation = validateCSVStructure(csvRows);
          
          if (!validation.isValid) {
            setUploadedFiles(prev => [...prev, {
              file,
              content,
              month: 0,
              year: 0,
              data: [],
              errors: validation.errors
            }]);
            return;
          }

          const playerData = transformCSVToPlayerData(csvRows, file.name);
          const month = playerData[0]?.monthlyTotals.statementMonth || 0;
          const year = playerData[0]?.monthlyTotals.statementYear || 0;

          setUploadedFiles(prev => {
            const newFiles = [...prev, {
              file,
              content,
              month,
              year,
              data: playerData,
              errors: []
            }];

            // Aggregate quarterly data
            const monthlyData = newFiles.map(f => ({
              month: f.month,
              year: f.year,
              data: f.data
            }));

            if (monthlyData.length > 0) {
              try {
                const quarterly = aggregateQuarterlyData(monthlyData);
                setQuarterlyData(quarterly);
              } catch (error) {
                console.error('Error aggregating quarterly data:', error);
              }
            }

            return newFiles;
          });
        } catch (error) {
          console.error('Error processing file:', error);
          setUploadedFiles(prev => [...prev, {
            file,
            content,
            month: 0,
            year: 0,
            data: [],
            errors: [`Error processing file: ${error}`]
          }]);
        }
      };
      reader.readAsText(file);
    });
  }, []);

  // Helper function to determine quarter and year from month names
  const determineQuarterFromMonthNames = (month1Name: string, month2Name: string, month3Name: string): { quarter: number; year: number } | null => {
    const getMonthNumber = (monthName: string): number | null => {
      if (!monthName) return null;
      
      const normalized = monthName.trim().toLowerCase();
      
      // Handle formats like "25-Apr", "Apr-25", "25-April", "April-25", etc.
      // Split by common delimiters and find the month part
      const parts = normalized.split(/[-_\/\s]+/);
      
      const monthNames = [
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december'
      ];
      
      const monthAbbreviations = [
        'jan', 'feb', 'mar', 'apr', 'may', 'jun',
        'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
      ];
      
      // Try each part to find the month
      for (const part of parts) {
        // Skip if it's clearly a number (day or year)
        if (/^\d+$/.test(part)) {
          continue;
        }
        
        // Try full month name match
        let index = monthNames.findIndex(name => name === part || name.startsWith(part) || part.startsWith(name));
        
        // If no match, try abbreviation
        if (index < 0) {
          index = monthAbbreviations.findIndex(abbr => abbr === part || part.startsWith(abbr) || abbr.startsWith(part));
        }
        
        if (index >= 0) {
          return index + 1;
        }
      }
      
      return null;
    };

    // Try to get month numbers from the first available month name
    const month1 = getMonthNumber(month1Name);
    const month2 = getMonthNumber(month2Name);
    const month3 = getMonthNumber(month3Name);
    
    // Use the first available month to determine quarter
    const firstMonth = month1 || month2 || month3;
    
    if (firstMonth === null) {
      return null;
    }
    
    // Determine quarter from the first month
    const quarter = Math.ceil(firstMonth / 3);
    
    // Try to extract year from month names (e.g., "apr-25", "25-apr", "Apr-2025", "2025-Apr")
    let year: number | null = null;
    const yearPattern = /(\d{2,4})/;
    
    for (const monthName of [month1Name, month2Name, month3Name]) {
      if (monthName) {
        const normalized = monthName.trim().toLowerCase();
        const parts = normalized.split(/[-_\/\s]+/);
        
        // Look for year in all parts
        for (const part of parts) {
          if (/^\d{2,4}$/.test(part)) {
            const num = parseInt(part, 10);
            // If it's 2 digits, could be day or year
            if (part.length === 2) {
              // If it's > 31, it's likely a year (e.g., "25" could be day, but "99" would be year)
              // For 2-digit years, assume 20xx if reasonable
              if (num > 31 || num < 1) {
                year = 2000 + num;
              } else {
                // Could be day, but also check if it makes sense as a year
                // If we see a pattern like "25-Apr" vs "Apr-25", the position matters
                // For now, if it's 2 digits and we haven't found a year yet, try it
                if (year === null && num >= 0 && num <= 99) {
                  year = 2000 + num;
                }
              }
            } else if (part.length === 4) {
              // 4-digit year
              if (num >= 2000 && num <= 2100) {
                year = num;
                break; // Found a valid 4-digit year, use it
              }
            }
          }
        }
        
        // Also try regex pattern matching on the whole string
        if (year === null) {
          const match = monthName.match(/(\d{4})/); // Look for 4-digit year first
          if (match) {
            const yearStr = match[1];
            const num = parseInt(yearStr, 10);
            if (num >= 2000 && num <= 2100) {
              year = num;
              break;
            }
          } else {
            // Try 2-digit year
            const match2 = monthName.match(/(?:^|[-_\/\s])(\d{2})(?:[-_\/\s]|$)/);
            if (match2) {
              const yearStr = match2[1];
              const num = parseInt(yearStr, 10);
              // If it's a reasonable year (not a day), use it
              if (num > 31 || (num >= 0 && num <= 99)) {
                year = 2000 + num;
                break;
              }
            }
          }
        }
        
        if (year && year >= 2000 && year <= 2100) {
          break;
        }
      }
    }
    
    // Default to current year if no year found
    if (!year) {
      year = new Date().getFullYear();
    }
    
    return { quarter, year };
  };

  const onActivityDrop = useCallback((acceptedFiles: File[]) => {
    // Clear loaded batch ID when new files are uploaded
    setLoadedBatchId(null);
    setBatchQuarter(null);
    setBatchYear(null);
    
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
      .then(async rows => {
        setActivityUpload({
          file,
          rows,
          errors: [],
        });
        
        // Determine quarter and year from month names in the activity statement
        let quarter = 0;
        let year = new Date().getFullYear();
        
        if (rows.length > 0) {
          const firstRow = rows[0];
          const quarterInfo = determineQuarterFromMonthNames(
            firstRow.month1Name,
            firstRow.month2Name,
            firstRow.month3Name
          );
          
          if (quarterInfo) {
            quarter = quarterInfo.quarter;
            year = quarterInfo.year;
            console.log(`Determined quarter from activity statement: Q${quarter} ${year} from months: ${firstRow.month1Name}, ${firstRow.month2Name}, ${firstRow.month3Name}`);
          } else {
            console.warn('Could not determine quarter from month names, defaulting to Q0');
          }
        }
        
        // Set quarterlyData with the determined quarter
        setQuarterlyData({
          quarter,
          year,
          players: [],
          monthlyBreakdown: [],
        });
        
        setGenerationStatus(`Loaded activity statement for ${rows.length} accounts. Saving members to database...`);
        
        // Automatically save/update members in the database
        try {
          const response = await fetch('/api/save-members', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              activityRows: rows,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              setGenerationStatus(
                `Loaded activity statement for ${rows.length} accounts. ` +
                `Saved ${data.savedCount} new members and updated ${data.updatedCount} existing members.`
              );
            } else {
              console.error('Error saving members:', data.error);
              setGenerationStatus(`Loaded activity statement for ${rows.length} accounts. Warning: Failed to save members.`);
            }
          } else {
            console.error('Failed to save members:', response.statusText);
            setGenerationStatus(`Loaded activity statement for ${rows.length} accounts. Warning: Failed to save members.`);
          }
        } catch (error) {
          console.error('Error saving members:', error);
          setGenerationStatus(`Loaded activity statement for ${rows.length} accounts. Warning: Failed to save members.`);
        }
      })
      .catch(error => {
        console.error('Error parsing activity statement:', error);
        setActivityUpload({
          file,
          rows: [],
          errors: [`Error parsing activity statement: ${error.message ?? error}`],
        });
        setGenerationStatus('Error parsing activity statement');
      });
  }, []);

  const onPreCommitmentDrop = useCallback((acceptedFiles: File[]) => {
    // Clear loaded batch ID when new files are uploaded
    setLoadedBatchId(null);
    setBatchQuarter(null);
    setBatchYear(null);
    
    const file = acceptedFiles[0];
    if (!file) {
      alert('Please upload the pre-commitment workbook');
      return;
    }

    const validation = validatePreCommitmentFile(file);
    if (!validation.isValid) {
      alert(`Pre-commitment file validation failed: ${validation.errors.join(', ')}`);
      return;
    }

    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    const parseFile = extension === '.xlsx'
      ? (f: File) => parsePreCommitmentExcel(f, { filterNoPlay: false })
      : (f: File) => parsePreCommitmentCSV(f, { filterNoPlay: false });

    parseFile(file)
      .then(players => {
        setPreCommitmentUpload({
          file,
          players,
          errors: [],
        });
        setGenerationStatus(`Loaded pre-commitment limits for ${players.length} accounts`);
      })
      .catch(error => {
        console.error('Error parsing pre-commitment workbook:', error);
        setPreCommitmentUpload({
          file,
          players: [],
          errors: [`Error parsing pre-commitment workbook: ${error.message ?? error}`],
        });
        setGenerationStatus('Error parsing pre-commitment workbook');
      });
  }, []);

  const { getRootProps: getMonthlyRootProps, getInputProps: getMonthlyInputProps, isDragActive: isMonthlyDragActive } = useDropzone({
    onDrop: onMonthlyDrop,
    accept: {
      'text/csv': ['.csv']
    },
    multiple: true
  });

  const { getRootProps: getActivityRootProps, getInputProps: getActivityInputProps, isDragActive: isActivityDragActive } = useDropzone({
    onDrop: onActivityDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
    },
    multiple: false,
  });

  const { getRootProps: getPreCommitmentRootProps, getInputProps: getPreCommitmentInputProps, isDragActive: isPreCommitmentDragActive } = useDropzone({
    onDrop: onPreCommitmentDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
    },
    multiple: false,
  });

  const previewPDF = async (account?: string) => {
    if (!activityUpload || activityUpload.rows.length === 0) {
      alert('Upload an activity statement before generating a preview');
      return;
    }

    // Pre-commitment and cashless are optional - proceed with just activity statement if needed
    if (!preCommitmentUpload || preCommitmentUpload.players.length === 0) {
      console.warn('No pre-commitment data - preview will only show activity statements');
    }

    if (!quarterlyData || quarterlyData.players.length === 0) {
      console.warn('No cashless statement data - preview will only show activity statements');
    }

    if (!startDate || !endDate) {
      alert('Please set both start and end dates for the statement period before generating a preview');
      return;
    }

    const previewAccount = account ?? annotatedPlayers[0]?.account ?? 'ALL';
    const accountLabel = account
      ? `account ${account}`
      : previewAccount !== 'ALL'
        ? `account ${previewAccount}`
        : 'the first matched account';
    setPreviewingAccount(previewAccount);
    
    try {
      // Auto-save batch if not already saved
      let batchId = loadedBatchId;
      
      if (batchId) {
        // Batch already saved, preview will be faster
        setGenerationStatus(`Generating preview for ${accountLabel}... (Using saved batch - this will be quick!)`);
      } else {
        // Inform user that previewing requires saving first, which takes time
        setGenerationStatus(`⏳ Preparing preview for ${accountLabel}... This will take some time as we need to save your data first. Please wait...`);
        
        // Small delay to ensure the message is visible
        await new Promise(resolve => setTimeout(resolve, 500));
        
        try {
          // Use chunked save approach to avoid memory issues
          const chunkSize = 1000;
          const totalRows = activityUpload.rows.length;
          const estimatedTime = Math.ceil(totalRows / chunkSize) * 2; // Rough estimate: 2 seconds per chunk
          
          // First, create the batch and get batchId
          setGenerationStatus(`💾 Saving data for preview... Processing ${totalRows} rows in chunks. This may take ${estimatedTime}-${estimatedTime + 10} seconds. Please be patient...`);
          
          await new Promise(resolve => setTimeout(resolve, 300));
          
          setGenerationStatus(`Initializing batch for preview...`);
          const finalQuarterlyData = quarterlyData || { quarter: 0, year: 0, players: [], monthlyBreakdown: [] };
          const initResponse = await fetch('/api/save-batch-init', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              quarter: finalQuarterlyData.quarter || 0,
              year: finalQuarterlyData.year || new Date().getFullYear(),
              totalAccounts: annotatedPlayers.length,
              quarterlyData: finalQuarterlyData,
              preCommitmentPlayers: preCommitmentUpload?.players || [],
              startDate: startDate || null,
              endDate: endDate || null,
            }),
          });

          if (!initResponse.ok) {
            throw new Error('Failed to initialize batch for preview');
          }

          const initData = await initResponse.json();
          if (!initData.success) {
            throw new Error(initData.error || 'Failed to initialize batch for preview');
          }
          batchId = initData.batchId;

          // Calculate total chunks
          const totalChunks = Math.ceil(totalRows / chunkSize);

          // Send data in chunks
          for (let i = 0; i < totalRows; i += chunkSize) {
            const chunk = activityUpload.rows.slice(i, i + chunkSize);
            const currentChunk = Math.floor(i / chunkSize) + 1;
            const progress = Math.min(i + chunkSize, totalRows);
            
            setGenerationStatus(`💾 Saving chunk ${currentChunk}/${totalChunks} for preview (${progress}/${totalRows} rows)... This may take a moment, please wait...`);

            const chunkResponse = await fetch('/api/save-batch-chunk', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                batchId,
                activityRows: chunk,
                preCommitmentPlayers: preCommitmentUpload?.players || [],
                quarterlyData: quarterlyData || { quarter: 0, year: 0, players: [], monthlyBreakdown: [] },
                chunkIndex: Math.floor(i / chunkSize),
                isLastChunk: i + chunkSize >= totalRows,
              }),
            });

            if (!chunkResponse.ok) {
              throw new Error(`Failed to save chunk ${currentChunk} for preview`);
            }

            const chunkData = await chunkResponse.json();
            if (!chunkData.success) {
              throw new Error(chunkData.error || `Failed to save chunk ${currentChunk} for preview`);
            }
          }

          // Finalize the batch
          setGenerationStatus(`Finalizing batch for preview... Almost done!`);
          const finalizeResponse = await fetch('/api/save-batch-finalize', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              batchId,
              startDate: startDate || null,
              endDate: endDate || null,
            }),
          });

          if (!finalizeResponse.ok) {
            throw new Error('Failed to finalize batch for preview');
          }

          const finalizeData = await finalizeResponse.json();
          if (!finalizeData.success) {
            throw new Error(finalizeData.error || 'Failed to finalize batch for preview');
          }

          setLoadedBatchId(batchId);
          
          // Update batches list asynchronously (don't wait for it)
          loadPreviousBatches().catch(error => 
            console.warn('Failed to reload batches list:', error)
          );
        } catch (saveError) {
          const errorMsg = saveError instanceof Error ? saveError.message : 'Unknown error';
          throw new Error(`Failed to save batch for preview: ${errorMsg}`);
        }
      }

      // Use the new batch-based preview endpoint
      if (!batchId) {
        throw new Error('No batch ID available for preview');
      }
      
      setGenerationStatus(`Generating preview for ${accountLabel}...`);
      
      const previewUrl = `/api/preview-batch-pdf?batchId=${encodeURIComponent(batchId)}${account ? `&account=${encodeURIComponent(account)}` : ''}`;
      
      const response = await fetch(previewUrl);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        const errorMessage = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(errorMessage);
      }

      // Get the HTML content and display directly in new window
      const html = await response.text();
      
      // Check if HTML response is valid
      if (!html || html.length < 100) {
        throw new Error('Invalid or empty HTML response from preview API');
      }
      
      // Always use '_blank' to ensure it opens in a new tab (like target="_blank")
      const previewWindow = window.open('about:blank', '_blank');
      
      if (previewWindow) {
        // Write HTML content to the new window
        previewWindow.document.open();
        previewWindow.document.write(html);
        previewWindow.document.close();
        previewWindow.focus();
      } else {
        // Fallback if popup is blocked
        alert('Popup blocked. Please allow popups for this site to preview PDFs.');
      }

      setGenerationStatus(`Preview generated successfully for ${accountLabel}!`);
    } catch (error) {
      console.error('Error generating preview:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setGenerationStatus(`Error generating preview for ${accountLabel}: ${errorMessage}`);
    } finally {
      setPreviewingAccount(null);
    }
  };

  const generatePDFs = async (account?: string) => {
    if (!activityUpload || activityUpload.rows.length === 0) {
      alert('Upload an activity statement before generating PDFs');
      return;
    }

    // Pre-commitment and cashless are optional - proceed without confirmation

    if (!startDate || !endDate) {
      alert('Please set both start and end dates for the statement period before generating PDFs');
      return;
    }

    const targetAccount = account ?? annotatedPlayers[0]?.account ?? 'ALL';
    const accountLabel = account
      ? `account ${account}`
      : targetAccount !== 'ALL'
        ? `account ${targetAccount}`
        : 'the first matched account';
    const noun = 'PDF';
    setGeneratingAccount(targetAccount);
    setGenerationStatus(`Generating ${noun} for ${accountLabel}...`);

    try {
      const response = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activityRows: activityUpload.rows,
          preCommitmentPlayers: preCommitmentUpload?.players || [],
          quarterlyData: quarterlyData || { quarter: 0, year: 0, players: [], monthlyBreakdown: [] },
          account,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate PDFs');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      if (account) {
        const sanitizedAccount = account.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
        a.download = `Annotated_Statement_${sanitizedAccount}.pdf`;
      } else {
        const fallbackQuarterlyData = quarterlyData || { quarter: 0, year: new Date().getFullYear(), players: [], monthlyBreakdown: [] };
        a.download = `skycity-quarterly-statements-q${fallbackQuarterlyData.quarter}-${fallbackQuarterlyData.year}.pdf`;
      }
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setGenerationStatus(`${noun} generated successfully for ${accountLabel}!`);
      
      // Reload batches list if we generated for all accounts (new batch was saved)
      if (!account) {
        loadPreviousBatches();
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      setGenerationStatus(`Error generating ${noun} for ${accountLabel}`);
    } finally {
      setGeneratingAccount(null);
    }
  };

  const sendPDF = async (account?: string) => {
    if (!activityUpload || activityUpload.rows.length === 0) {
      alert('Upload an activity statement before sending PDFs');
      return;
    }

    // Pre-commitment and cashless are optional - proceed without confirmation

    const targetAccount = account ?? annotatedPlayers[0]?.account ?? 'ALL';
    const targetPlayer = annotatedPlayers.find(p => p.account === targetAccount);
    
    if (!targetPlayer || !targetPlayer.activity?.email) {
      alert('No email address found for this account. Cannot send PDF.');
      return;
    }

    const accountLabel = account
      ? `account ${account}`
      : targetAccount !== 'ALL'
        ? `account ${targetAccount}`
        : 'the first matched account';
    
    setSendingAccount(targetAccount);
    setGenerationStatus(`Sending PDF to ${targetPlayer.activity.email} for ${accountLabel}...`);

    try {
      const response = await fetch('/api/send-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activityRows: activityUpload.rows,
          preCommitmentPlayers: preCommitmentUpload?.players || [],
          quarterlyData: quarterlyData || { quarter: 0, year: 0, players: [], monthlyBreakdown: [] },
          account,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send PDF');
      }

      const data = await response.json();
      if (data.success) {
        setGenerationStatus(`PDF sent successfully to ${targetPlayer.activity.email} for ${accountLabel}!`);
      } else {
        throw new Error(data.error || 'Failed to send PDF');
      }
    } catch (error) {
      console.error('Error sending PDF:', error);
      setGenerationStatus(`Error sending PDF for ${accountLabel}`);
    } finally {
      setSendingAccount(null);
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => {
      const newFiles = prev.filter((_, i) => i !== index);
      setGenerationStatus('');
      
      // Re-aggregate quarterly data
      if (newFiles.length > 0) {
        const monthlyData = newFiles.map(f => ({
          month: f.month,
          year: f.year,
          data: f.data
        }));
        
        try {
          const quarterly = aggregateQuarterlyData(monthlyData);
          setQuarterlyData(quarterly);
        } catch (error) {
          setQuarterlyData(null);
        }
      } else {
        setQuarterlyData(null);
      }
      
      return newFiles;
    });
  };

  const downloadActivityTemplate = async () => {
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

  const downloadPreCommitmentTemplate = async () => {
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

  const downloadCSVTemplate = async () => {
    try {
      const response = await fetch('/api/download-csv-template');
      
      if (!response.ok) {
        throw new Error('Failed to download template');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Monthly_Cashless_Template.xlsx';
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
      <div className="w-full px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Quarterly Statements PDF Generator
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

        {/* Generation Tab */}
        {activeTab === 'generation' && (
          <div>
            {/* Upload Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {/* Activity Statement Upload */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold mb-2">Activity Statement (Pages 1-2)</h2>
                  <p className="text-sm text-gray-600 mb-3">Upload the quarterly activity workbook exported from the template.</p>
                  <div className="flex gap-2 flex-wrap">
                    <div className="relative group">
                      <button
                        onClick={downloadActivityTemplate}
                        className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-lg"
                        aria-label="Download Template"
                      >
                        📥
                      </button>
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        Download Template
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-b-gray-800"></div>
                      </div>
                    </div>
                    {activityUpload && (
                      <button
                        onClick={() => {
                          setActivityUpload(null);
                          setGenerationStatus('');
                        }}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div
                  {...getActivityRootProps()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    isActivityDragActive
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <input {...getActivityInputProps()} />
                  <div className="text-gray-600">
                    {isActivityDragActive ? (
                      <p className="text-sm">Drop the activity statement here...</p>
                    ) : (
                      <div>
                        <p className="text-base mb-1">Drag & drop or click to select</p>
                        <p className="text-xs text-gray-500">
                          Supports .xlsx or .csv files
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {activityUpload && (
                  <div className="mt-4">
                    <h3 className="font-medium text-sm truncate" title={activityUpload.file.name}>{activityUpload.file.name}</h3>
                    <p className="text-xs text-gray-600">Accounts: {activityUpload.rows.length}</p>
                    {activityUpload.errors.length > 0 && (
                      <div className="text-red-600 text-xs mt-2">
                        <p>Errors:</p>
                        <ul className="list-disc list-inside">
                          {activityUpload.errors.map((error, i) => (
                            <li key={i}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Pre-commitment Upload */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold mb-2">Pre-commitment Template (Pages 3-4)</h2>
                  <p className="text-sm text-gray-600 mb-3">Upload the pre-commitment workbook with the Session Summary worksheet.</p>
                  <div className="flex gap-2 flex-wrap">
                    <div className="relative group">
                      <button
                        onClick={downloadPreCommitmentTemplate}
                        className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-lg"
                        aria-label="Download Template"
                      >
                        📥
                      </button>
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        Download Template
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-b-gray-800"></div>
                      </div>
                    </div>
                    {preCommitmentUpload && (
                      <button
                        onClick={() => {
                          setPreCommitmentUpload(null);
                          setGenerationStatus('');
                        }}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div
                  {...getPreCommitmentRootProps()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    isPreCommitmentDragActive
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <input {...getPreCommitmentInputProps()} />
                  <div className="text-gray-600">
                    {isPreCommitmentDragActive ? (
                      <p className="text-sm">Drop the pre-commitment workbook here...</p>
                    ) : (
                      <div>
                        <p className="text-base mb-1">Drag & drop or click to select</p>
                        <p className="text-xs text-gray-500">
                          Supports .xlsx or .csv files
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {preCommitmentUpload && (
                  <div className="mt-4">
                    <h3 className="font-medium text-sm truncate" title={preCommitmentUpload.file.name}>{preCommitmentUpload.file.name}</h3>
                    <p className="text-xs text-gray-600">Accounts: {preCommitmentUpload.players.length}</p>
                    {preCommitmentUpload.errors.length > 0 && (
                      <div className="text-red-600 text-xs mt-2">
                        <p>Errors:</p>
                        <ul className="list-disc list-inside">
                          {preCommitmentUpload.errors.map((error, i) => (
                            <li key={i}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Monthly Cashless Upload */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold mb-2">Monthly Cashless CSVs (Cashless Pages)</h2>
                  <p className="text-sm text-gray-600 mb-3">Upload the three monthly cashless files that make up the quarter.</p>
                  <div className="relative group">
                    <button
                      onClick={downloadCSVTemplate}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-lg"
                      aria-label="Download Template"
                    >
                      📥
                    </button>
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      Download Template
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-b-gray-800"></div>
                    </div>
                  </div>
                </div>
          
                <div
                  {...getMonthlyRootProps()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    isMonthlyDragActive
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <input {...getMonthlyInputProps()} />
                  <div className="text-gray-600">
                    {isMonthlyDragActive ? (
                      <p className="text-sm">Drop the CSV files here...</p>
                    ) : (
                      <div>
                        <p className="text-base mb-1">Drag & drop or click to select</p>
                        <p className="text-xs text-gray-500">
                          Supports .csv files
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Uploaded Files */}
                {uploadedFiles.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-semibold mb-2 text-gray-700">Uploaded Files</h3>
                    <div className="space-y-2">
                      {uploadedFiles.map((fileData, index) => (
                        <div key={index} className="border rounded-lg p-2 flex flex-col">
                          <div className="flex justify-between items-start">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-xs mb-1 truncate" title={fileData.file.name}>{fileData.file.name}</h4>
                              <p className="text-xs text-gray-600">
                                {fileData.month}/{fileData.year} • {fileData.data.length} players
                              </p>
                              {fileData.errors.length > 0 && (
                                <div className="text-red-600 text-xs mt-1">
                                  <p>Errors:</p>
                                  <ul className="list-disc list-inside">
                                    {fileData.errors.map((error, i) => (
                                      <li key={i}>{error}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => removeFile(index)}
                              className="text-red-600 hover:text-red-800 text-xs ml-2 flex-shrink-0"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Quarterly Data Summary */}
        {quarterlyData && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Quarterly Summary</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-sm text-gray-600">Quarter</p>
                <p className="text-lg font-medium">Q{quarterlyData.quarter} {quarterlyData.year}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Players</p>
                <p className="text-lg font-medium">{annotatedPlayers.length}</p>
              </div>
            </div>
            {quarterlyData.statementPeriod && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Statement Period:</strong> {quarterlyData.statementPeriod.startDate} – {quarterlyData.statementPeriod.endDate}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Statement Period Inputs - Always visible */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-2">Statement Period</h2>
            <p className="text-sm text-gray-600">The start and end dates are automatically set based on the quarter. You can adjust them if needed.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-2">
                Start Date
              </label>
              <input
                type="date"
                id="startDate"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setStatementPeriodSaved(false);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setStatementPeriodSaved(false);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          {startDate && endDate && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Statement Period:</strong> {new Date(startDate).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })} – {new Date(endDate).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </p>
            </div>
          )}
          {(!startDate || !endDate) && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                ⚠ Please set both start and end dates for the statement period
              </p>
            </div>
          )}
        </div>

        {/* Generation Status - Moved below Statement Period */}
        {generationStatus && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
            <p className="text-sm text-blue-800 mb-2">{generationStatus}</p>
            {savingBatch && saveProgress > 0 && (
              <div className="w-full bg-blue-200 rounded-full h-2.5 mt-2">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${saveProgress}%` }}
                ></div>
              </div>
            )}
          </div>
        )}

        {/* Matched Players */}
        {(annotatedPlayers.length > 0 || (loadedBatchId && batchSearchQuery)) && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
              <div>
                <h2 className="text-xl font-semibold">Matched Accounts</h2>
                <p className="text-sm text-gray-600">
                  {batchSearchQuery 
                    ? `Found ${totalAccounts.toLocaleString()} accounts matching "${batchSearchQuery}"`
                    : totalPages > 1 
                      ? `Showing ${startIndex + 1} to ${Math.min(endIndex, totalAccounts)} of ${totalAccounts.toLocaleString()} matched accounts (Page ${currentPage} of ${totalPages})`
                      : `Preview or download individual annotated statements.`
                  }
                </p>
              </div>
              <div className="flex flex-col md:flex-row items-center gap-3">
                {/* Server-side search input - only show for loaded batches */}
                {loadedBatchId && (
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search by account, name, or email..."
                      value={batchSearchQuery}
                      onChange={(e) => handleBatchSearch(e.target.value)}
                      className="px-3 py-2 pl-9 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={loadingBatch !== null}
                    />
                    <svg
                      className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    {batchSearchQuery && (
                      <button
                        onClick={clearBatchSearch}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        disabled={loadingBatch !== null}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1); // Reset to first page when changing page size
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  disabled={isGenerating || isPreviewing || isSending}
                >
                  <option value="25">25 per page</option>
                  <option value="50">50 per page</option>
                  <option value="100">100 per page</option>
                </select>
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
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border border-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Account</th>
                    <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Name</th>
                    <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Email</th>
                    <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Data Sources</th>
                    <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPlayers.length === 0 && batchSearchQuery && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        No accounts found matching &quot;{batchSearchQuery}&quot;
                        <button
                          onClick={clearBatchSearch}
                          className="ml-2 text-blue-600 hover:text-blue-800 underline"
                        >
                          Clear search
                        </button>
                      </td>
                    </tr>
                  )}
                  {paginatedPlayers.map(player => {
                    const fullName = [player.activity?.firstName, player.activity?.lastName]
                      .filter(Boolean)
                      .join(' ')
                      .trim();
                    const email = player.activity?.email ?? '-';
                    const hasActivity = Boolean(player.activity);
                    const hasPreCommitment = Boolean(player.preCommitment);
                    const hasCashless = Boolean(player.cashless);
                    const isAccountPreviewing = previewingAccount === player.account || previewingAccount === 'ALL';
                    const isAccountGenerating = generatingAccount === player.account || generatingAccount === 'ALL';
                    const isAccountSending = sendingAccount === player.account || sendingAccount === 'ALL';

                    return (
                      <tr key={player.account} className="hover:bg-gray-50">
                        <td className="px-4 py-2 border border-gray-200">{player.account}</td>
                        <td className="px-4 py-2 border border-gray-200">{fullName || 'Name unavailable'}</td>
                        <td className="px-4 py-2 border border-gray-200">{email}</td>
                        <td className="px-4 py-2 border border-gray-200">
                          <div className="flex flex-wrap gap-1">
                            <span
                              className={`px-2 py-1 rounded-full text-xs ${hasActivity ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                            >
                              Activity
                            </span>
                            <span
                              className={`px-2 py-1 rounded-full text-xs ${hasPreCommitment ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                            >
                              Pre-commitment
                            </span>
                            <span
                              className={`px-2 py-1 rounded-full text-xs ${hasCashless ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                            >
                              Cashless
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 border border-gray-200">
                          <div className="flex gap-2">
                            <button
                              onClick={() => previewPDF(player.account)}
                              disabled={isGenerating || isPreviewing || isSending}
                              className={`px-3 py-1 rounded text-sm font-medium transition-colors text-white ${
                                isPreviewing || isGenerating || isSending
                                  ? 'bg-gray-400 cursor-not-allowed'
                                  : 'bg-emerald-600 hover:bg-emerald-700'
                              }`}
                            >
                              {isPreviewing && isAccountPreviewing ? 'Previewing...' : 'Preview'}
                            </button>
                            <button
                              onClick={() => generatePDFs(player.account)}
                              disabled={isGenerating || isPreviewing || isSending}
                              className={`px-3 py-1 rounded text-sm font-medium transition-colors text-white ${
                                isGenerating || isPreviewing || isSending
                                  ? 'bg-gray-400 cursor-not-allowed'
                                  : 'bg-blue-600 hover:bg-blue-700'
                              }`}
                            >
                              {isGenerating && isAccountGenerating ? 'Exporting...' : 'Export'}
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
                  Showing {startIndex + 1} to {Math.min(endIndex, totalAccounts)} of {totalAccounts.toLocaleString()} accounts
                </div>
              </div>
            )}

            {/* Load More Button for Server-Side Pagination */}
            {loadedBatchId && loadedBatchPagination && loadedBatchPagination.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => {
                    const nextPage = (loadedBatchPagination.page || 0) + 1;
                    loadBatchPage(loadedBatchId, nextPage);
                  }}
                  disabled={loadingBatch !== null}
                  className="px-6 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingBatch ? 'Loading...' : `Load More (${loadedBatchPagination.totalAccounts - allAnnotatedPlayers.length} remaining)`}
                </button>
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
                  <h2 className="text-xl font-semibold">Previous Generation Batches</h2>
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
                            Q{batch.quarter} {batch.year} - {batch.total_accounts} {batch.total_accounts === 1 ? 'account' : 'accounts'}
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
