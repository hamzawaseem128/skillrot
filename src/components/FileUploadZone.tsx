'use client';

import { useState, useRef } from 'react';

interface FileUploadZoneProps {
  onFileSelect: (file: File) => void;
  accept?: string;
}

/**
 * Selecting a file hands off to the parent immediately, which swaps this zone
 * for the processing view — so this component deliberately keeps no
 * "selected file" state of its own; it would never be visible.
 */
export default function FileUploadZone({ onFileSelect, accept = '.pdf,.pptx,.mp4,.mov,.webm,.m4v' }: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDragIn = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragOut = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFileSelect(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clearing the value lets the same file be picked again and still fire a
    // change event, in case this input is ever kept mounted across an upload.
    e.target.value = '';
    if (file) onFileSelect(file);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Choose a PDF or PowerPoint file to upload"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={handleDrag}
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDrop={handleDrop}
      className={`glass-panel rounded-2xl p-12 text-center cursor-pointer transition-all duration-300 border-2 border-dashed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8083ff] ${
        isDragging
          ? 'border-[#8083ff] glow-active bg-[#8083ff]/5'
          : 'border-[#464554] hover:border-[#908fa0] hover:bg-white/[0.02]'
      }`}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={handleFileInput} className="hidden" />
      <span className="material-symbols-outlined text-[#8083ff] mb-4 block" style={{ fontSize: '56px' }}>cloud_upload</span>
      <p className="text-[#dfe2f1] font-medium mb-1">Drop your file here, or click to browse</p>
      <p className="text-[#908fa0] text-sm">PDF or PowerPoint → video lecture · MP4/MOV → notes</p>
    </div>
  );
}
