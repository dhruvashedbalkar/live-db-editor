import React, { useState, useEffect, useCallback, useMemo } from 'react';

// Primary Key Name - Defined here for use in the component logic
const pkName = 'id';

// --- Utility Functions ---

/**
 * Converts a string value from a contentEditable cell into the correct JavaScript type 
 * based on the expected column type from the Prisma schema (for saving to DB).
 */
const safeTypeConvert = (value, columnType) => {
  if (value === null || value === '' || String(value).toLowerCase() === 'null') {
    return null; 
  }

  // Boolean Conversion (handles common true/false representations)
  if (columnType.includes('Boolean')) {
    const lowerValue = String(value).toLowerCase();
    if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 't' || lowerValue === 'yes') {
      return true;
    }
    if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'f' || lowerValue === 'no') {
      return false;
    }
    return !!value; 
  }

  // Numeric Conversion (Int, Float, Decimal)
  if (columnType.includes('Int') || columnType.includes('Float') || columnType.includes('Decimal')) {
    const parsedValue = parseFloat(value);
    if (!isNaN(parsedValue) && isFinite(parsedValue)) {
      return columnType.includes('Int') ? parseInt(parsedValue, 10) : parsedValue;
    }
    return null; 
  }

  // Default: String
  return String(value);
};


// --- Table Editor Component ---

