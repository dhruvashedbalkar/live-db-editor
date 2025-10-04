const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');

// Initialize Prisma Client
const prisma = new PrismaClient();
const app = express();
const PORT = 3001;

// Middleware
app.use(cors()); // Allow cross-origin requests from the React frontend
app.use(express.json()); // To parse JSON bodies

// --- Utility Functions ---

/**
 * Gets the primary key name for a given table.
 * Assuming PK is 'id' for Prisma models, or 'ID'/'id' for dynamic tables.
 */
function getPrimaryKey(tableName) {
    // For simplicity, we assume 'id' or 'ID' is the PK name convention.
    // In a real app, you'd get this from table_info PRAGMA.
    return 'ID'; // Use a capitalized ID as seen in your CREATE TABLE examples
}

/**
 * Validates and sanitizes a table name to ensure it only contains safe characters.
 * IMPORTANT: This replaces the strict check with a format check for security.
 */
function sanitizeTableName(tableName) {
    // Must only contain alphanumeric characters and underscore.
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
        throw new Error(`Invalid table name format: ${tableName}`);
    }
    return tableName;
}

/**
 * Validates and sanitizes a column name.
 */
function sanitizeColumnName(columnName) {
    if (!/^[a-zA-Z0-9_]+$/.test(columnName)) {
        throw new Error(`Invalid column name: ${columnName}`);
    }
    return columnName;
}

// ------------------------------------
// --- REST API Endpoints ---
// ------------------------------------

// 1. Fetch table list dynamically from the database
app.get('/api/tables', async (req, res) => {
    try {
        // SQL query specific to SQLite to get user-defined tables
        const tables = await prisma.$queryRaw`
            SELECT name 
            FROM sqlite_master 
            WHERE type='table' 
              AND name NOT LIKE 'sqlite_%' 
              AND name NOT LIKE '_prisma_migrations';
        `;
        
        // Extract names from the result array
        const tableNames = tables.map(t => t.name);

        res.json(tableNames);
    } catch (error) {
        console.error('Error fetching dynamic table list:', error);
        res.status(500).json({ error: 'Failed to fetch table list dynamically.' });
    }
});

// 2. Fetch table columns and rows dynamically (FULL RAW SQL)
app.get('/api/data/:tableName', async (req, res) => {
    const tableName = req.params.tableName;
    
    try {
        sanitizeTableName(tableName); // Use the format check
        
        // 1. Fetch Columns (Schema Information) using SQLite PRAGMA
        const columnInfo = await prisma.$queryRawUnsafe(`PRAGMA table_info(\`${tableName}\`);`);

        const columns = columnInfo.map(col => ({
            field: col.name,
            type: col.type, // SQLite types like INTEGER, TEXT, REAL, DATETIME
            pk: col.pk > 0
        }));
        
        // 2. Fetch Data (Rows) using a raw SELECT query
        const data = await prisma.$queryRawUnsafe(`SELECT * FROM \`${tableName}\`;`);
        
        // Handle BigInts and ensure serializability
        const processedData = data.map(row => {
            const newRow = {};
            for (const key in row) {
                newRow[key] = (typeof row[key] === 'bigint') ? Number(row[key]) : row[key];
            }
            return newRow;
        });

        res.json({ columns, data: processedData });
    } catch (error) {
        console.error(`Error fetching dynamic table data for ${tableName}:`, error);
        res.status(500).json({ error: `Failed to fetch data for table ${tableName}. Error: ${error.message}` });
    }
});

