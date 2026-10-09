import React from 'react';
import {createRoot} from 'react-dom/client';
import WebWorkspace from '../../src/components/WebWorkspace';
import '../../src/styles.css';
createRoot(document.getElementById('root')).render(<WebWorkspace active models={[{name:'fixture-model'}]}/>);