// Note: API_BASE_URL is passed as a prop from App.jsx now.
export default function TableEditor({ tables, selectedTable, setSelectedTable, API_BASE_URL }) {
  const [data, setData] = useState([]);
  const [columns, setColumns] = useState([]);
  const [newRows, setNewRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editCache, setEditCache] = useState({});

  const showMessage = (msg, type = 'error') => {
    setError({ message: msg, type });
    setTimeout(() => setError(null), 5000);
  };

  const fetchData = useCallback(async (tableName) => {
    if (!tableName) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/data/${tableName}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const { columns, data: fetchedData } = await response.json();
      
      const filteredColumns = columns.filter(
        (col) => col.field !== 'createdAt' && col.field !== 'updatedAt'
      );
      
      setData(Array.isArray(fetchedData) ? fetchedData : []);
      setColumns(filteredColumns);
      setNewRows([]);
    } catch (err) {
      showMessage(`Could not fetch data for table ${tableName}. Is the backend running?`, 'error');
      setData([]);
      setColumns([]);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [API_BASE_URL]); // dependency on API_BASE_URL

  
  // Load Data when Table Selection Changes
  useEffect(() => {
    if (selectedTable) {
      fetchData(selectedTable);
    }
  }, [selectedTable, fetchData]);


  const handleAddRow = () => {
    const tempId = `temp-${Date.now()}`;
    const newRow = columns.reduce((acc, col) => {
        if (col.field !== pkName) {
            // Initialize based on type
            acc[col.field] = col.type.includes('Int') || col.type.includes('Float') || col.type.includes('Decimal') ? null : 
                             col.type.includes('Boolean') ? false : '';
        }
        return acc;
    }, { [pkName]: tempId, isNew: true });
    setNewRows(prev => [...prev, newRow]);
  };
  
  const handleCellEdit = useCallback((rowIndex, field, value) => {
    const id = rowIndex;
    if (String(id).startsWith('temp-')) {
        setNewRows(prev => prev.map(r => 
            r[pkName] === id ? { ...r, [field]: value } : r
        ));
    } else {
        setEditCache(prev => ({
          ...prev,
          [id]: {
            ...(prev[id] || {}),
            [field]: value
          }
        }));
    }
  }, []);

  const handleSaveCell = async (id, field, value) => {
    if (String(id).startsWith('temp-')) return; 

    const column = columns.find(c => c.field === field);
    if (!column) return;
    const convertedValue = safeTypeConvert(value, column.type);
    
    // Skip save if no change from the last committed value
    const lastCommittedRow = data.find(r => r[pkName] === id);
    if (lastCommittedRow && String(lastCommittedRow[field]) === String(convertedValue) && typeof convertedValue === typeof lastCommittedRow[field]) {
        setEditCache(prev => { const newState = { ...prev }; delete newState[id]; return newState; });
        return;
    }
    
    setLoading(true);
    setEditCache(prev => { const newState = { ...prev }; delete newState[id]; return newState; });

    try {
      const response = await fetch(`${API_BASE_URL}/data/${selectedTable}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: convertedValue }),
      });

      if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(`Failed to update cell: ${errorBody.error || response.statusText}`);
      }
      
      const updatedRow = await response.json();
      setData(prevData => prevData.map(row => 
        row[pkName] === id ? { ...row, ...updatedRow } : row
      ));
      showMessage(`Cell ${field} in row ${id} updated.`, 'success');

    } catch (err) {
      showMessage(`Update failed for row ${id}. Reverting changes. ${err.message}`, 'error');
      await fetchData(selectedTable); 
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleSaveNewRows = async () => {
    if (newRows.length === 0) {
      showMessage('No new rows to save.', 'info');
      return;
    }

    setLoading(true);
    let successCount = 0;
    
    for (const newRow of newRows) {
      const dataToSave = { ...newRow };
      delete dataToSave[pkName];
      delete dataToSave.isNew;

      const finalData = {};
      columns.forEach(col => {
          if (col.field !== pkName && dataToSave[col.field] !== undefined) {
              // Ensure we are passing the converted value, not just the string from the cell
              finalData[col.field] = safeTypeConvert(String(dataToSave[col.field]), col.type);
          }
      });

      try {
        const response = await fetch(`${API_BASE_URL}/data/${selectedTable}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(finalData),
        });

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(`Failed to save row: ${errorBody.error || response.statusText}`);
        }
        successCount++;
      } catch (err) {
        showMessage(`Failed to save one or more rows. ${err.message}`, 'error');
        setLoading(false);
        return; 
      }
    }
    
    if (successCount > 0) {
      showMessage(`${successCount} new row(s) saved successfully. Refreshing data...`, 'success');
    }

    await fetchData(selectedTable);
    setLoading(false);
  };
  
  const handleDeleteRow = async (id) => {
    if (!window.confirm(`Are you sure you want to delete row ${id}?`)) { return; }
    if (String(id).startsWith('temp-')) { setNewRows(prev => prev.filter(row => row[pkName] !== id)); return; }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/data/${selectedTable}/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Failed to delete row: ${response.statusText}`);
      setData(prevData => prevData.filter(row => row[pkName] !== id));
      showMessage(`Row ${id} deleted successfully.`, 'success');
    } catch (err) {
      showMessage(`Deletion failed for row ${id}. ${err.message}`, 'error');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  
  const combinedData = useMemo(() => [...data, ...newRows], [data, newRows]);
  
  const getDisplayValue = useCallback((row, field) => {
    const id = row[pkName];
    if (editCache[id] && editCache[id][field] !== undefined) {
        return editCache[id][field];
    }
    return row[field];
  }, [editCache]);

  const renderTableCell = (row, col) => {
    const field = col.field;
    const isPk = field === pkName;
    const id = row[pkName];
    const isEditable = !isPk;
    const displayValue = String(getDisplayValue(row, field) ?? '');

    return (
      <td 
        key={field} 
        className={`table-cell ${isPk ? 'pk-cell' : ''}`}
      >
        <div
          contentEditable={isEditable}
          suppressContentEditableWarning={true}
          onBlur={(e) => {
            const newValue = e.target.innerText.trim();
            handleCellEdit(id, field, newValue);
            if (!row.isNew) { handleSaveCell(id, field, newValue); }
          }}
          className={`editable-content ${isEditable ? 'editable' : 'not-editable'}`}
          // Use value from cache/data/newRow and display it
          dangerouslySetInnerHTML={{ __html: displayValue }}
        />
      </td>
    );
  };

  const renderTableBody = () => {
    if (combinedData.length === 0 && !loading && selectedTable) {
      return (
        <tr>
          <td colSpan={columns.length + 1} className="empty-state">
            No data found in table "{selectedTable}". Add a new row!
          </td>
        </tr>
      );
    }

    return combinedData.map((row, rowIndex) => (
      <tr 
        key={row[pkName] || rowIndex} 
        className={row.isNew ? 'new-row' : 'data-row'}
      >
        {columns.map(col => renderTableCell(row, col))}
        <td className="table-cell action-cell">
            <button
                onClick={() => handleDeleteRow(row[pkName])}
                className="delete-btn"
                title={`Delete row ${row[pkName]}`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="icon" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 100 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 10-2 0v6a1 1 0 102 0V8z" clipRule="evenodd" />
                </svg>
            </button>
        </td>
      </tr>
    ));
  };

  return (
    <div className="table-editor-container">
      
      <div className="header-group">
          <h2 className="header-title-small">
              Table Editor 
              <span> / {selectedTable || 'Select Table'}</span>
          </h2>
          <div className="select-wrapper">
              <select
                  value={selectedTable}
                  onChange={(e) => setSelectedTable(e.target.value)}
                  className="table-select"
              >
                  <option value="">Select Table</option>
                  {tables.map(table => (
                      <option key={table} value={table}>{table}</option>
                  ))}
              </select>
          </div>
      </div>

      {/* Status Messages */}
      {error && (
          <div className={`message ${error.type}`} role="alert">{error.message}</div>
      )}

      {/* Action Buttons */}
      <div className="action-buttons">
          <button onClick={handleAddRow} className="btn btn-add" disabled={loading || !selectedTable}>
              <svg xmlns="http://www.w3.org/2000/svg" className="icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
               Add Row
          </button>
          <button onClick={handleSaveNewRows} className="btn btn-save" disabled={loading || newRows.length === 0} title={newRows.length > 0 ? `Save ${newRows.length} new row(s)` : "No new rows to save"}>
              {loading && newRows.length > 0 ? 'Saving...' : `Save ${newRows.length} New Row(s)`}
          </button>
      </div>

      {/* Table Container */}
      <div className="table-wrapper">
          {loading && (
              <div className="loading-overlay">
                  <div className="loading-text">
                      <div className="spinner"></div>
                      <span>Loading Data...</span>
                  </div>
              </div>
          )}
          
          <table className="data-table">
              <thead className="table-header">
                  <tr>
                      {columns.map(col => (
                          <th key={col.field}>
                              {col.field}
                              <span className="type-info">({col.type.replace('?', '')})</span>
                          </th>
                      ))}
                      <th className="action-header">Actions</th>
                  </tr>
              </thead>
              <tbody>
                  {renderTableBody()}
              </tbody>
          </table>
      </div>
    </div>
  );
}