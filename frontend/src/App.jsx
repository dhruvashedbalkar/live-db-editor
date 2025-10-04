import React, { useState, useEffect, useCallback } from 'react';
import QueryExecutor from './QueryExecutor';
import TableEditor from './EditableTable';
import './EditableTable.css'; // Import the CSS file

// Base URL for the Express backend
const API_BASE_URL = 'http://localhost:3001/api';

export default function App() {
    const [tables, setTables] = useState([]);
    const [selectedTable, setSelectedTable] = useState('');
    const [loadingTables, setLoadingTables] = useState(false);

    // Function to fetch the list of tables from the backend
    const fetchTables = useCallback(async () => {
      setLoadingTables(true);
      try {
        const response = await fetch(`${API_BASE_URL}/tables`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const tableList = await response.json();
        setTables(tableList);
        
        // Logic to maintain or update selected table state
        if (!selectedTable && tableList.length > 0) {
          setSelectedTable(tableList[0]);
        } else if (selectedTable && !tableList.includes(selectedTable)) {
          setSelectedTable(tableList[0] || '');
        }
      } catch (err) {
        console.error('Could not fetch table list:', err);
      } finally {
        setLoadingTables(false);
      }
    }, [selectedTable]);

    // Initial load of tables
    useEffect(() => {
      fetchTables();
    }, [fetchTables]);

    // Handler passed to QueryExecutor to force a refresh of the table list
    const handleTableListRefresh = useCallback(() => {
        fetchTables();
    }, [fetchTables]);


    return (
        <div className="main-container">
          <meta name="viewport" content="width=device-width, initial-scale=1" />
            <h1 className="app-header">DB Management <span>{loadingTables ? '(Loading Tables...)' : ''}</span></h1>
            <div className="content-wrapper">
                
                {/* 1. Query Executor Panel */}
                <QueryExecutor onTableAction={handleTableListRefresh} API_BASE_URL={API_BASE_URL} />

                {/* 2. Table Editor Panel */}
                <TableEditor 
                    tables={tables}
                    selectedTable={selectedTable}
                    setSelectedTable={setSelectedTable}
                    API_BASE_URL={API_BASE_URL}
                    // pkName is defined internally in EditableTable.jsx, but it's cleaner 
                    // to define it consistently if possible. Keeping it internal here.
                />
            </div>
        </div>
    );
}