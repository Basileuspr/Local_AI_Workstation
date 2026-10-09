import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ImageEditor from '../../src/components/ImageEditor';
import '../../src/styles.css';

function Fixture() {
  const [inline, setInline] = useState(null);
  window.editorCropQA = { openInline: file => setInline({ file, id: crypto.randomUUID() }) };
  async function save(blob, name, recipe) {
    window.editorCropSaved = { name, recipe, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  }
  return <main style={{ height: '100vh' }}><ImageEditor key={inline?.id || 'workspace'} inlineInput={inline} onSave={inline ? save : undefined} onCancel={() => setInline(null)} /></main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
