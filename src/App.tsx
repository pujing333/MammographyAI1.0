/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Activity, AlertCircle, CheckCircle2, RefreshCw, ChevronRight, Stethoscope, Camera, X, Maximize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { analyzeMammogram, Lesion } from './services/geminiService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [lesions, setLesions] = useState<Lesion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  
  // Learning & Correction States
  const [isEditing, setIsEditing] = useState(false);
  const [editedReport, setEditedReport] = useState<string>('');
  const [editedLesions, setEditedLesions] = useState<Lesion[]>([]);
  const [savedCorrections, setSavedCorrections] = useState<any[]>([]);
  const [activeLesionIdx, setActiveLesionIdx] = useState<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const dragStartPos = useRef({ x: 0, y: 0, box: [0, 0, 0, 0] });
  
  const [backendStatus, setBackendStatus] = useState<'checking' | 'ok' | 'error' | 'missing_key'>('checking');
  const [backendError, setBackendError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkHealth = async () => {
      // ... existing health check code ...
    };
    checkHealth();

    // Load saved corrections
    const saved = localStorage.getItem('breast_ai_corrections');
    if (saved) {
      try {
        setSavedCorrections(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load corrections", e);
      }
    }
  }, []);

  // Correction Logic
  const startCorrection = () => {
    setIsEditing(true);
    setEditedReport(report || '');
    setEditedLesions(JSON.parse(JSON.stringify(lesions))); // Deep copy
  };

  const cancelCorrection = () => {
    setIsEditing(false);
    setActiveLesionIdx(null);
  };

  const saveCorrection = () => {
    const newCorrection = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      originalReport: report,
      originalLesions: lesions,
      correctedReport: editedReport,
      correctedLesions: editedLesions,
      image: image // Note: This stores the base64, might grow localStorage quickly
    };

    const updated = [...savedCorrections, newCorrection];
    setSavedCorrections(updated);
    localStorage.setItem('breast_ai_corrections', JSON.stringify(updated));
    
    // Update current view with corrected data
    setReport(editedReport);
    setLesions(editedLesions);
    setIsEditing(false);
    setActiveLesionIdx(null);
    alert('修正已保存到本地学习集！');
  };

  const exportDataset = () => {
    const dataStr = JSON.stringify(savedCorrections, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `breast_ai_dataset_${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const updateLesionPos = (idx: number, field: 'ymin' | 'xmin' | 'ymax' | 'xmax', value: number) => {
    const updated = [...editedLesions];
    const box = [...updated[idx].box_2d];
    const fieldIdx = field === 'ymin' ? 0 : field === 'xmin' ? 1 : field === 'ymax' ? 2 : 3;
    box[fieldIdx] = Math.max(0, Math.min(1000, value));
    
    // Ensure min size
    if (field === 'ymin' && box[2] - box[0] < 20) box[0] = box[2] - 20;
    if (field === 'ymax' && box[2] - box[0] < 20) box[2] = box[0] + 20;
    if (field === 'xmin' && box[3] - box[1] < 20) box[1] = box[3] - 20;
    if (field === 'xmax' && box[3] - box[1] < 20) box[3] = box[1] + 20;

    updated[idx].box_2d = box as [number, number, number, number];
    setEditedLesions(updated);
  };

  const moveLesion = (idx: number, dy: number, dx: number) => {
    const updated = [...editedLesions];
    const [ymin, xmin, ymax, xmax] = updated[idx].box_2d;
    const h = ymax - ymin;
    const w = xmax - xmin;
    
    let ny1 = Math.max(0, Math.min(1000 - h, ymin + dy));
    let nx1 = Math.max(0, Math.min(1000 - w, xmin + dx));
    
    updated[idx].box_2d = [ny1, nx1, ny1 + h, nx1 + w];
    setEditedLesions(updated);
  };

  const onDragStart = (e: React.PointerEvent, idx: number) => {
    if (!isEditing) return;
    e.stopPropagation();
    setDraggingIdx(idx);
    setActiveLesionIdx(idx);
    dragStartPos.current = {
      x: e.clientX,
      y: e.clientY,
      box: [...editedLesions[idx].box_2d]
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent) => {
    if (draggingIdx === null || !imageContainerRef.current) return;
    
    const rect = imageContainerRef.current.getBoundingClientRect();
    const dx = ((e.clientX - dragStartPos.current.x) / rect.width) * 1000;
    const dy = ((e.clientY - dragStartPos.current.y) / rect.height) * 1000;
    
    const [ymin, xmin, ymax, xmax] = dragStartPos.current.box;
    const h = ymax - ymin;
    const w = xmax - xmin;
    
    let ny1 = Math.max(0, Math.min(1000 - h, ymin + dy));
    let nx1 = Math.max(0, Math.min(1000 - w, xmin + dx));
    
    const updated = [...editedLesions];
    updated[draggingIdx].box_2d = [ny1, nx1, ny1 + h, nx1 + w];
    setEditedLesions(updated);
  };

  const onDragEnd = () => {
    setDraggingIdx(null);
  };

  const addNewLesion = () => {
    const newLesion: Lesion = {
      box_2d: [400, 400, 600, 600],
      label: '新增病灶',
      confidence: 1.0
    };
    setEditedLesions([...editedLesions, newLesion]);
    setActiveLesionIdx(editedLesions.length);
  };

  const removeLesion = (idx: number) => {
    setEditedLesions(editedLesions.filter((_, i) => i !== idx));
    setActiveLesionIdx(null);
  };

  // Handle Camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setShowCamera(true);
    } catch (err) {
      setError('无法访问摄像头，请确保已授予权限。');
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setImage(dataUrl);
        stopCamera();
        setReport(null);
        setLesions([]);
        setError(null);
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('请上传有效的图片文件（JPG, PNG 等）');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target?.result as string);
        setReport(null);
        setLesions([]);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const startAnalysis = async () => {
    if (!image) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      // 1. 压缩图片以适应移动网络
      const compressedImage = await compressImage(image);
      const mimeType = compressedImage.split(';')[0].split(':')[1];
      
      // 2. 调用 AI 分析
      const result = await analyzeMammogram(compressedImage, mimeType);
      setReport(result.report);
      setLesions(result.lesions || []);
    } catch (err: any) {
      console.error(err);
      if (err.message === 'Failed to fetch') {
        setError('网络连接失败：请确保您的手机网络能够访问 Google 服务（可能需要科学上网）。');
      } else {
        setError(err.message || '分析过程中出现错误，请检查网络连接或 API 配置。');
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 图片压缩函数
  const compressImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1200; // 限制最大宽度为 1200px
        const MAX_HEIGHT = 1600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        // 压缩质量设为 0.7
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
    });
  };

  const reset = () => {
    setImage(null);
    setReport(null);
    setLesions([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-12">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-2 rounded-lg">
              <Stethoscope className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">
              BreastAI <span className="text-slate-400 font-normal text-sm ml-2 hidden sm:inline">钼靶乳腺癌智能诊断系统</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className={cn(
                "w-2 h-2 rounded-full",
                backendStatus === 'ok' ? "bg-emerald-500" : 
                backendStatus === 'missing_key' ? "bg-amber-500" :
                backendStatus === 'error' ? "bg-red-500" : "bg-slate-300 animate-pulse"
              )} />
              <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                {backendStatus === 'ok' ? "服务器在线" : 
                 backendStatus === 'missing_key' ? "API Key 未配置" :
                 backendStatus === 'error' ? `连接失败 (${backendError})` : "正在连接..."}
              </span>
            </div>
            <span className="text-xs font-medium px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full">
              移动增强版 v1.1
            </span>
            <span className="text-[10px] text-slate-400 hidden lg:inline">
              Origin: {window.location.origin}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Upload and Preview */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Upload className="w-5 h-5 text-emerald-600" />
                    影像上传
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">支持相册上传或现场拍照</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={startCamera}
                    className="p-2 bg-slate-100 rounded-lg hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                    title="拍照上传"
                  >
                    <Camera className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 bg-slate-100 rounded-lg hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                    title="文件上传"
                  >
                    <Upload className="w-5 h-5" />
                  </button>
                </div>
              </div>
              
              <div className="p-5">
                {!image ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-200 rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-all group"
                  >
                    <div className="bg-slate-100 p-4 rounded-full group-hover:bg-emerald-100 transition-colors">
                      <Upload className="w-8 h-8 text-slate-400 group-hover:text-emerald-600" />
                    </div>
                    <p className="mt-4 text-sm font-medium text-slate-600">点击上传或拍照</p>
                    <p className="mt-1 text-xs text-slate-400">支持 JPG, PNG, DICOM 转图</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div 
                      ref={imageContainerRef}
                      className="relative rounded-xl overflow-hidden border border-slate-200 bg-black aspect-[3/4] flex items-center justify-center group"
                    >
                      <img 
                        src={image} 
                        alt="Mammogram Preview" 
                        className="max-h-full max-w-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                      
                      {/* Lesion Overlay */}
                      {(isEditing ? editedLesions : lesions).map((lesion, idx) => {
                        const [ymin, xmin, ymax, xmax] = lesion.box_2d;
                        const isActive = activeLesionIdx === idx;
                        return (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            onPointerDown={(e) => onDragStart(e, idx)}
                            onPointerMove={onDragMove}
                            onPointerUp={onDragEnd}
                            onPointerCancel={onDragEnd}
                            className={cn(
                              "absolute border-2 transition-all cursor-move touch-none",
                              isEditing ? (isActive ? "border-emerald-500 bg-emerald-500/20 z-30 ring-2 ring-white" : "border-red-400 bg-red-400/10 z-10") : "border-red-500 bg-red-500/10 pointer-events-none"
                            )}
                            style={{
                              top: `${ymin / 10}%`,
                              left: `${xmin / 10}%`,
                              width: `${(xmax - xmin) / 10}%`,
                              height: `${(ymax - ymin) / 10}%`,
                            }}
                          >
                            <span className={cn(
                              "absolute -top-6 left-0 text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap pointer-events-none",
                              isEditing && isActive ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
                            )}>
                              {lesion.label} {isEditing ? "(修正中: 可拖拽)" : "(可疑)"}
                            </span>
                            
                            {isEditing && isActive && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="grid grid-cols-4 gap-1 p-1.5 bg-black/80 rounded-lg text-[10px] text-white pointer-events-auto shadow-xl border border-white/20">
                                  {/* Move Controls */}
                                  <button onClick={(e) => { e.stopPropagation(); moveLesion(idx, -20, 0); }} className="w-6 h-6 flex items-center justify-center bg-slate-700 rounded hover:bg-emerald-600" title="上移">↑</button>
                                  <button onClick={(e) => { e.stopPropagation(); moveLesion(idx, 20, 0); }} className="w-6 h-6 flex items-center justify-center bg-slate-700 rounded hover:bg-emerald-600" title="下移">↓</button>
                                  <button onClick={(e) => { e.stopPropagation(); moveLesion(idx, 0, -20); }} className="w-6 h-6 flex items-center justify-center bg-slate-700 rounded hover:bg-emerald-600" title="左移">←</button>
                                  <button onClick={(e) => { e.stopPropagation(); moveLesion(idx, 0, 20); }} className="w-6 h-6 flex items-center justify-center bg-slate-700 rounded hover:bg-emerald-600" title="右移">→</button>
                                  
                                  {/* Resize Controls */}
                                  <button onClick={(e) => { e.stopPropagation(); updateLesionPos(idx, 'ymin', ymin - 20); }} className="w-6 h-6 flex items-center justify-center bg-slate-800 rounded hover:bg-blue-600" title="拉高">H+</button>
                                  <button onClick={(e) => { e.stopPropagation(); updateLesionPos(idx, 'ymin', ymin + 20); }} className="w-6 h-6 flex items-center justify-center bg-slate-800 rounded hover:bg-blue-600" title="缩短">H-</button>
                                  <button onClick={(e) => { e.stopPropagation(); updateLesionPos(idx, 'xmax', xmax + 20); }} className="w-6 h-6 flex items-center justify-center bg-slate-800 rounded hover:bg-blue-600" title="拉宽">W+</button>
                                  <button onClick={(e) => { e.stopPropagation(); updateLesionPos(idx, 'xmax', xmax - 20); }} className="w-6 h-6 flex items-center justify-center bg-slate-800 rounded hover:bg-blue-600" title="缩窄">W-</button>
                                </div>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); removeLesion(idx); }}
                                  className="absolute -bottom-8 right-0 bg-red-600 text-white p-1.5 rounded-full shadow-lg pointer-events-auto hover:bg-red-700"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </motion.div>
                        );
                      })}

                      {isEditing && (
                        <button 
                          onClick={addNewLesion}
                          className="absolute bottom-4 left-4 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-lg z-40 flex items-center gap-1"
                        >
                          <Activity className="w-3 h-3" /> 添加病灶
                        </button>
                      )}

                      <button 
                        onClick={reset}
                        className="absolute top-4 right-4 bg-white/90 backdrop-blur shadow-sm p-2 rounded-full hover:bg-white text-slate-600 transition-colors z-20"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                    
                    {!report && !isAnalyzing && (
                      <button 
                        onClick={startAnalysis}
                        className="w-full bg-emerald-600 text-white py-3 rounded-xl font-semibold hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-200"
                      >
                        <Activity className="w-5 h-5" />
                        开始智能分析
                      </button>
                    )}
                  </div>
                )}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  className="hidden" 
                  accept="image/*"
                />
              </div>
            </div>

            {/* Disclaimer */}
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-800 leading-relaxed">
                <strong>标注说明：</strong> 红色方框标记为 AI 识别的可疑恶性结节位置。请医生重点复核标记区域。
              </p>
            </div>
          </div>

          {/* Right Column: Analysis Results */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 min-h-[500px] flex flex-col">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-emerald-600" />
                  诊断报告
                </h2>
                {report && (
                  <div className="flex items-center gap-2 text-emerald-600 text-xs font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    分析已完成
                  </div>
                )}
              </div>

              <div className="flex-1 p-6 overflow-y-auto">
                <AnimatePresence mode="wait">
                  {isAnalyzing ? (
                    // ... existing analyzing UI ...
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full flex flex-col items-center justify-center space-y-4"
                    >
                      <div className="relative">
                        <div className="w-16 h-16 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin"></div>
                        <Activity className="w-6 h-6 text-emerald-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                      </div>
                      <div className="text-center">
                        <p className="text-slate-600 font-medium">AI 正在精准定位病灶...</p>
                        <p className="text-xs text-slate-400 mt-1">正在生成坐标标注与结构化报告</p>
                      </div>
                    </motion.div>
                  ) : isEditing ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="h-full flex flex-col space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-emerald-700 flex items-center gap-2">
                          <RefreshCw className="w-4 h-4" /> 临床修正模式
                        </h3>
                        <div className="flex gap-2">
                          <button 
                            onClick={cancelCorrection}
                            className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            取消
                          </button>
                          <button 
                            onClick={saveCorrection}
                            className="px-3 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-lg shadow-sm hover:bg-emerald-700 transition-colors"
                          >
                            保存到学习集
                          </button>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 italic">提示：您可以在左侧影像上点击标注框进行微调，或在下方修改报告内容。</p>
                      <textarea 
                        value={editedReport}
                        onChange={(e) => setEditedReport(e.target.value)}
                        className="flex-1 w-full p-4 border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono text-sm resize-none"
                        placeholder="在此输入修正后的诊断意见..."
                      />
                    </motion.div>
                  ) : report ? (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="prose prose-slate max-w-none prose-headings:text-slate-800 prose-p:text-slate-600 prose-strong:text-emerald-700"
                    >
                      <Markdown>{report}</Markdown>
                      
                      {lesions.length > 0 && (
                        <div className="mt-6 p-4 bg-red-50 rounded-xl border border-red-100">
                          <h4 className="text-red-800 text-sm font-bold mb-2 flex items-center gap-2">
                            <Maximize2 className="w-4 h-4" />
                            病灶定位摘要
                          </h4>
                          <ul className="text-xs text-red-700 space-y-1">
                            {lesions.map((l, i) => (
                              <li key={i}>• 发现可疑 {l.label}，已在影像中标记。</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="mt-8 pt-6 border-t border-slate-100">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-sm font-semibold text-slate-800">医生反馈（持续学习）</h3>
                          {savedCorrections.length > 0 && (
                            <button 
                              onClick={exportDataset}
                              className="text-[10px] font-bold text-emerald-600 hover:underline flex items-center gap-1"
                            >
                              导出已保存的 {savedCorrections.length} 个案例
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3">
                          <button 
                            onClick={() => alert('感谢反馈！系统已记录本次准确标注。')}
                            className="px-4 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition-colors"
                          >
                            标注准确
                          </button>
                          <button 
                            onClick={startCorrection}
                            className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
                          >
                            标注偏移 (进入修正)
                          </button>
                          <button 
                            onClick={startCorrection}
                            className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
                          >
                            漏诊/误诊 (进入修正)
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ) : error ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8">
                      <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                      <p className="text-slate-800 font-medium">{error}</p>
                      <button 
                        onClick={startAnalysis}
                        className="mt-4 text-emerald-600 font-medium hover:underline flex items-center gap-1"
                      >
                        重试分析 <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                      <FileText className="w-16 h-16 text-slate-200 mb-4" />
                      <p className="text-slate-400">暂无分析数据，请先上传并开始分析</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Camera Modal */}
      <AnimatePresence>
        {showCamera && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black flex flex-col"
          >
            <div className="p-4 flex justify-between items-center text-white">
              <h3 className="font-medium">拍摄钼靶影像</h3>
              <button onClick={stopCamera} className="p-2 hover:bg-white/10 rounded-full">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 relative flex items-center justify-center overflow-hidden">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="max-h-full max-w-full object-contain"
              />
              {/* Guide Overlay */}
              <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none flex items-center justify-center">
                <div className="w-full h-full border-2 border-white/20 border-dashed rounded-lg"></div>
              </div>
            </div>

            <div className="p-8 flex justify-center items-center bg-black/80 backdrop-blur">
              <button 
                onClick={capturePhoto}
                className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center group"
              >
                <div className="w-16 h-16 bg-white rounded-full group-active:scale-90 transition-transform"></div>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
