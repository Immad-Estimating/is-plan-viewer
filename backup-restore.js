export function installBackupRestore(ctx = {}) {
  const {
    openDB,
    showConfirm = function(_message, onConfirm) { if (typeof onConfirm === 'function') onConfirm(); },
    refreshRoute = function() {}
  } = ctx;

  // =====================================================
  // Backup & Restore (IndexedDB Export/Import)
  // =====================================================
  
  // Helper: convert Blob/ArrayBuffer to base64 string for JSON serialization
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  
  // Helper: convert base64 data URL back to Blob
  function base64ToBlob(dataUrl) {
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  
  // Recursively encode Blobs/ArrayBuffers in a record for JSON export
  async function encodeRecord(record) {
    if (record === null || record === undefined) return record;
    if (record instanceof Blob) {
      return { __type: 'Blob', data: await blobToBase64(record) };
    }
    if (record instanceof ArrayBuffer) {
      const blob = new Blob([record]);
      return { __type: 'Blob', data: await blobToBase64(blob) };
    }
    if (Array.isArray(record)) {
      return Promise.all(record.map(item => encodeRecord(item)));
    }
    if (typeof record === 'object') {
      const encoded = {};
      for (const [key, value] of Object.entries(record)) {
        encoded[key] = await encodeRecord(value);
      }
      return encoded;
    }
    return record;
  }
  
  // Recursively decode base64-encoded Blobs back to Blob objects on import
  function decodeRecord(record) {
    if (record === null || record === undefined) return record;
    if (typeof record === 'object' && record.__type === 'Blob' && record.data) {
      return base64ToBlob(record.data);
    }
    if (Array.isArray(record)) {
      return record.map(item => decodeRecord(item));
    }
    if (typeof record === 'object') {
      const decoded = {};
      for (const [key, value] of Object.entries(record)) {
        decoded[key] = decodeRecord(value);
      }
      return decoded;
    }
    return record;
  }
  
  async function exportBackup() {
    try {
      const db = await openDB();
      if (!db) { alert('⚠️ Database not available. Try reloading the page.'); return; }
      const storeNames = Array.from(db.objectStoreNames);
      const backup = {
        exportDate: new Date().toISOString(),
        version: '2.0',
        appVersion: 'ISPlanViewer',
        stores: {}
      };
      let totalRecords = 0;
      let pdfCount = 0;
      for (const name of storeNames) {
        const tx = db.transaction(name, 'readonly');
        const store = tx.objectStore(name);
        const data = await new Promise((res, rej) => {
          const req = store.getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        // Encode each record (converts Blobs to base64)
        const encoded = [];
        for (const record of data) {
          if (record && record.pdfBlob) pdfCount++;
          encoded.push(await encodeRecord(record));
        }
        backup.stores[name] = encoded;
        totalRecords += data.length;
      }
      const jsonStr = JSON.stringify(backup);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `is-plan-viewer-backup-${dateStr}.json`;
      // Try showSaveFilePicker (lets user choose location)
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'JSON Backup', accept: { 'application/json': ['.json'] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
          alert(`✅ Backup saved successfully!\n\n📁 ${handle.name}\n📊 ${totalRecords.toLocaleString()} records (${pdfCount} PDFs included)\n💾 File size: ${sizeMB} MB`);
          return;
        } catch (pickerErr) {
          if (pickerErr.name === 'AbortError') return;
        }
      }
      // Legacy fallback
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(a.href);
      const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
      alert(`✅ Backup downloaded!\n\n📁 File: ${fileName}\n📍 Location: Your browser's Downloads folder\n📊 ${totalRecords.toLocaleString()} records (${pdfCount} PDFs included)\n💾 File size: ${sizeMB} MB`);
    } catch (err) {
      console.error('[Backup] Export failed:', err);
      alert('⚠️ Backup failed. Open DevTools (F12) → Console for details.');
    }
  }
  
  async function importBackup(event) {
    const file = event.target.files[0];
    event.target.value = ''; // reset so same file can be re-selected
    if (!file) return;
    try {
      const text = await file.text();
      let backup;
      try {
        backup = JSON.parse(text);
      } catch (e) {
        alert('⚠️ Invalid file - not valid JSON');
        return;
      }
      if (!backup.stores || typeof backup.stores !== 'object') {
        alert('⚠️ Invalid backup file - missing data stores');
        return;
      }
      const storeNames = Object.keys(backup.stores);
      let totalRecords = 0;
      let pdfCount = 0;
      for (const name of storeNames) {
        const records = backup.stores[name] || [];
        totalRecords += records.length;
        if (name === 'drawings') pdfCount = records.filter(r => r && r.pdfBlob).length;
      }
      const dateLabel = backup.exportDate ? new Date(backup.exportDate).toLocaleDateString() : 'unknown date';
      const version = backup.version || '1.0';
      showConfirm(
        `This will replace ALL existing takeoff data with the backup from ${dateLabel} (${totalRecords.toLocaleString()} records, ${pdfCount} PDFs). This cannot be undone. Continue?`,
        async () => {
          try {
            const db = await openDB();
            if (!db) { alert('⚠️ Database not available'); return; }
            const validStores = storeNames.filter(n => db.objectStoreNames.contains(n));
            const skippedStores = storeNames.filter(n => !db.objectStoreNames.contains(n));
            let restoredCount = 0;
            for (const name of validStores) {
              const rawRecords = backup.stores[name] || [];
              // Decode base64-encoded Blobs back to real Blobs (v2.0 format)
              const records = rawRecords.map(r => decodeRecord(r));
              const tx = db.transaction(name, 'readwrite');
              const store = tx.objectStore(name);
              store.clear();
              for (const record of records) {
                store.put(record);
              }
              await new Promise((res, rej) => {
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
              });
              restoredCount += records.length;
            }
            let msg = `✅ Restore complete!\n\n📊 ${restoredCount.toLocaleString()} records across ${validStores.length} stores`;
            if (pdfCount > 0) msg += `\n📄 ${pdfCount} PDF drawings restored`;
            if (skippedStores.length > 0) msg += `\n⚠️ Skipped ${skippedStores.length} unknown stores`;
            alert(msg);
            // Refresh the dashboard to reflect restored data
            if (typeof refreshRoute === 'function') refreshRoute();
          } catch (err) {
            console.error('[Backup] Import failed:', err);
            alert('⚠️ Restore failed. Open DevTools (F12) → Console for details.');
          }
        }
      );
    } catch (err) {
      console.error('[Backup] File read failed:', err);
      alert('⚠️ Could not read file');
    }
  }
  


  window.exportBackup = exportBackup;
  window.importBackup = importBackup;

  return {
    exportBackup,
    importBackup
  };
}
