#!/bin/bash

# Script to zip all folders in the uploads directory
# Usage: ./zip-upload-folders.sh [folder_name]
# If folder_name is provided, only that folder will be zipped
# Otherwise, all folders will be zipped

UPLOADS_DIR="uploads"
ZIP_DIR="$UPLOADS_DIR"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to zip a single folder
zip_folder() {
    local folder_name=$1
    local folder_path="$UPLOADS_DIR/$folder_name"
    local zip_path="$ZIP_DIR/${folder_name}.zip"
    
    if [ ! -d "$folder_path" ]; then
        echo -e "${RED}Error: Folder '$folder_path' does not exist${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}Zipping folder: $folder_name${NC}"
    
    # Remove existing zip if it exists
    if [ -f "$zip_path" ]; then
        echo -e "${YELLOW}Removing existing zip file...${NC}"
        rm "$zip_path"
    fi
    
    # Create zip file
    cd "$UPLOADS_DIR" || exit 1
    zip -r "${folder_name}.zip" "$folder_name" -q
    cd - > /dev/null || exit 1
    
    if [ -f "$zip_path" ]; then
        local zip_size=$(du -h "$zip_path" | cut -f1)
        echo -e "${GREEN}✓ Created: ${zip_path} (${zip_size})${NC}"
        return 0
    else
        echo -e "${RED}✗ Failed to create zip file${NC}"
        return 1
    fi
}

# Main script
if [ ! -d "$UPLOADS_DIR" ]; then
    echo -e "${RED}Error: Uploads directory '$UPLOADS_DIR' does not exist${NC}"
    exit 1
fi

if [ -n "$1" ]; then
    # Zip specific folder
    zip_folder "$1"
else
    # Zip all folders
    echo -e "${YELLOW}Finding all folders in $UPLOADS_DIR...${NC}"
    
    folders=$(find "$UPLOADS_DIR" -maxdepth 1 -type d ! -path "$UPLOADS_DIR" -exec basename {} \;)
    
    if [ -z "$folders" ]; then
        echo -e "${YELLOW}No folders found in $UPLOADS_DIR${NC}"
        exit 0
    fi
    
    folder_count=$(echo "$folders" | wc -l)
    echo -e "${YELLOW}Found $folder_count folder(s)${NC}"
    echo ""
    
    success_count=0
    fail_count=0
    
    while IFS= read -r folder; do
        if zip_folder "$folder"; then
            ((success_count++))
        else
            ((fail_count++))
        fi
        echo ""
    done <<< "$folders"
    
    echo -e "${GREEN}Completed: $success_count succeeded, $fail_count failed${NC}"
fi

