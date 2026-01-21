
import React, { useState, useRef } from 'react';
import { 
  Box, Sparkles, ChevronRight, Loader2, 
  AlertCircle, Layout, Tv, Book, Archive, MessageSquare, 
  Download, Printer, Maximize2, MapPin, ChevronLeft, RefreshCw, X,
  FileText, UploadCloud, Ruler, ShieldAlert, Trash2, Info
} from 'lucide-react';
import { UserInputs, AIResponse, ProductType, DesignProposal } from './types';
import { generateFurnitureProposals, refineSpecificProposal, visualizeProposal } from './geminiService';

type Step = 'upload' | 'scale' | 'dimensions' | 'placement' | 'product' | 'description' | 'processing' | 'results' | 'selected' | 'report';
type InteractionMode = 'placement' | 'exclusion';

const productTypes: { type: ProductType; label: string; icon: any; desc: string }[] = [
  { type: 'Wardrobe', label: 'Garderobe', icon: Archive, desc: 'Plassbygd oppbevaring' },
  { type: 'TV Bench', label: 'TV-benk', icon: Tv, desc: 'Medie-møbler og skjenk' },
  { type: 'Bookcase', label: 'Bokhylle', icon: Book, desc: 'Skreddersydd for din vegg' },
  { type: 'Sideboard', label: 'Skjenk', icon: Layout, desc: 'Lekkert side-møbel' },
];

