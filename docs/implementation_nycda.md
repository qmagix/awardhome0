# Fix NYCDA Parser for Studio Awards and Critics' Choice

You are completely correct. The coordinate-based parser in `categorize_nycda.js` relies heavily on horizontal alignment (X-axis) to distinguish between headers and data rows, which caused two specific edge-cases in the competition files to be misclassified:

1. **Studio Awards (Class Act, Good Sport, Versatility):** The PDF centers the winning studio name (`X > 10`), so the parser mistakenly treated the studio name as a new *Category Header* instead of an award data row, dropping it entirely.
2. **Critics' Choice & Judges' Pick:** These routines are listed with just two columns (Routine Name and Studio). Because this layout precisely matches the 2-column "Convention Scholarship" layout (Dancer Name and Studio), the parser incorrectly assumed it was a convention scholarship, mapping the routine name to the dancer name.

## Proposed Changes

### 1. Update `categorize_nycda.js`
We will introduce semantic category overrides to bypass the strict coordinate logic:
- **Studio Awards:** If `currentCategory` includes `"Class Act"`, `"Good Sport"`, `"Versatility"`, or `"Sportsmanship"`, the very next row will be extracted as a Studio Award: `Routine: (Studio Award)` and `Dancer: N/A`. It will not overwrite the `currentCategory`.
- **Critics' Choice/Judges' Pick:** If `currentCategory` includes `"Critics' Choice"` or `"Judges' Pick"`, a 2-column row will be extracted as a Competition Award: `Routine: col[0]`, `Dancer: N/A`, `Studio: col[1]`.

We will also update the script so it can process files already prefixed with `GOOD-`, overwriting the faulty `.txt` files in `txt/`.

### 2. Restore Database
Instead of manually deleting 36,000+ records and untangling the relational junction tables, we will seamlessly revert the database using the backup we created right before the NYCDA ingestion:
`cp database.sqlite.bak_nycda database.sqlite`

### 3. Re-Ingest Data
We will re-run the `node import_nycda_txt.js` script on the newly generated, corrected text files to securely insert the data back into the system.

## Verification Plan
After completion, we will verify:
- The `GOOD-baltimore_25-26-Baltimore-Competition-Results.pdf.txt` file correctly shows "Mrs. Carter" as a routine (not a dancer) under Judges' Pick.
- "Junior Class Act Award" correctly lists "Supernova Dance Company, MD" as the studio winner.
- The UI properly displays these studio awards.
