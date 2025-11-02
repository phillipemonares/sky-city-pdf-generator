import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function GET(request: NextRequest) {
  try {
    // Create a new workbook
    const workbook = XLSX.utils.book_new();
    
    // Define the template headers based on ActivityStatementRow interface
    const headers = [
      'Acct',
      'Title',
      'FirstName',
      'LastName',
      'Email',
      'Address',
      'Suburb',
      'State',
      'PostCode',
      'Country',
      'PlayerType',
      'EmailTick',
      'PostalTick',
      'KioskTick',
      'Gaming Days',
      'Total Turnover',
      'Player Win',
      'Total Amount Won',
      'Total Time Spent - Hour',
      'Total Time Spent - Minute',
      'Month 1 name',
      'Month 1 Total Amount Bet',
      'Month 1 No days gambled',
      'Month 1 Net Amount Won or (Lost)',
      'Month 1 Time Spent - Hour',
      'Month 1 Time Spent - Minute',
      'Month 2 name',
      'Month 2 Total Amount Bet',
      'Month 2 No days gambled',
      'Month 2 Net Amount Won or (Lost)',
      'Month 2 Time Spent - Hour',
      'Month 2 Time Spent - Minute',
      'Month 3 name',
      'Month 3 Total Amount Bet',
      'Month 3 No days gambled',
      'Month 3 Net Amount Won or (Lost)',
      'Month 3 Time Spent - Hour',
      'Month 3 Time Spent - Minute',
      'Channel_Tag'
    ];

    // Create sample data rows
    const sampleRows = [
      [
        '111',
        'Mr',
        'John',
        'Doe',
        'john.doe@example.com',
        '123 Main Street',
        'Adelaide',
        'SA',
        '5000',
        'Australia',
        'Standard',
        'Yes',
        'Yes',
        'No',
        '15',
        '25000.50',
        '1200.00',
        '1200.00',
        '45',
        '30',
        'January',
        '8000.00',
        '5',
        '200.00',
        '15',
        '10',
        'February',
        '9000.00',
        '5',
        '-150.00',
        '15',
        '15',
        'March',
        '8000.50',
        '5',
        '250.00',
        '15',
        '5',
        'Direct'
      ],
      [
        '222',
        'Ms',
        'Jane',
        'Smith',
        'jane.smith@example.com',
        '456 Oak Avenue',
        'Adelaide',
        'SA',
        '5001',
        'Australia',
        'Premium',
        'Yes',
        'No',
        'Yes',
        '20',
        '35000.75',
        '1800.00',
        '1800.00',
        '60',
        '45',
        'January',
        '12000.00',
        '7',
        '500.00',
        '20',
        '15',
        'February',
        '13000.00',
        '7',
        '300.00',
        '20',
        '15',
        'March',
        '10000.75',
        '6',
        '400.00',
        '20',
        '15',
        'Direct'
      ]
    ];

    // Create worksheet data
    const worksheetData = [headers, ...sampleRows];
    
    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    
    // Set column widths for better readability
    const colWidths = headers.map((_, i) => {
      if (i === 0) return { wch: 8 };  // Acct
      if (i === 4) return { wch: 25 }; // Email
      if (i === 5) return { wch: 20 }; // Address
      return { wch: 18 }; // Default width
    });
    
    worksheet['!cols'] = colWidths;
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Activity Statement');
    
    // Generate Excel file buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Return Excel file
    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="Activity_Statement_Template.xlsx"',
        'Content-Length': excelBuffer.length.toString(),
      },
    });

  } catch (error) {
    console.error('Error generating Activity Statement template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate Activity Statement template' },
      { status: 500 }
    );
  }
}

