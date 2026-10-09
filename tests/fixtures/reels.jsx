import React from 'react';
import {createRoot} from 'react-dom/client';
import ReelsAnalyzer from '../../src/components/ReelsAnalyzer';
import '../../src/styles.css';
createRoot(document.getElementById('root')).render(<ReelsAnalyzer active models={[{name:'fixture',capabilities:['completion','vision']}]}/>);
