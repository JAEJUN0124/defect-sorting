// 조작 화면 (React). 설정·통신·상태 로직은 기존 HMI 파일을 먼저 불러온 뒤 화면을 그린다
import './legacy.js';
import '../../css/base.css';
import '../../css/hmi.css';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