// 3. Insert new row (FULL RAW SQL)
app.post('/api/data/:tableName', async (req, res) => {
    try {
        const tableName = sanitizeTableName(req.params.tableName);
        const newData = req.body;
        
        // Remove PK, as it's auto-incremented
        delete newData[getPrimaryKey(tableName)]; 
        
        const columns = [];
        const values = [];
        
        // Safely prepare column names and values for SQL
        for (const key in newData) {
            columns.push(sanitizeColumnName(key));
            values.push(newData[key]);
        }
        
        const columnList = columns.join(', ');
        // Generate placeholders ($1, $2, etc.) for parameterized query safety
        // NOTE: SQLite uses '?' instead of $1, $2, but Prisma handles the transformation.
        const placeholders = values.map(() => '?').join(', ');

        // Use RETURNING * to get the newly created row, including the auto-generated ID
        const sql = `INSERT INTO \`${tableName}\` (${columnList}) VALUES (${placeholders}) RETURNING *;`;
        
        // Execute the raw query with values passed as parameters for safety
        const createdRow = await prisma.$queryRawUnsafe(sql, ...values);
        
        // The result is an array, return the first item (the new row)
        res.status(201).json(createdRow[0] || {});
        
    } catch (error) {
        console.error('Error inserting row:', error);
        res.status(500).json({ error: 'Failed to insert row: ' + error.message });
    }
});

// 4. Update specific cells by ID (FULL RAW SQL)
app.put('/api/data/:tableName/:id', async (req, res) => {
    try {
        const tableName = sanitizeTableName(req.params.tableName);
        const pkName = getPrimaryKey(tableName); // e.g., 'ID'
        const id = parseInt(req.params.id); 
        const updateData = req.body; 

        // Extract the key (column name) and value
        const [key, value] = Object.entries(updateData)[0];
        const columnName = sanitizeColumnName(key);
        
        // Build the raw SQL UPDATE query
        // Safely set the column with placeholder ?, and WHERE clause with ?
        const sql = `UPDATE \`${tableName}\` SET \`${columnName}\` = ? WHERE \`${pkName}\` = ? RETURNING *;`;

        // Execute the raw query with values [value, id]
        const updatedRow = await prisma.$queryRawUnsafe(sql, value, id);

        res.json(updatedRow[0] || {});
    } catch (error) {
        console.error('Error updating cell:', error);
        res.status(500).json({ error: 'Failed to update cell: ' + error.message });
    }
});

// 5. Delete rows by ID (FULL RAW SQL)
app.delete('/api/data/:tableName/:id', async (req, res) => {
    try {
        const tableName = sanitizeTableName(req.params.tableName);
        const pkName = getPrimaryKey(tableName); // e.g., 'ID'
        const id = parseInt(req.params.id); 

        // Build the raw SQL DELETE query
        const sql = `DELETE FROM \`${tableName}\` WHERE \`${pkName}\` = ?;`;

        // Execute the raw query. $executeRawUnsafe returns count.
        await prisma.$executeRawUnsafe(sql, id);

        res.status(204).send(); 
    } catch (error) {
        console.error('Error deleting row:', error);
        res.status(500).json({ error: 'Failed to delete row: ' + error.message });
    }
});

// 6. Execute raw SQL queries
// Since the frontend now sends ONE query per request, this logic is correct.
app.post('/api/query', async (req, res) => {
    const { sql: query } = req.body;
    if (!query) {
        return res.status(400).json({ error: "SQL query is required." });
    }
    
    // Check if it's a DDL/DML query (CUD operations)
    // Trim and convert to uppercase for robust checking
    const upperQuery = query.trim().toUpperCase();
    const isExecute = upperQuery.startsWith('CREATE') ||
                      upperQuery.startsWith('ALTER') ||
                      upperQuery.startsWith('DROP') ||
                      upperQuery.startsWith('INSERT') ||
                      upperQuery.startsWith('UPDATE') ||
                      upperQuery.startsWith('DELETE') ||
                      upperQuery.startsWith('TRUNCATE');

    try {
        if (isExecute) {
            // Use $executeRawUnsafe for DDL/DML - returns the number of affected rows
            const rowCount = await prisma.$executeRawUnsafe(query);
            return res.json({ rowCount }); 
        } else {
            // Use $queryRawUnsafe for SELECTs - returns rows of data
            const rows = await prisma.$queryRawUnsafe(query);
            
            // Extract column names for the frontend result table
            const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
            return res.json({ rows, columns });
        }

    } catch (error) {
        console.error('Error executing raw SQL:', error);
        // Return the specific database error message to the frontend for display
        res.status(400).json({ error: error.message || 'Failed to execute query.' });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Server is now fully configured for dynamic tables.');
});