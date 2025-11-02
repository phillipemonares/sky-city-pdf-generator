"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatNumber = formatNumber;
exports.parseCSVNumber = parseCSVNumber;
exports.parseCSVDate = parseCSVDate;
// Number formatting utilities following Sky City requirements
function formatNumber(value) {
    // Handle empty/null values
    if (value === null || value === undefined || value === '' || value === 'null') {
        return '-';
    }
    // Convert to number
    const num = typeof value === 'string' ? parseFloat(value) : value;
    // Handle NaN
    if (isNaN(num)) {
        return '-';
    }
    // Handle negative numbers with brackets
    if (num < 0) {
        const absValue = Math.abs(num);
        return `-(${formatPositiveNumber(absValue)})`;
    }
    return formatPositiveNumber(num);
}
function formatPositiveNumber(num) {
    // Round to 2 decimal places
    const rounded = Math.round(num * 100) / 100;
    // Add .00 for round numbers
    const formatted = rounded.toFixed(2);
    // Add thousands separator for numbers >= 1000
    if (rounded >= 1000) {
        const parts = formatted.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    }
    return formatted;
}
// Helper function to parse CSV numeric values
function parseCSVNumber(value) {
    if (!value || value === '' || value === 'null') {
        return 0;
    }
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
}
// Helper function to parse CSV date values
function parseCSVDate(value) {
    if (!value || value === '' || value === 'null') {
        return '';
    }
    return value;
}
