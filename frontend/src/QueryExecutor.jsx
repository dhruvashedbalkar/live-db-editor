import React, { useState, useMemo } from 'react';

// --- Utility function for splitting queries safely ---
const splitQueries = (sql) => {
    if (!sql || !sql.trim()) return [];
    
    // Regex splits on semicolon, but only if it's NOT inside single quotes
    return sql.split(/;(?=(?:(?:[^']){2})*[^']*$)/)
              .map(s => s.trim())
              .filter(s => s.length > 0);
}

// --- Query Executor Component ---

export default function QueryExecutor({ onTableAction, API_BASE_URL }) {
    const [sqlQuery, setSqlQuery] = useState(''); 
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    
    // FIX: Derive the statement count using useMemo to ensure it's available in the render scope
    const statements = useMemo(() => splitQueries(sqlQuery), [sqlQuery]);

    const handleExecuteQuery = async () => {
        const statementsToExecute = statements;
        
        if (statementsToExecute.length === 0) {
            setError({ message: 'No valid SQL statements found.', type: 'error' });
            return;
        }

        setLoading(true);
        setResults(null);
        setError(null);
        
        let totalRowCount = 0;
        let lastResult = null;
        let queryFailed = false;

        // Loop through each statement and execute it sequentially
        for (const statement of statementsToExecute) {
            try {
                const response = await fetch(`${API_BASE_URL}/query`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sql: statement }),
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to execute query.');
                }
                
                // Store the result of the last query for display
                lastResult = { statement, data };

                // Aggregate row counts for DML/DDL operations
                if (data.rowCount !== undefined) {
                    totalRowCount += data.rowCount;
                }

                // If any DDL query runs, refresh the table list.
                const sqlUpper = statement.toUpperCase();
                const isDDL = sqlUpper.startsWith('CREATE') || 
                              sqlUpper.startsWith('DROP') ||
                              sqlUpper.startsWith('ALTER');
                
                if (isDDL && onTableAction) {
                    onTableAction();
                }

            } catch (err) {
                setError({ message: `Query execution failed on statement: "${statement}". Error: ${err.message}`, type: 'error' }); 
                queryFailed = true;
                break; // Stop execution on the first failure
            }
        }
        
        setLoading(false);

        // Process the final result (only if no failure occurred)
        if (!queryFailed && lastResult) {
            const { statement, data } = lastResult;
            
            // If the last statement was a SELECT, display the data table
            if (data.rows && Array.isArray(data.rows)) {
                setResults({
                    type: 'data',
                    data: data.rows,
                    columns: data.columns || Object.keys(data.rows[0] || {})
                });
            } else {
                // Otherwise, display a success message summarizing the execution
                const sqlUpper = statement.toUpperCase();
                const isDDL = sqlUpper.startsWith('CREATE') || sqlUpper.startsWith('DROP') || sqlUpper.startsWith('ALTER');

                setResults({
                    type: 'success',
                    message: isDDL 
                        ? 'DDL command(s) executed successfully. Table list refreshing...' 
                        : statementsToExecute.length > 1
                            ? `${statementsToExecute.length} queries executed successfully.`
                            : 'Query executed successfully.',
                    rowCount: totalRowCount,
                });
            }
        } else if (!queryFailed && statementsToExecute.length > 0) {
             setResults({
                type: 'success',
                message: `${statementsToExecute.length} queries executed successfully. Rows affected: ${totalRowCount}`,
                rowCount: totalRowCount,
            });
        }
    };
    
    // Render results table
    const renderResults = () => {
        if (!results) return null;

        if (results.type === 'success') {
            return (
                <div className="results-box success">
                    <p className="font-bold">{results.message}</p>
                    {results.rowCount !== undefined && <p>Rows affected/processed: {results.rowCount}</p>}
                </div>
            );
        }

        if (results.type === 'data') {
            const resultColumns = results.columns;
            const resultData = results.data;

            if (resultData.length === 0) {
                return <div className="results-box info">Query successful, but no rows returned.</div>;
            }

            return (
                <div className="results-box data-table-wrapper">
                    <p className="font-bold mb-3 text-sm text-indigo-300">Results ({resultData.length} rows)</p>
                    <table className="results-data-table">
                        <thead>
                            <tr className="results-header">
                                {resultColumns.map(col => (
                                    <th key={col}>{col}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {resultData.map((row, index) => (
                                <tr key={index} className="results-row">
                                    {resultColumns.map(col => (
                                        <td key={col}>{String(row[col] ?? 'NULL')}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="query-executor-container">
            <h2 className="header-title-small mb-4">SQL Query Executor</h2>
            <textarea
                className="query-input"
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                placeholder={`Example: SELECT * FROM Products WHERE price > 50;\n\nOr MULTIPLE queries:\nINSERT INTO Table (col) VALUES (1);\nUPDATE Table SET col = 2 WHERE id = 1;`}
                rows="8"
            ></textarea>

            <button
                onClick={handleExecuteQuery}
                className="btn btn-execute"
                disabled={loading || statements.length === 0} // Use statements.length here
            >
                {/* Use statements.length here */}
                {loading ? 'Executing...' : `Execute ${statements.length > 1 ? statements.length : ''} Query(s)`}
            </button>
            
            {error && (
                <div className={`message error mt-4`} role="alert">{error.message}</div>
            )}

            {/* Query Results */}
            <div className="mt-4">
                {renderResults()}
            </div>
        </div>
    );
}