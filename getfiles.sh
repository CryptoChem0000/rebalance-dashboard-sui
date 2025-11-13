#!/bin/bash

# Check if correct number of arguments provided
if [ $# -ne 2 ]; then
    echo "Usage: $0 <directory_path> <output_file>"
    echo "Example: $0 /path/to/directory output.txt"
    exit 1
fi

# Assign arguments to variables
DIR_PATH="$1"
OUTPUT_FILE="$2"

# Check if directory exists
if [ ! -d "$DIR_PATH" ]; then
    echo "Error: Directory '$DIR_PATH' does not exist"
    exit 1
fi

# Clear or create the output file
> "$OUTPUT_FILE"

# Counter for files processed
file_count=0
total_count=0

echo "Starting recursive scan of directory: $DIR_PATH"
echo "Output will be saved to: $OUTPUT_FILE"
echo ""

# First, let's see how many files we'll process
echo "Counting files..."
total_count=$(find "$DIR_PATH" -type f | wc -l)
echo "Found $total_count files to process"
echo ""

# Process each file
find "$DIR_PATH" -type f -print0 | while IFS= read -r -d '' file; do
    # Skip the output file
    if [ "$(realpath "$file")" = "$(realpath "$OUTPUT_FILE")" ]; then
        echo "Skipping output file: $file"
        continue
    fi
    
    # Add separator and file path
    {
        echo "================================================================================="
        echo "FILE: $file"
        echo "================================================================================="
        
        # Add file contents
        if [ -r "$file" ]; then
            cat "$file"
        else
            echo "[Error: Cannot read file - Permission denied]"
        fi
        
        # Add newlines for spacing
        printf "\n\n"
    } >> "$OUTPUT_FILE"
    
    # Increment counter
    ((file_count++))
    
    # Show progress
    echo "[$file_count] Processed: $file"
done

# Final summary
echo ""
echo "================================================================================="
echo "Scanning complete!"
echo "Total files found: $total_count"
echo "Files processed: $file_count"
echo "Output saved to: $OUTPUT_FILE"
echo "Output file size: $(ls -lh "$OUTPUT_FILE" | awk '{print $5}')"
echo "================================================================================="

# Show first few lines of output file to confirm it worked
echo ""
echo "First few lines of output file:"
echo "---------------------------------"
head -n 20 "$OUTPUT_FILE"
