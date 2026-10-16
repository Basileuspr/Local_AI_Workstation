import React from 'react';
import { createRoot } from 'react-dom/client';
import ImageGallery from '../../src/components/ImageGallery';
import { ImagePrivacyProvider } from '../../src/ImagePrivacy';
import '../../src/styles.css';

createRoot(document.getElementById('root')).render(<ImagePrivacyProvider>
  <main style={{ display: 'flex', height: '100vh' }}><ImageGallery images={[]} /></main>
</ImagePrivacyProvider>);
