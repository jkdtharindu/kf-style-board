import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle, Image as ImageIcon, LayoutGrid, Send, Shield, List, Loader, Database, Save, AlertCircle, Download, Sparkles, EyeOff, SearchCheck, FileSpreadsheet, Edit3, Trash2, Plus, FileText, Link as LinkIcon, ArrowRight } from 'lucide-react';

// Firebase imports
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- 1. SAFE FIREBASE SETUP ---
let app, auth, db;
let isFirebaseActive = false;
let appId = 'default-app-id';

const apiKey = ""; // Injected automatically by the environment

const callGeminiAPI = async (prompt, systemInstruction = "") => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };

  const delays = [1000, 2000, 4000, 8000, 16000];
  for (let i = 0; i <= delays.length; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      return result.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
    } catch (error) {
      if (i === delays.length) return "Sorry, could not generate insights at this time. Please try again.";
      await new Promise(res => setTimeout(res, delays[i]));
    }
  }
};

try {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    const config = JSON.parse(__firebase_config);
    if (Object.keys(config).length > 0) {
      app = initializeApp(config);
      auth = getAuth(app);
      db = getFirestore(app);
      appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      isFirebaseActive = true;
    }
  }
} catch (error) {
  console.warn("Running in local demo mode. Firebase not initialized.");
}

const DEFAULT_CATALOGS = [
  {
    id: "demo-file-1",
    name: "KF 80Days Demo",
    items: [
      { code: "0102042321306", name: "BUTTON FLY SKINNY JEAN-23213006", price: "8990.0", qty: "600.0", category: "DENIM", image: "" },
      { code: "0102022520550", name: "COUTURE CURVE DENIM DRESS-25205500", price: "10900.0", qty: "527.0", category: "DENIM DRESSES", image: "" }
    ]
  }
];

function parseCSV(str) {
  const arr = [];
  let quote = false;
  let col = 0, row = 0;
  for (let c = 0; c < str.length; c++) {
    let cc = str[c], nc = str[c+1];
    arr[row] = arr[row] || [];
    arr[row][col] = arr[row][col] || '';
    if (cc === '"' && quote && nc === '"') { arr[row][col] += cc; ++c; continue; }
    if (cc === '"') { quote = !quote; continue; }
    if (cc === ',' && !quote) { ++col; continue; }
    if (cc === '\r' && nc === '\n' && !quote) { ++row; col = 0; ++c; continue; }
    if (cc === '\n' && !quote) { ++row; col = 0; continue; }
    if (cc === '\r' && !quote) { ++row; col = 0; continue; }
    arr[row][col] += cc;
  }
  return arr;
}

