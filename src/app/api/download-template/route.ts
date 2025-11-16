import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function GET(request: NextRequest) {
  try {
    // Create a new workbook
    const workbook = XLSX.utils.book_new();
    
    // Define the template headers based on the PreCommitmentCSVRow interface
    // Blue section: Member information
    // Dark gray section: Budget and Time limits
    // Light gray section: Schedule and activity
    const headers = [
      'Acct',
      'KnownAs',
      'LastName',
      'Add1',
      'Add2',
      'SuburbName',
      'StateName',
      'Pcode',
      'Enrolled', 
      'Un Enrolled',
      'Status',
      'Is Play',
      'Breaches',
      'Start Day',
      'Consecutive Days',
      'Daily Budget',
      'Daily Time',
      'Weekly Budget',
      'Weekly Time',
      'Monthly Budget',
      'Monthly Time',
      'MON Start',
      'MON End',
      'TUE Start',
      'TUE End',
      'WED Start',
      'WED End',
      'THU Start',
      'THU End',
      'FRI Start',
      'FRI End',
      'SAT Start',
      'SAT End',
      'SUN Start',
      'SUN End',
      'Mins',
      'Every',
      'Hour',
      'Total Amount Spent',
      'Net Win/Loss'
    ];

    // Create sample data rows
    const sampleRows = [
      [
        '111',
        'John',
        'Smith',
        '123 Main St',
        '',
        'Adelaide',
        'SA',
        '5000',
        '1',
        '',
        'Enrolled',
        'Play',
        '0',
        'Monday',
        '1',
        '2000.05',
        '0',
        '500',
        '0',
        '0',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '10',
        'Every',
        '3',
        '0',
        '0'
      ],
      [
        '999',
        'Jane',
        'Doe',
        '456 Oak Ave',
        'Unit 2',
        'Adelaide',
        'SA',
        '5000',
        '1',
        '',
        'Enrolled',
        'No Play',
        '0',
        'Monday',
        '3',
        '1000',
        '0',
        '0',
        '0',
        '800',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '10',
        'Every',
        '1',
        '0',
        '0'
      ],
      [
        '101',
        'Bob',
        'Johnson',
        '789 Elm St',
        '',
        'Adelaide',
        'SA',
        '5000',
        '0',
        '1',
        'Un-Enrolled',
        'No Play',
        '0',
        'Monday',
        '',
        '10',
        '0',
        '0',
        '0',
        '0',
        '',
        '0.25',
        '0.3333333333333333',
        '0.5',
        '0.5416666666666666',
        '0.4166666666666667',
        '0.65625',
        '0.8104166666666667',
        '0.8333333333333334',
        '0.5833333333333334',
        '0.6013888888888889',
        '0.3333333333333333',
        '0.4166666666666667',
        '0.4583333333333333',
        '0.5',
        '5',
        'Every',
        '0',
        '0'
      ]
    ];

    // Create worksheet data
    const worksheetData = [headers, ...sampleRows];
    
    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    
    // Add some styling hints (basic)
    // Set column widths
    const colWidths = [
      { wch: 8 },  // Acct
      { wch: 12 }, // KnownAs
      { wch: 12 }, // LastName
      { wch: 15 }, // Add1
      { wch: 15 }, // Add2
      { wch: 12 }, // SuburbName
      { wch: 10 }, // StateName
      { wch: 8 },  // Pcode
      { wch: 10 }, // Enrolled
      { wch: 12 }, // Un Enrolled
      { wch: 10 }, // Status
      { wch: 10 }, // Is Play
      { wch: 10 }, // Breaches
      { wch: 12 }, // Start Day
      { wch: 15 }, // Consecutive Days
      { wch: 12 }, // Daily Budget
      { wch: 12 }, // Daily Time
      { wch: 12 }, // Weekly Budget
      { wch: 12 }, // Weekly Time
      { wch: 13 }, // Monthly Budget
      { wch: 13 }, // Monthly Time
      { wch: 10 }, // MON Start
      { wch: 10 }, // MON End
      { wch: 10 }, // TUE Start
      { wch: 10 }, // TUE End
      { wch: 10 }, // WED Start
      { wch: 10 }, // WED End
      { wch: 10 }, // THU Start
      { wch: 10 }, // THU End
      { wch: 10 }, // FRI Start
      { wch: 10 }, // FRI End
      { wch: 10 }, // SAT Start
      { wch: 10 }, // SAT End
      { wch: 10 }, // SUN Start
      { wch: 10 }, // SUN End
      { wch: 8 },  // Mins
      { wch: 8 },  // Every
      { wch: 8 },  // Hour
      { wch: 18 }, // Total Amount Spent
      { wch: 15 }  // Net Win/Loss
    ];
    
    worksheet['!cols'] = colWidths;
    
    // Member Contact Information Sheet (Sheet 1)
    const memberContactHeaders = [
      'Acct',
      'Firstname',
      'Last Name',
      'Preferred Name',
      'Is Email',
      'Is Email Inactive',
      'Email Address',
      'Is Postal',
      'Address1',
      'Address2',
      'City',
      'State Name',
      'Postal Code',
      'Country'
    ];

    const memberContactSampleRows = [
      ['111', 'John', 'Smith', 'Johnny', '1', '0', 'john.smith@example.com', '1', '123 Main St', '', 'Adelaide', 'SA', '5000', 'Australia'],
      ['999', 'Jane', 'Doe', 'Jane', '1', '0', 'jane.doe@example.com', '1', '456 Oak Ave', 'Unit 2', 'Adelaide', 'SA', '5000', 'Australia'],
      ['101', 'Bob', 'Johnson', 'Bobby', '0', '0', '', '1', '789 Elm St', '', 'Adelaide', 'SA', '5000', 'Australia']
    ];

    const memberContactWorksheet = XLSX.utils.aoa_to_sheet([memberContactHeaders, ...memberContactSampleRows]);
    memberContactWorksheet['!cols'] = [
      { wch: 8 },  // Acct
      { wch: 12 }, // Firstname
      { wch: 12 }, // Last Name
      { wch: 15 }, // Preferred Name
      { wch: 10 }, // Is Email
      { wch: 15 }, // Is Email Inactive
      { wch: 25 }, // Email Address
      { wch: 10 }, // Is Postal
      { wch: 20 }, // Address1
      { wch: 20 }, // Address2
      { wch: 15 }, // City
      { wch: 12 }, // State Name
      { wch: 12 }, // Postal Code
      { wch: 12 }  // Country
    ];

    // Add worksheets to workbook in the correct order:
    // Sheet 1: Member Contact
    XLSX.utils.book_append_sheet(workbook, memberContactWorksheet, 'Member Contact');
    
    // Sheet 2: PreCommitment Data
    XLSX.utils.book_append_sheet(workbook, worksheet, 'PreCommitment Data');

    // Sheet 3: Session Summary
    const sessionHeaders = [
      'Acct',
      'Session',
      'Session Win',
      'Session Loss',
      'Session Nett'
    ];

    const sessionSampleRows = [
      ['111', 'Session 1', '350', '120', '230'],
      ['111', 'Session 2', '180', '240', '-60'],
      ['999', 'Session 1', '95', '175', '-80']
    ];

    const sessionWorksheet = XLSX.utils.aoa_to_sheet([sessionHeaders, ...sessionSampleRows]);
    sessionWorksheet['!cols'] = [
      { wch: 10 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
    ];

    XLSX.utils.book_append_sheet(workbook, sessionWorksheet, 'Session Summary');
    
    // Generate Excel file buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Return Excel file
    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="PreCommitment_Template.xlsx"',
        'Content-Length': excelBuffer.length.toString(),
      },
    });

  } catch (error) {
    console.error('Error generating Excel template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate Excel template' },
      { status: 500 }
    );
  }
}
