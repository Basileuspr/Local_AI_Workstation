import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import '../../src/styles.css';

// This isolated origin contains only synthetic chats and fixture preferences.
localStorage.setItem('local-ai-workstation-preferences-v1', JSON.stringify({ selectedModel: 'qa:latest', roleplay: { useDurableMemory: false } }));
createRoot(document.getElementById('root')).render(<App />);
