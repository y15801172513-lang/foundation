import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceApp} from './workspace/workspace-app';
import {applyFoundationFontPlatform} from './foundation-font-platform.mjs';
import './styles.css';

applyFoundationFontPlatform();
createRoot(document.getElementById('root')).render(<StrictMode><WorkspaceApp /></StrictMode>);
