#!/bin/bash

# Exit immediately if a command exits with a non-zero status
# set -e

# Define the years to process
YEARS=(2022 2023 2024 2025 2026)

# Define DanceBug competitions to import via batch_import.js
DB_COMPETITIONS=("starpower" "revolution" "believe" "imagine" "dreammaker")

echo "=========================================================="
echo "    Starting Mass Database Import (2022 - 2026)"
echo "=========================================================="

for YEAR in "${YEARS[@]}"; do
    echo ""
    echo "----------------------------------------------------------"
    echo "                 PROCESSING YEAR: $YEAR                   "
    echo "----------------------------------------------------------"

    # 1. Scrape KAR
    echo ">>> Running KAR ($YEAR)..."
    node scrape_kar_year.js $YEAR

    # 2. Scrape Rainbow
    echo ">>> Running Rainbow ($YEAR)..."
    node scrape_rainbow_year.js $YEAR

    # 3. Scrape YAGP
    echo ">>> Running YAGP ($YEAR)..."
    node scrape_all_yagp.js $YEAR

    # 4. Batch Import DanceBug Competitions
    for COMP in "${DB_COMPETITIONS[@]}"; do
        echo ">>> Running DanceBug Batch Import for $COMP ($YEAR)..."
        node batch_import.js $COMP $YEAR
    done
    
    echo "----------------------------------------------------------"
    echo "               FINISHED YEAR: $YEAR                       "
    echo "----------------------------------------------------------"
done

echo ""
echo "=========================================================="
echo "          Running Global Dancer Auto-Backfill             "
echo "=========================================================="
# Run the global backfill script across all events
node run_backfill.js

echo ""
echo "✅ Mass import and backfill process successfully completed!"