export default function App() {
  const [user, setUser] = useState(null);
  const fileInputRef = useRef(null);
  
  // Navigation States
  const [viewMode, setViewMode] = useState('browse'); 
  const [adminTab, setAdminTab] = useState('selections'); 
  
  // Data States
  const [catalogs, setCatalogs] = useState(DEFAULT_CATALOGS); 
  const [selectedCodes, setSelectedCodes] = useState(new Set());
  const [adminSelections, setAdminSelections] = useState([]);
  
  const [baseImageUrl, setBaseImageUrl] = useState(''); // GitHub Folder URL
  const [imageExtension, setImageExtension] = useState('.jpg'); // .jpg or .png
  
  // UI & Upload States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [previewData, setPreviewData] = useState(null); 

  // AI States
  const [aiInsights, setAiInsights] = useState('');
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

  // --- HELPER: Resolve Image URL ---
  const getImageUrl = (item) => {
    if (item.image && item.image.trim() !== '') return item.image.trim();
    
    if (baseImageUrl && baseImageUrl.trim() !== '') {
      const cleanBase = baseImageUrl.trim().replace(/\/$/, ''); // Remove trailing slash
      const ext = imageExtension || '.jpg';
      return `${cleanBase}/${item.code}${ext}`;
    }
    return '';
  };

  // --- 2. AUTHENTICATION ---
  useEffect(() => {
    if (!isFirebaseActive) {
      setUser({ uid: 'local-demo-user' });
      return;
    }
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) { console.error("Auth Error:", error); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- 3. DATA FETCHING ---
  useEffect(() => {
    if (!user || !isFirebaseActive) return;

    const catalogRef = doc(db, 'artifacts', appId, 'public', 'data', 'catalog', 'latest');
    const unsubCatalog = onSnapshot(catalogRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.files) setCatalogs(data.files);
        if (data.baseImageUrl !== undefined) setBaseImageUrl(data.baseImageUrl);
        if (data.imageExtension !== undefined) setImageExtension(data.imageExtension);
      }
    }, (error) => console.error("Catalog error:", error));

    const selectionRef = doc(db, 'artifacts', appId, 'public', 'data', 'md_selections', 'latest_selection');
    const unsubSelections = onSnapshot(selectionRef, (docSnap) => {
      if (docSnap.exists()) setAdminSelections(docSnap.data().selectedCodes || []);
      else setAdminSelections([]);
    }, (error) => console.error("Selection error:", error));

    return () => { unsubCatalog(); unsubSelections(); };
  }, [user]);

  // --- 4. APP LOGIC ---
  const toggleSelection = (code) => {
    if (viewMode === 'admin') return; 
    setSelectedCodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(code)) newSet.delete(code);
      else newSet.add(code);
      return newSet;
    });
  };

  const submitSelection = async () => {
    setIsSubmitting(true);
    if (isFirebaseActive && user) {
      try {
        const selectionRef = doc(db, 'artifacts', appId, 'public', 'data', 'md_selections', 'latest_selection');
        await setDoc(selectionRef, {
          selectedCodes: Array.from(selectedCodes),
          updatedAt: new Date().toISOString(),
          submittedBy: user.uid
        });
      } catch (error) { console.error("Error saving selection:", error); }
    } else {
      await new Promise(resolve => setTimeout(resolve, 800));
      setAdminSelections(Array.from(selectedCodes));
    }
    setIsSubmitting(false);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 5000);
  };

  const sendWhatsAppNotification = () => {
    const text = `Hi, I have finalized the stock selection on the KF Style Board.\n\nTotal Approved Styles: ${selectedCodes.size}\nCodes: ${Array.from(selectedCodes).join(', ')}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const saveBaseImageUrl = async () => {
    setIsSavingUrl(true);
    try {
      let finalUrl = baseImageUrl.trim();
      
      // Auto-convert standard GitHub links and .git links to RAW links
      if (finalUrl.includes('github.com') && !finalUrl.includes('raw.githubusercontent.com')) {
        finalUrl = finalUrl.replace(/\.git$/, ''); // Remove .git at the end
        try {
          const urlObj = new URL(finalUrl);
          const pathParts = urlObj.pathname.split('/').filter(Boolean);
          if (pathParts.length >= 2) {
            const user = pathParts[0];
            const repo = pathParts[1];
            // Convert to the raw content domain targeting the 'main' branch
            finalUrl = `https://raw.githubusercontent.com/${user}/${repo}/main`;
          }
        } catch (e) {
          console.error("Invalid URL format");
        }
      }

      // Ensure no trailing slash for clean storage
      finalUrl = finalUrl.replace(/\/$/, '');
      setBaseImageUrl(finalUrl); // Update the input box to show the corrected URL

      if (isFirebaseActive && user) {
        const catalogRef = doc(db, 'artifacts', appId, 'public', 'data', 'catalog', 'latest');
        await setDoc(catalogRef, { baseImageUrl: finalUrl, imageExtension, updatedAt: new Date().toISOString() }, { merge: true });
      }
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      setJsonError("Failed to save Image URL.");
    } finally {
      setIsSavingUrl(false);
    }
  };

  const handleFileUpload = (e) => {
    if (!uploadFileName.trim()) {
      setJsonError("Please enter a 'File Name' (e.g., KF 80Days) before selecting a file.");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      try {
        const rows = parseCSV(text);
        if (rows.length < 2) throw new Error("CSV is empty or missing data rows.");

        const headers = rows[0].map(h => h.trim().toLowerCase());
        const getIdx = (keywords) => headers.findIndex(h => keywords.some(k => h.includes(k)));

        const idxCode = getIdx(['product code', 'code']);
        const idxImage = getIdx(['product image', 'image', 'url']);
        const idxName = getIdx(['product name', 'name', 'title']);
        const idxCat = getIdx(['category', 'sub category']);
        const idxPrice = getIdx(['sellingprice', 'price', 'selling price']);
        const idxQty = getIdx(['qty', 'quantity', 'stock']);

        if (idxCode === -1) throw new Error("Could not find a 'Product Code' column in the uploaded CSV.");

        const parsedItems = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length === 1 && !row[0]) continue; 
          if (!row[idxCode]) continue; 

          parsedItems.push({
            code: row[idxCode]?.trim() || "",
            image: idxImage !== -1 ? row[idxImage]?.trim() || "" : "",
            name: idxName !== -1 ? row[idxName]?.trim() || "" : "",
            category: idxCat !== -1 ? row[idxCat]?.trim() || "" : "",
            price: idxPrice !== -1 ? row[idxPrice]?.trim() || "" : "",
            qty: idxQty !== -1 ? row[idxQty]?.trim() || "" : ""
          });
        }

        setPreviewData(parsedItems);
        setJsonError('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (err) {
        setJsonError(err.message || "Error parsing CSV file.");
        setPreviewData(null);
      }
    };
    reader.readAsText(file);
  };

  const updatePreviewImage = (index) => {
    const newImageUrl = prompt("Paste the image URL for this product:");
    if (newImageUrl !== null && newImageUrl.trim() !== "") {
      const updatedData = [...previewData];
      updatedData[index].image = newImageUrl.trim();
      setPreviewData(updatedData);
    }
  };

  const saveNewCatalogFile = async () => {
    if (!previewData || !uploadFileName.trim()) return;
    setIsSubmitting(true);
    
    try {
      const newFile = {
        id: "file-" + Date.now().toString(),
        name: uploadFileName.trim(),
        items: previewData
      };
      const updatedCatalogs = [...catalogs, newFile];

      if (isFirebaseActive && user) {
        const catalogRef = doc(db, 'artifacts', appId, 'public', 'data', 'catalog', 'latest');
        await setDoc(catalogRef, { files: updatedCatalogs, updatedAt: new Date().toISOString() }, { merge: true });
      } else {
        await new Promise(resolve => setTimeout(resolve, 500));
        setCatalogs(updatedCatalogs);
      }
      
      setShowSuccess(true);
      setPreviewData(null); 
      setUploadFileName(''); 
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      setJsonError(error.message || "Failed to save data.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteCatalogFile = async (fileIdToDelete) => {
    if (!window.confirm("Are you sure you want to delete this entire file?")) return;
    try {
      const updatedCatalogs = catalogs.filter(c => c.id !== fileIdToDelete);
      if (isFirebaseActive && user) {
        const catalogRef = doc(db, 'artifacts', appId, 'public', 'data', 'catalog', 'latest');
        await setDoc(catalogRef, { files: updatedCatalogs, updatedAt: new Date().toISOString() }, { merge: true });
      } else {
        setCatalogs(updatedCatalogs);
      }
    } catch (error) { console.error("Error deleting file:", error); }
  };

  const downloadSelectionsCSV = (file) => {
    const selectedItems = file.items.filter(item => adminSelections.includes(item.code));
    if (selectedItems.length === 0) return;

    const headers = ['Product Code', 'Product Image (URL)', 'Product Name', 'Category', 'SellingPrice', 'Qty'];
    
    const rows = selectedItems.map(item => {
      const finalImageUrl = getImageUrl(item);
      return [
        `"${item.code}"`,
        `"${finalImageUrl}"`,
        `"${item.name || ''}"`,
        `"${item.category || ''}"`,
        `"${item.price || ''}"`,
        `"${item.qty || ''}"`
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const safeFileName = file.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.setAttribute('download', `KF_Approved_${safeFileName}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGenerateInsights = async () => {
    const allSelectedItems = catalogs.flatMap(file => 
      file.items.filter(item => adminSelections.includes(item.code))
    );
    if (allSelectedItems.length === 0) return;
    setIsGeneratingInsights(true);
    setAiInsights('');
    const itemsList = allSelectedItems.map(i => `- ${i.name} (${i.category}) - Rs. ${i.price}`).join("\n");
    const prompt = `Here is a list of Kelly Felder clothing items the Managing Director just approved for our new stock drop:\n\n${itemsList}\n\nPlease provide:\n1. A one-sentence theme or vibe for this collection based on these items.\n2. A short, trendy social media caption (with emojis) to tease or promote this upcoming drop. Keep it engaging, premium, and fashion-forward.`;
    const system = "You are an expert fashion marketer and copywriter for Kelly Felder, a trendy women's fashion brand.";
    const result = await callGeminiAPI(prompt, system);
    setAiInsights(result);
    setIsGeneratingInsights(false);
  };

  const isSelected = (code) => viewMode !== 'admin' ? selectedCodes.has(code) : adminSelections.includes(code);

  const renderProductGrid = (itemsToRender, emptyMessage) => {
    if (itemsToRender.length === 0) {
      return (
        <div className="text-center py-8 px-4 bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-500 text-sm">{emptyMessage || "No items to display"}</p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 animate-in fade-in duration-300">
        {itemsToRender.map((product) => {
          const selected = isSelected(product.code);
          const finalImageSrc = getImageUrl(product);
          
          return (
            <div 
              key={product.code}
              onClick={() => toggleSelection(product.code)}
              className={`
                relative bg-white rounded-2xl overflow-hidden transition-all duration-200
                ${viewMode !== 'admin' ? 'cursor-pointer active:scale-95' : 'cursor-default'}
                ${selected ? 'ring-4 ring-black shadow-md transform -translate-y-1' : 'border border-gray-200 shadow-sm hover:shadow-md'}
              `}
            >
              {selected && (
                <div className="absolute top-2 right-2 z-20 bg-black rounded-full p-0.5 shadow-sm animate-in zoom-in duration-200">
                  <CheckCircle className="w-5 h-5 text-white" />
                </div>
              )}

              <div className="aspect-[3/4] bg-gray-50 flex flex-col items-center justify-center text-center relative overflow-hidden group">
                {finalImageSrc ? (
                  <img 
                    src={finalImageSrc} 
                    alt={product.name} 
                    className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 ${viewMode !== 'admin' ? 'group-hover:scale-105' : ''}`}
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                  />
                ) : null}
                
                {/* Fallback if image fails or doesn't exist */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-50 z-0" style={{ display: finalImageSrc ? 'none' : 'flex' }}>
                   <ImageIcon className="w-8 h-8 mb-1" />
                   <span className="text-[10px]">No Image</span>
                </div>
                
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 w-11/12 text-center">
                  <span className="text-[10px] font-mono font-bold text-gray-800 bg-white/95 backdrop-blur-sm px-2 py-1 rounded shadow-sm inline-block max-w-full truncate">
                    {product.code}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-white">
                <p className="text-[10px] text-gray-500 mb-1 font-bold uppercase tracking-wider truncate">{product.category || 'CATEGORY'}</p>
                <h3 className="text-sm font-bold text-gray-900 leading-tight mb-3 line-clamp-2" title={product.name}>{product.name}</h3>
                
                <div className="flex items-end justify-between mt-auto">
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Price</p>
                    <p className="text-sm font-bold text-gray-900">Rs. {product.price}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Stock</p>
                    <p className="text-xs font-semibold text-gray-700">{product.qty}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-32">
      <header className="bg-white shadow-sm sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-black text-white p-1.5 rounded-md">
              <LayoutGrid className="w-5 h-5" />
            </div>
            <h1 className="font-extrabold text-gray-900 text-lg tracking-tight hidden sm:block">KF Style Board</h1>
            <h1 className="font-extrabold text-gray-900 text-lg tracking-tight sm:hidden">KF</h1>
          </div>
          
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button onClick={() => setViewMode('browse')} className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-md transition-all flex items-center gap-1.5 ${viewMode === 'browse' ? 'bg-white shadow-sm text-black' : 'text-gray-500'}`}>
              <LayoutGrid className="w-4 h-4" /> <span className="hidden sm:inline">Browse</span>
            </button>
            <button onClick={() => setViewMode('review')} className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-md transition-all flex items-center gap-1.5 ${viewMode === 'review' ? 'bg-white shadow-sm text-black' : 'text-gray-500'}`}>
              <CheckCircle className="w-4 h-4" /> 
              <span className="hidden sm:inline">Review</span>
              {selectedCodes.size > 0 && <span className="bg-black text-white text-[10px] px-1.5 py-0.5 rounded-full ml-1">{selectedCodes.size}</span>}
            </button>
            <button onClick={() => setViewMode('admin')} className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-md transition-all flex items-center gap-1.5 ${viewMode === 'admin' ? 'bg-white shadow-sm text-purple-600' : 'text-gray-500'}`}>
              <Shield className="w-4 h-4" /> Admin
            </button>
          </div>
        </div>
        
        {viewMode === 'admin' && (
          <div className="bg-purple-50 border-b border-purple-100 px-4 py-2 flex justify-center gap-4">
            <button onClick={() => setAdminTab('selections')} className={`text-sm font-semibold px-4 py-1.5 rounded-full transition-all ${adminTab === 'selections' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-600 hover:bg-purple-100'}`}>
              MD Final Select
            </button>
            <button onClick={() => setAdminTab('catalog')} className={`text-sm font-semibold px-4 py-1.5 rounded-full transition-all ${adminTab === 'catalog' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-600 hover:bg-purple-100'}`}>
              Manage Catalog Files
            </button>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto p-4">
        {viewMode === 'browse' && (
          <>
            <div className="mb-6 bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Suggested Styles</h2>
                <p className="text-gray-500 text-sm">Select the items you want to approve for the upcoming drop.</p>
              </div>
              <div className="bg-gray-100 px-3 py-2 rounded-lg flex items-center gap-2 max-w-sm">
                <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <p className="text-xs text-gray-700 font-medium truncate">
                  Selected files: {catalogs.length > 0 ? catalogs.map(c => c.name).join(' / ') : 'None'}
                </p>
              </div>
            </div>
            {catalogs.map(file => (
              <div key={file.id} className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-lg font-black text-gray-800 uppercase tracking-tight">{file.name}</h3>
                  <span className="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-bold">{file.items.length} styles</span>
                </div>
                {renderProductGrid(file.items, `No items found in ${file.name}`)}
              </div>
            ))}
          </>
        )}

        {viewMode === 'review' && (
          <div className="animate-in fade-in duration-300">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-900">Your Selection</h2>
              <p className="text-gray-500 text-sm">Review your chosen styles before confirming.</p>
            </div>
            {catalogs.map(file => {
              const selectedInThisFile = file.items.filter(item => selectedCodes.has(item.code));
              if (selectedInThisFile.length === 0) return null;
              return (
                <div key={file.id} className="mb-10">
                  <div className="flex items-center gap-2 mb-4 border-b border-gray-200 pb-2">
                    <h3 className="text-md font-bold text-gray-700">{file.name}</h3>
                    <span className="text-[10px] bg-black text-white px-2 py-0.5 rounded-full font-bold">{selectedInThisFile.length} selected</span>
                  </div>
                  {renderProductGrid(selectedInThisFile, '')}
                </div>
              );
            })}
          </div>
        )}

        {viewMode === 'admin' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {adminTab === 'selections' && (
              <>
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 mb-6 shadow-sm">
                  <div className="flex items-start gap-3 mb-4">
                    <Shield className="w-5 h-5 text-purple-600 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-purple-900 text-sm">MD's Live Selection Dashboard</h3>
                      <p className="text-purple-700 text-xs mt-1">Total Approved Across All Files: <strong>{adminSelections.length}</strong> styles.</p>
                    </div>
                  </div>
                  {adminSelections.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-purple-200">
                      <button onClick={handleGenerateInsights} disabled={isGeneratingInsights} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-sm disabled:opacity-50">
                        {isGeneratingInsights ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        Generate AI Copy
                      </button>
                      <div className="h-6 w-px bg-purple-200 hidden sm:block"></div>
                      {catalogs.map(file => {
                        const count = file.items.filter(item => adminSelections.includes(item.code)).length;
                        if (count === 0) return null;
                        return (
                          <button key={`dl-${file.id}`} onClick={() => downloadSelectionsCSV(file)} className="bg-purple-600 text-white px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-purple-700 shadow-sm transition-colors">
                            <Download className="w-3.5 h-3.5" /> {file.name} ({count})
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {aiInsights && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mb-6 shadow-sm animate-in fade-in duration-500">
                    <div className="text-sm text-indigo-900 whitespace-pre-wrap leading-relaxed">{aiInsights}</div>
                  </div>
                )}
                {catalogs.map(file => {
                  const selectedInThisFile = file.items.filter(item => adminSelections.includes(item.code));
                  if (selectedInThisFile.length === 0) return null;
                  return (
                    <div key={`admin-grid-${file.id}`} className="mb-10">
                      <div className="flex items-center gap-2 mb-4 border-b border-gray-200 pb-2">
                        <h3 className="text-md font-bold text-gray-700">{file.name}</h3>
                        <span className="text-[10px] bg-purple-100 text-purple-800 border border-purple-200 px-2 py-0.5 rounded-full font-bold">{selectedInThisFile.length} approved</span>
                      </div>
                      {renderProductGrid(selectedInThisFile, '')}
                    </div>
                  );
                })}
              </>
            )}

            {adminTab === 'catalog' && (
              <div className="space-y-6">
                
                {/* --- UPDATED: AUTOMATED GITHUB IMAGE SETTINGS --- */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                  <div className="flex items-center gap-2 text-gray-900 mb-2">
                    <LinkIcon className="w-5 h-5 text-blue-600" />
                    <h2 className="font-bold text-lg">Automated Image Folder (GitHub)</h2>
                  </div>
                  <p className="text-sm text-gray-600 mb-4">
                    Skip pasting individual links! The app will construct links combining this Base URL + The Style Code + The File Extension.
                  </p>
                  
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input 
                      type="text" 
                      value={baseImageUrl}
                      onChange={(e) => setBaseImageUrl(e.target.value)}
                      placeholder="e.g., https://raw.githubusercontent.com/YourName/Repo/main/"
                      className="flex-1 p-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    <select
                      value={imageExtension}
                      onChange={(e) => setImageExtension(e.target.value)}
                      className="p-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value=".jpg">.jpg</option>
                      <option value=".png">.png</option>
                      <option value=".jpeg">.jpeg</option>
                    </select>
                    <button 
                      onClick={saveBaseImageUrl}
                      disabled={isSavingUrl}
                      className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                    >
                      {isSavingUrl ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save Link
                    </button>
                  </div>
                  
                  {/* Smart GitHub Link Helper */}
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
                    <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-800">
                      <strong>Smart GitHub Detection:</strong> You can safely paste your main repository link (e.g., <code>https://github.com/jkdtharindu/KF-Stock-Images.git</code>). The app will automatically convert it into the correct format to display the images when you click Save!
                    </p>
                  </div>
                </div>

                {/* List of currently uploaded files */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                  <div className="flex items-center gap-2 text-gray-900 mb-4">
                    <Database className="w-5 h-5 text-purple-600" />
                    <h2 className="font-bold text-lg">Currently Uploaded Files</h2>
                  </div>
                  {catalogs.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">No files uploaded yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {catalogs.map((file) => (
                        <div key={file.id} className="flex items-center justify-between bg-gray-50 border border-gray-200 p-3 rounded-lg">
                          <div>
                            <p className="font-bold text-gray-800 flex items-center gap-2">
                              <FileText className="w-4 h-4 text-gray-400" /> {file.name}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5 ml-6">{file.items.length} styles inside</p>
                          </div>
                          <button onClick={() => deleteCatalogFile(file.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-md transition-colors" title="Delete this file entirely">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* File Upload Zone */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                  <div className="flex items-center gap-2 text-gray-900 mb-4">
                    <Plus className="w-5 h-5 text-purple-600" />
                    <h2 className="font-bold text-lg">Upload New File</h2>
                  </div>

                  {!previewData ? (
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-5">
                      <div className="mb-4">
                        <label className="block text-sm font-bold text-purple-900 mb-1">1. Enter File Name</label>
                        <input type="text" value={uploadFileName} onChange={(e) => setUploadFileName(e.target.value)} placeholder="e.g., KF 80Days, Summer Drop..." className="w-full md:w-1/2 p-2.5 rounded-lg border border-purple-200 outline-none focus:ring-2 focus:ring-purple-500"/>
                      </div>
                      <div className="mb-2">
                        <label className="block text-sm font-bold text-purple-900 mb-1">2. Upload CSV File</label>
                        <div className="border-2 border-dashed border-purple-300 bg-white rounded-xl p-6 text-center hover:bg-purple-100 transition-colors">
                          <input type="file" accept=".csv" className="hidden" id="csv-upload" ref={fileInputRef} onChange={handleFileUpload} />
                          <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center">
                            <div className="bg-purple-100 p-3 rounded-full mb-3"><FileSpreadsheet className="w-6 h-6 text-purple-600" /></div>
                            <span className="font-bold text-purple-900">Click to Select CSV File</span>
                            <span className="text-xs text-purple-600 mt-1 max-w-sm">Saved as "CSV (Comma delimited)" from Excel.</span>
                          </label>
                        </div>
                      </div>
                      {jsonError && (
                        <div className="mt-3 text-red-600 text-sm flex items-center gap-2 bg-red-50 p-2 rounded-md">
                          <AlertCircle className="w-4 h-4" /> {jsonError}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="animate-in fade-in duration-500 bg-white border border-green-200 rounded-xl p-5">
                      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 gap-4">
                        <div>
                          <div className="flex items-center gap-2 text-green-700">
                            <SearchCheck className="w-5 h-5" />
                            <h3 className="font-bold text-lg">Previewing: {uploadFileName}</h3>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {previewData.length} items loaded. If you set up an Automated Image Folder, they will link automatically below.
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-2 w-full md:w-auto">
                          <button onClick={() => { setPreviewData(null); setUploadFileName(''); }} className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-300 transition-colors">Cancel</button>
                          <button onClick={saveNewCatalogFile} disabled={isSubmitting} className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 flex items-center justify-center gap-2 transition-colors">
                            {isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save & Add File
                          </button>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 max-h-[500px] overflow-y-auto p-1 bg-gray-50 rounded-lg border border-gray-200">
                        {previewData.map((item, idx) => {
                          const previewImageSrc = getImageUrl(item);
                          return (
                            <div key={idx} className="border border-gray-200 rounded-lg p-2 bg-white shadow-sm flex flex-col items-center group">
                              <div className="w-full aspect-[3/4] bg-gray-50 rounded-md overflow-hidden mb-2 relative">
                                {previewImageSrc ? (
                                   <img src={previewImageSrc} alt={item.code} className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                                ) : null}
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-50 z-0" style={{ display: previewImageSrc ? 'none' : 'flex' }}>
                                   <ImageIcon className="w-8 h-8 mb-1" />
                                   <span className="text-[10px]">No Image</span>
                                </div>
                              </div>
                              <span className="text-[10px] font-mono font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded truncate w-full text-center" title={item.code}>{item.code || 'NO CODE'}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {showSuccess && !isSavingUrl && (
                    <div className="mt-4 text-green-600 text-sm flex items-center gap-2 font-medium bg-green-50 p-3 rounded-lg border border-green-200">
                      <CheckCircle className="w-5 h-5" /> Saved successfully!
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Floating Action Bars */}
      {viewMode === 'browse' && selectedCodes.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 z-40 animate-in slide-in-from-bottom-full duration-300">
          <div className="max-w-md mx-auto">
            <button onClick={() => setViewMode('review')} className="w-full bg-black text-white px-6 py-4 rounded-2xl font-bold flex items-center justify-between shadow-xl shadow-gray-300 hover:scale-[1.02] transition-transform">
              <div className="flex items-center gap-3">
                <div className="bg-white text-black px-2 py-1 rounded-md text-xs">{selectedCodes.size}</div>
                <span>Review Selection</span>
              </div>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {viewMode === 'review' && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.05)] z-40 animate-in slide-in-from-bottom-full duration-300">
          <div className="max-w-5xl mx-auto">
            {showSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in slide-in-from-bottom-2">
                <div className="flex items-center gap-2 text-green-700 font-medium text-sm">
                  <CheckCircle className="w-5 h-5" /> Selection saved successfully!
                </div>
                <button onClick={sendWhatsAppNotification} className="bg-[#25D366] text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#1ebd5a] transition-colors shadow-sm">
                  <Send className="w-4 h-4" /> Notify Admin via WhatsApp
                </button>
              </div>
            )}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-4">
                <p className="text-sm text-gray-500 font-medium">Final Styles</p>
                <p className="text-2xl font-black text-gray-900">{selectedCodes.size}</p>
              </div>
              <button onClick={submitSelection} disabled={selectedCodes.size === 0 || isSubmitting} className={`w-full sm:w-auto px-8 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${selectedCodes.size > 0 && !isSubmitting ? 'bg-black text-white shadow-lg hover:bg-gray-800 active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                {isSubmitting ? <><Loader className="w-5 h-5 animate-spin" /> Saving...</> : <><CheckCircle className="w-5 h-5" /> Confirm & Submit</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}