export default function App() {
  const [step, setStep] = useState<Step>('upload');
  const [mode, setMode] = useState<InteractionMode>('placement');
  const [inputs, setInputs] = useState<UserInputs>({
    image: null,
    width: '',
    height: '',
    depth: '',
    constraints_text: '',
    productType: null,
    description: '',
    exclusion_points: [],
  });
  const [results, setResults] = useState<AIResponse | null>(null);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState<string | null>(null); 
  const [renderProgress, setRenderProgress] = useState<{current: number, total: number} | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [scaleDrawing, setScaleDrawing] = useState<{p1?: {x: number, y: number}, p2?: {x: number, y: number}, tempLength?: string}>({});
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [variantErrors, setVariantErrors] = useState<Record<string, string>>({});
  
  const imageRef = useRef<HTMLImageElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setInputs(prev => ({ ...prev, image: reader.result as string }));
        setStep('scale');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleScaleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    if (!scaleDrawing.p1) setScaleDrawing({ ...scaleDrawing, p1: { x, y } });
    else if (!scaleDrawing.p2) setScaleDrawing({ ...scaleDrawing, p2: { x, y } });
    else setScaleDrawing({ p1: { x, y } });
  };

  const finalizeScale = () => {
    if (scaleDrawing.p1 && scaleDrawing.p2 && scaleDrawing.tempLength) {
      setInputs(prev => ({
        ...prev,
        scale_reference: {
          p1: scaleDrawing.p1!,
          p2: scaleDrawing.p2!,
          length_mm: parseInt(scaleDrawing.tempLength!)
        }
      }));
    }
    setStep('dimensions');
  };

  const handleImageInteraction = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    if (mode === 'placement') {
      setInputs(prev => ({ ...prev, placement_point: { x, y } }));
    } else {
      setInputs(prev => ({ ...prev, exclusion_points: [...prev.exclusion_points, { x, y }] }));
    }
  };

  const removeExclusion = (index: number) => {
    setInputs(prev => ({
      ...prev,
      exclusion_points: prev.exclusion_points.filter((_, i) => i !== index)
    }));
  };

  const clearAllPoints = () => {
    setInputs(prev => ({ ...prev, placement_point: undefined, exclusion_points: [] }));
  };

  const handleGenerate = async () => {
    setStep('processing');
    setError(null);
    setVariantErrors({});
    try {
      const data = await generateFurnitureProposals(inputs);
      setResults(data);
      setStep('results');
      
      const total = data.design_proposals.length;
      let completedCount = 0;
      setRenderProgress({ current: 0, total });

      for (const proposal of data.design_proposals) {
        await generateSingleImage(proposal.id, proposal);
        completedCount++;
        setRenderProgress({ current: completedCount, total });
      }
      setRenderProgress(null);
    } catch (err: any) {
      setError(err.message || "Tjenesten er utilgjengelig. Sjekk API-nøkkel.");
      setStep('description');
    }
  };

  const generateSingleImage = async (proposalId: string, proposal: DesignProposal) => {
    try {
      const visual = await visualizeProposal(inputs.image!, proposal, inputs);
      setResults(prev => {
        if (!prev) return null;
        return {
          ...prev,
          design_proposals: prev.design_proposals.map(p => 
            p.id === proposalId ? { ...p, visual_image: visual } : p
          )
        };
      });
    } catch (err: any) {
      setVariantErrors(prev => ({ ...prev, [proposalId]: "Feil ved tegning" }));
    }
  };

  const handleRefine = async (proposalId: string) => {
    if (!results) return;
    const proposal = results.design_proposals.find(p => p.id === proposalId);
    if (!proposal || !proposal.user_refinement) return;
    setIsRefining(proposalId);
    try {
      const updated = await refineSpecificProposal(proposal, proposal.user_refinement, inputs);
      const visual = await visualizeProposal(inputs.image!, updated, inputs, proposal.user_refinement);
      setResults({
        ...results,
        design_proposals: results.design_proposals.map(p => 
          p.id === proposalId ? { ...updated, visual_image: visual, user_refinement: proposal.user_refinement } : p
        )
      });
    } catch (err) {
      setError("Oppdatering feilet.");
    } finally {
      setIsRefining(null);
    }
  };

  const handleDownloadPDF = async () => {
    if (!reportRef.current) return;
    setIsGeneratingPDF(true);
    const opt = {
      margin: 10,
      filename: `AIndersen-Møbel-Rapport.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    try {
      // @ts-ignore
      await html2pdf().set(opt).from(reportRef.current).save();
    } catch (err) {
      window.print();
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const reset = () => { if (confirm("Starte nytt prosjekt?")) window.location.reload(); };

  const selectedProposal = results?.design_proposals.find(p => p.id === selectedProposalId);

  const goBack = () => {
    const stepOrder: Step[] = ['upload', 'scale', 'dimensions', 'placement', 'product', 'description', 'results', 'selected', 'report'];
    const idx = stepOrder.indexOf(step);
    if (idx > 0) setStep(stepOrder[idx - 1]);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 font-sans selection:bg-indigo-100 overflow-x-hidden">
      {selectedImage && (
        <div className="fixed inset-0 bg-slate-950/95 z-[100] flex items-center justify-center p-4 animate-in fade-in" onClick={() => setSelectedImage(null)}>
          <button className="absolute top-6 right-6 text-white p-3 hover:bg-white/10 rounded-full transition-colors"><X className="w-8 h-8" /></button>
          <img src={selectedImage} className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl" alt="Fullvisning" />
        </div>
      )}

      <nav className="glass-effect border-b sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-sm print:hidden">
        <div className="flex items-center gap-4 cursor-pointer group" onClick={reset}>
          <div className="bg-slate-900 p-2.5 rounded-xl shadow-lg transition-transform group-hover:scale-110"><Box className="text-white w-6 h-6" /></div>
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-extrabold text-xl tracking-tight leading-none">Snekker <span className="text-indigo-600">AIndersen</span></h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Design Studio</p>
            </div>
            <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-tighter animate-pulse border border-emerald-200">v1.8</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {step !== 'upload' && step !== 'processing' && (
            <button onClick={goBack} className="text-slate-500 font-bold text-sm px-4 py-2 rounded-xl hover:bg-white flex items-center gap-2 transition-all border border-transparent hover:border-slate-200"><ChevronLeft className="w-4 h-4" /> Tilbake</button>
          )}
        </div>
      </nav>

      <main className={`${step === 'results' ? 'max-w-[1400px]' : 'max-w-4xl'} mx-auto mt-8 md:mt-12 px-4 md:px-6 transition-all duration-500`}>
        {step === 'upload' && (
          <div className="flex flex-col items-center text-center space-y-12 py-10 animate-in fade-in slide-in-from-bottom-10">
            <div className="max-w-2xl space-y-6">
              <h1 className="text-6xl md:text-8xl font-black text-slate-900 tracking-tighter leading-[0.85] lg:leading-[0.8]">
                Tegn ditt nye <br />
                <span className="text-indigo-600">møbel</span> nå.
              </h1>
              <p className="text-xl text-slate-500 font-medium leading-relaxed px-4">
                Last opp et bilde av rommet, så tegner snekkeren forslagene direkte inn i bildet ditt.
              </p>
            </div>
            
            <div className="w-full max-w-xl group relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-[3rem] blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
              <div className="relative bg-white p-12 md:p-20 rounded-[3rem] border-2 border-slate-100 hover:border-indigo-300 transition-all cursor-pointer shadow-xl overflow-hidden flex flex-col items-center gap-8">
                <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" title="" />
                <div className="p-8 bg-indigo-50 rounded-[2.5rem] group-hover:scale-110 group-hover:bg-indigo-100 transition-all duration-500 animate-float">
                  <UploadCloud className="w-16 h-16 text-indigo-600" />
                </div>
                <div className="space-y-4">
                  <p className="font-extrabold text-3xl text-slate-900">Velg bilde fra rommet</p>
                  <p className="text-sm font-semibold text-slate-400 bg-slate-50 px-6 py-2 rounded-full inline-block">Klikk for å starte</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'scale' && (
          <div className="bg-white p-6 md:p-10 rounded-[3rem] shadow-2xl border border-slate-100 animate-in zoom-in-95 text-center">
            <header className="mb-8 space-y-2">
              <h2 className="text-2xl font-black flex items-center justify-center gap-3">
                <Ruler className="text-indigo-600 w-6 h-6" /> Kalibrering
              </h2>
              <p className="text-slate-500 text-sm font-medium italic">Marker en kjent lengde (f.eks. bredden på en dør eller en flis).</p>
            </header>
            
            <div className="relative w-full rounded-3xl overflow-hidden cursor-crosshair border-4 border-slate-50 shadow-inner group mb-8" onClick={handleScaleClick}>
              <img ref={imageRef} src={inputs.image!} className="w-full h-auto block" alt="Kalibrering" />
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur text-white px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest z-30 flex items-center gap-2">
                <Info className="w-3 h-3 text-indigo-300" /> Sett to punkter på bildet
              </div>
              {scaleDrawing.p1 && <div className="absolute w-5 h-5 bg-indigo-600 rounded-full border-4 border-white shadow-xl -translate-x-1/2 -translate-y-1/2 z-20" style={{left: `${scaleDrawing.p1.x}%`, top: `${scaleDrawing.p1.y}%`}} />}
              {scaleDrawing.p2 && <div className="absolute w-5 h-5 bg-indigo-600 rounded-full border-4 border-white shadow-xl -translate-x-1/2 -translate-y-1/2 z-20" style={{left: `${scaleDrawing.p2.x}%`, top: `${scaleDrawing.p2.y}%`}} />}
              {scaleDrawing.p1 && scaleDrawing.p2 && <svg className="absolute inset-0 pointer-events-none w-full h-full z-10"><line x1={`${scaleDrawing.p1.x}%`} y1={`${scaleDrawing.p1.y}%`} x2={`${scaleDrawing.p2.x}%`} y2={`${scaleDrawing.p2.y}%`} stroke="#4f46e5" strokeWidth="3" strokeDasharray="8 8" /></svg>}
            </div>

            <div className="max-w-md mx-auto space-y-8">
              {scaleDrawing.p1 && scaleDrawing.p2 && (
                <div className="animate-in slide-in-from-top-4">
                  <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block tracking-widest">Lengde mellom punkter (mm)</label>
                  <input type="number" placeholder="f.eks 2100" className="w-full p-6 bg-slate-50 border-2 border-slate-100 rounded-3xl focus:border-indigo-500 outline-none font-black text-center text-3xl shadow-inner transition-all" value={scaleDrawing.tempLength || ''} onChange={(e) => setScaleDrawing({...scaleDrawing, tempLength: e.target.value})} />
                </div>
              )}
              <div className="flex gap-4">
                <button onClick={() => setStep('dimensions')} className="flex-1 py-5 bg-slate-100 text-slate-500 font-black rounded-2xl hover:bg-slate-200 transition-all text-[10px] uppercase tracking-widest">Hopp over</button>
                <button onClick={finalizeScale} disabled={scaleDrawing.p1 && scaleDrawing.p2 && !scaleDrawing.tempLength} className="flex-[2] py-5 bg-indigo-600 text-white font-black text-lg rounded-2xl shadow-xl hover:bg-indigo-700 transition-all disabled:opacity-30 uppercase tracking-widest">Neste steg</button>
              </div>
            </div>
          </div>
        )}

        {step === 'dimensions' && (
          <div className="bg-white p-10 md:p-14 rounded-[3.5rem] shadow-2xl border border-slate-100 animate-in zoom-in-95">
            <h2 className="text-4xl font-black mb-10 tracking-tighter text-center leading-none">Møbelets mål</h2>
            <div className="space-y-12">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { id: 'width', label: 'Bredde' },
                  { id: 'height', label: 'Høyde' },
                  { id: 'depth', label: 'Dybde' }
                ].map(f => (
                  <div key={f.id} className="space-y-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-center">{f.label}</p>
                    <div className="relative group">
                      <input type="number" placeholder="0" className="w-full p-6 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-indigo-500 outline-none font-black text-center text-3xl shadow-inner transition-all group-hover:bg-white" value={(inputs as any)[f.id]} onChange={(e) => setInputs(prev => ({...prev, [f.id]: e.target.value}))} />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 font-bold text-xs">mm</span>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setStep('placement')} className="w-full py-7 bg-indigo-600 text-white font-black text-xl rounded-[2.5rem] shadow-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-4 group">
                Gå videre <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        )}

        {step === 'placement' && (
          <div className="bg-white p-5 md:p-8 rounded-[2.5rem] shadow-2xl border border-slate-100 animate-in zoom-in-95">
            <header className="mb-6 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="text-left">
                <h2 className="text-2xl font-black mb-1">Planlegging</h2>
                <p className="text-slate-400 text-xs font-medium">Trykk på bildet for å markere.</p>
              </div>
              
              <div className="flex bg-slate-100 p-1.5 rounded-2xl gap-1 shadow-inner">
                <button 
                  onClick={() => setMode('placement')} 
                  className={`px-5 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition-all ${mode === 'placement' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <MapPin className="w-4 h-4" /> Startpunkt
                </button>
                <button 
                  onClick={() => setMode('exclusion')} 
                  className={`px-5 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 transition-all ${mode === 'exclusion' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <ShieldAlert className="w-4 h-4" /> Hindring
                </button>
              </div>

              {(inputs.placement_point || inputs.exclusion_points.length > 0) && (
                <button onClick={clearAllPoints} className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" /> Tøm alt
                </button>
              )}
            </header>

            <div className="relative w-full rounded-3xl overflow-hidden cursor-crosshair border-4 border-slate-50 shadow-2xl ring-1 ring-slate-100 group" onClick={handleImageInteraction}>
              <img src={inputs.image!} className="w-full h-auto block" alt="Plassering" />
              
              {/* Plasseringspin */}
              {inputs.placement_point && (
                <div className="absolute z-30 pointer-events-none animate-in zoom-in" style={{ left: `${inputs.placement_point.x}%`, top: `${inputs.placement_point.y}%`, transform: 'translate(-50%, -100%)' }}>
                  <div className="relative group">
                    <div className="absolute inset-0 bg-emerald-500 rounded-full blur-xl opacity-50 animate-pulse" />
                    <div className="relative bg-emerald-500 text-white p-3 rounded-2xl shadow-xl border-4 border-white">
                      <MapPin className="w-6 h-6" />
                    </div>
                  </div>
                </div>
              )}

              {/* Hindringer (Røde kryss) */}
              {inputs.exclusion_points.map((p, i) => (
                <div 
                  key={`exclusion-${i}-${p.x}-${p.y}`}
                  className="absolute z-[40] pointer-events-auto group/cross" 
                  style={{ left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%, -50%)' }}
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    removeExclusion(i); 
                  }}
                >
                  <div className="bg-red-600 text-white p-2 rounded-lg shadow-xl border-2 border-white transform transition-transform group-hover/cross:scale-125 cursor-pointer active:scale-90 flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </div>
                </div>
              ))}

              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur text-white px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-3">
                {mode === 'placement' ? 'Marker hvor møbelet starter' : 'Marker vindu/dør/hindring'}
              </div>
            </div>

            <button onClick={() => setStep('product')} disabled={!inputs.placement_point} className="mt-8 w-full max-w-sm mx-auto py-6 bg-indigo-600 text-white font-black text-lg rounded-2xl shadow-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-4 group disabled:opacity-30 uppercase tracking-widest">
              Velg Møbeltype <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        )}

        {step === 'product' && (
          <div className="space-y-10 animate-in slide-in-from-right-10 py-6">
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter text-center leading-none">Hva skal vi <br />bygge?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {productTypes.map((p) => (
                <button key={p.type} onClick={() => { setInputs(prev => ({...prev, productType: p.type})); setStep('description'); }} className={`bg-white p-8 rounded-[2.5rem] border-4 transition-all flex items-center gap-8 group shadow-lg hover:shadow-2xl hover:-translate-y-1.5 ${inputs.productType === p.type ? 'border-indigo-600' : 'border-transparent'}`}>
                  <div className={`p-6 rounded-2xl transition-all group-hover:scale-110 ${inputs.productType === p.type ? 'bg-indigo-100' : 'bg-slate-50'}`}>
                    <p.icon className={`w-10 h-10 ${inputs.productType === p.type ? 'text-indigo-600' : 'text-slate-400'}`} />
                  </div>
                  <div className="text-left">
                    <span className="font-black text-xl text-slate-900 block mb-0.5">{p.label}</span>
                    <span className="text-slate-400 font-bold text-[10px] uppercase tracking-widest">{p.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'description' && (
          <div className="bg-white p-8 md:p-12 rounded-[3.5rem] shadow-2xl animate-in zoom-in-95 max-w-2xl mx-auto border border-slate-100">
            <h2 className="text-3xl font-black mb-8 tracking-tighter text-center leading-none">Spesielle ønsker?</h2>
            <div className="space-y-8">
              <textarea placeholder="F.eks: 'Eikefiner', 'Svart skrog', 'Ingen håndtak'..." className="w-full p-8 bg-slate-50 border-2 border-slate-100 rounded-[2.5rem] min-h-[200px] text-xl font-medium focus:border-indigo-500 outline-none resize-none shadow-inner leading-relaxed transition-all focus:bg-white" value={inputs.description} onChange={(e) => setInputs(prev => ({...prev, description: e.target.value}))} />
              {error && <div className="p-5 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-4 text-red-600 font-bold animate-in shake"><AlertCircle className="w-6 h-6 shrink-0" /><span>{error}</span></div>}
              <button onClick={handleGenerate} className="w-full py-8 bg-indigo-600 text-white font-black text-2xl rounded-[2.5rem] shadow-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-6 group uppercase tracking-widest">
                Start Tegning <Sparkles className="w-8 h-8 group-hover:rotate-12 transition-transform" />
              </button>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="flex flex-col items-center justify-center py-20 space-y-10 animate-in fade-in text-center">
            <div className="relative">
              <div className="w-40 h-40 md:w-56 md:h-56 border-[12px] border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center animate-pulse"><Box className="w-16 h-16 text-indigo-200" /></div>
            </div>
            <div className="space-y-4">
              <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Snekkeren tegner...</h2>
              <div className="flex flex-wrap items-center justify-center gap-4 text-slate-400 font-bold text-sm uppercase tracking-widest">
                 {inputs.exclusion_points.length > 0 && <span className="text-emerald-500 flex items-center gap-2 bg-emerald-50 px-4 py-1.5 rounded-full border border-emerald-100"><ShieldAlert className="w-4 h-4" /> Tar hensyn til hindringer</span>}
                 <span className="opacity-30">•</span>
                 <span>Lager 6 varianter</span>
              </div>
            </div>
          </div>
        )}

        {step === 'results' && results && (
          <div className="space-y-12 animate-in fade-in pb-32">
             <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div className="space-y-3">
                  <h2 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 leading-[0.85]">Dine <br />forslag.</h2>
                  <p className="text-slate-400 text-lg font-medium">Alle forslag er kuttet slik at de unngår markerte hindringer.</p>
                </div>
                {renderProgress && (
                  <div className="bg-indigo-600 px-8 py-5 rounded-3xl shadow-2xl flex items-center gap-5 text-white animate-bounce">
                    <span className="text-xl font-black">{renderProgress.current} / {renderProgress.total}</span>
                    <Loader2 className="animate-spin w-6 h-6" />
                  </div>
                )}
             </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-10">
              {results.design_proposals.map((proposal, idx) => (
                <div key={proposal.id} className="bg-white rounded-[2.5rem] shadow-xl overflow-hidden border border-slate-100 flex flex-col group hover:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] hover:-translate-y-3 transition-all duration-500">
                  <div className="aspect-[4/3] bg-slate-50 relative overflow-hidden">
                    {proposal.visual_image ? (
                      <img src={proposal.visual_image} className="w-full h-full object-cover cursor-zoom-in" alt="Variant" onClick={() => setSelectedImage(proposal.visual_image!)} />
                    ) : variantErrors[proposal.id] ? (
                        <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-slate-900 text-white">
                            <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
                            <p className="text-[10px] font-bold uppercase">{variantErrors[proposal.id]}</p>
                            <button onClick={() => generateSingleImage(proposal.id, proposal)} className="mt-4 px-5 py-2 bg-white/10 rounded-xl text-[9px] font-black uppercase"><RefreshCw className="w-3 h-3 inline mr-2" /> Prøv igjen</button>
                        </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-slate-300 space-y-4 animate-pulse">
                        <Loader2 className="animate-spin w-10 h-10" />
                        <p className="text-[9px] font-black uppercase tracking-widest">Bygger variant...</p>
                      </div>
                    )}
                    <div className="absolute top-5 left-5"><span className="bg-slate-900 text-white px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest">Variant {idx+1}</span></div>
                    {inputs.exclusion_points.length > 0 && (
                      <div className="absolute top-5 right-5 flex items-center gap-1.5 bg-white/95 backdrop-blur px-3 py-1.5 rounded-full shadow-sm border border-emerald-50">
                        <ShieldAlert className="w-3 h-3 text-emerald-600" />
                        <span className="text-[8px] font-black text-emerald-700 uppercase">Hindrings-sjekk OK</span>
                      </div>
                    )}
                  </div>
                  <div className="p-8 space-y-6 flex-grow flex flex-col justify-between">
                    <div>
                        <h3 className="font-black text-xl uppercase text-slate-900 mb-1">{proposal.style_package}</h3>
                        <div className="flex items-center justify-between">
                           <p className="text-indigo-600 font-bold text-[10px] uppercase tracking-widest">{proposal.fronts.material.replace('_', ' ')}</p>
                           <p className="text-slate-400 font-bold text-[9px] uppercase">{proposal.dimensions_mm.width}mm bred</p>
                        </div>
                    </div>
                    <button onClick={() => { setSelectedProposalId(proposal.id); setStep('selected'); }} className="w-full py-4 bg-slate-900 text-white font-black text-xs rounded-xl hover:bg-indigo-600 transition-all uppercase tracking-widest shadow-lg">Velg Design</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 'selected' && selectedProposal && (
          <div className="max-w-4xl mx-auto space-y-10 animate-in zoom-in-95 pb-32">
            <h2 className="text-4xl md:text-6xl font-black tracking-tighter text-center leading-none">Skreddersøm</h2>
            <div className="bg-white rounded-[3rem] shadow-2xl overflow-hidden border border-slate-100 flex flex-col md:flex-row">
               <div className="w-full md:w-1/2 relative bg-slate-50 min-h-[350px]">
                 {selectedProposal.visual_image && (
                    <img src={selectedProposal.visual_image} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setSelectedImage(selectedProposal.visual_image!)} alt="Valgt" />
                 )}
                 {isRefining === selectedProposal.id && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center z-20 space-y-4">
                        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
                        <p className="font-black uppercase text-[10px] tracking-widest">Oppdaterer tegning...</p>
                    </div>
                 )}
               </div>
               <div className="w-full md:w-1/2 p-10 space-y-10">
                  <div className="space-y-4">
                    <h3 className="text-3xl font-black uppercase tracking-tight">{selectedProposal.style_package}</h3>
                    <div className="flex flex-wrap gap-3">
                        <span className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black uppercase tracking-widest">{selectedProposal.fronts.material}</span>
                        <span className="px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest">{selectedProposal.fronts.color}</span>
                        <span className="px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-black uppercase tracking-widest">{selectedProposal.dimensions_mm.width}mm bred</span>
                    </div>
                  </div>
                  <div className="space-y-5">
                     <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest block">Noe du vil endre?</label>
                     <textarea placeholder="F.eks: 'Bytt til svarte håndtak', 'Lag den 20cm smalere'..." className="w-full p-6 bg-slate-50 border-2 border-slate-100 rounded-[2rem] min-h-[120px] focus:border-indigo-500 outline-none resize-none font-medium text-sm transition-all" value={selectedProposal.user_refinement || ''} onChange={(e) => { 
                       const val = e.target.value;
                       setResults(prev => prev ? {
                         ...prev,
                         design_proposals: prev.design_proposals.map(p => p.id === selectedProposal.id ? { ...p, user_refinement: val } : p)
                       } : null);
                     }} />
                     <button onClick={() => handleRefine(selectedProposal.id)} disabled={!!isRefining || !selectedProposal.user_refinement} className="w-full py-5 bg-indigo-600 text-white font-black rounded-2xl shadow-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-4 disabled:opacity-30 text-xs uppercase tracking-widest">
                        Oppdater forslag
                     </button>
                  </div>
                  <button onClick={() => setStep('report')} className="w-full py-6 bg-slate-900 text-white font-black text-lg rounded-[2rem] shadow-2xl hover:bg-black transition-all flex items-center justify-center gap-4 group">
                     Se ferdig rapport <FileText className="w-6 h-6 group-hover:scale-110 transition-transform" />
                  </button>
               </div>
            </div>
          </div>
        )}

        {step === 'report' && selectedProposal && (
          <div className="animate-in fade-in py-10 max-w-4xl mx-auto pb-32">
            <div className="flex flex-col md:flex-row justify-center gap-6 mb-16 print:hidden">
              <button onClick={handleDownloadPDF} disabled={isGeneratingPDF} className="bg-indigo-600 text-white px-10 py-5 rounded-[2.5rem] font-black text-lg flex items-center justify-center gap-4 shadow-2xl hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-50">
                {isGeneratingPDF ? <Loader2 className="animate-spin w-6 h-6" /> : <Download className="w-6 h-6" />} Last ned PDF
              </button>
              <button onClick={() => window.print()} className="bg-slate-900 text-white px-10 py-5 rounded-[2.5rem] font-black text-lg flex items-center justify-center gap-4 shadow-2xl hover:bg-slate-800 transition-all active:scale-95">
                <Printer className="w-6 h-6" /> Skriv ut
              </button>
            </div>

            <div ref={reportRef} className="space-y-0">
              <div className="p-10 md:p-20 bg-white shadow-2xl border border-slate-100 flex flex-col justify-between mb-12 min-h-[297mm]">
                <div className="space-y-16">
                  <header className="border-b-[8px] border-slate-900 pb-12 flex justify-between items-end">
                    <div className="space-y-6">
                      <div className="flex items-center gap-4">
                        <div className="bg-slate-900 p-3 rounded-lg shadow-lg"><Box className="text-white w-8 h-8" /></div>
                        <span className="font-black text-3xl tracking-tighter">AIndersen</span>
                      </div>
                      <h1 className="text-6xl font-black uppercase tracking-tighter leading-[0.8] text-slate-900">Møbel- <br />Rapport</h1>
                    </div>
                  </header>
                  <div className="grid grid-cols-2 gap-12">
                     <section className="space-y-6">
                        <h2 className="text-[10px] font-black uppercase text-indigo-600 tracking-[0.4em]">Spesifikasjoner</h2>
                        <div className="space-y-4">
                            <div className="flex justify-between border-b pb-3"><span className="text-slate-400 font-bold uppercase text-[9px]">Type</span> <span className="font-black text-sm">{inputs.productType}</span></div>
                            <div className="flex justify-between border-b pb-3"><span className="text-slate-400 font-bold uppercase text-[9px]">Bredde</span> <span className="font-black text-sm">{selectedProposal.dimensions_mm.width} mm</span></div>
                            <div className="flex justify-between border-b pb-3"><span className="text-slate-400 font-bold uppercase text-[9px]">Høyde</span> <span className="font-black text-sm">{selectedProposal.dimensions_mm.height} mm</span></div>
                            <div className="flex justify-between border-b pb-3"><span className="text-slate-400 font-bold uppercase text-[9px]">Dybde</span> <span className="font-black text-sm">{selectedProposal.dimensions_mm.depth} mm</span></div>
                        </div>
                     </section>
                     <section className="space-y-6">
                        <h2 className="text-[10px] font-black uppercase text-indigo-600 tracking-[0.4em]">Materialer</h2>
                        <p className="text-lg font-bold leading-relaxed">{selectedProposal.fronts.material.replace('_', ' ')} i {selectedProposal.fronts.color}. {selectedProposal.handle_solution.replace('_', ' ')}.</p>
                     </section>
                  </div>
                  <div className="pt-12">
                    <h2 className="text-[10px] font-black uppercase text-indigo-600 tracking-[0.4em] mb-6">Visualisering</h2>
                    <div className="rounded-[2.5rem] overflow-hidden border-[10px] border-slate-50 shadow-inner">
                        {selectedProposal.visual_image && <img src={selectedProposal.visual_image} className="w-full h-auto" alt="Final" />}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
