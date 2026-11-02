// 목업 1안 (레일). 조작 화면(App)과 기능은 그대로 쓰고, 배치·색·글꼴만 option-1.css로 바꾼다
import '../src/legacy.js';
import '../../css/base.css';
import '../../css/hmi.css';
import './option-1.css';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';

createRoot(document.getElementById('root')).render(<App />);
