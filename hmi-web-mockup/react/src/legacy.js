// 기존 HMI의 설정·문구·통신·상태 로직을 그대로 불러온다. 순서가 중요하다 (기존 index.html의 <script> 순서와 같음).
// 이 파일들은 window에 HMI_CONFIG · I18N · HmiApi · HmiStore · CameraView 같은 이름으로 자기를 걸어 둔다.
// 가짜 영상(camera-sim.js)은 넣지 않는다 — 실제 카메라만 쓴다 (사용자 2026-10-17)
import '../../js/config.js';
import './server-defaults.js'; // 빌드한 화면은 화면을 내준 서버에 붙는다 (api.js보다 먼저)
import '../../config/robot.js';
import '../../js/i18n/ko.js';
import '../../js/i18n.js';
import '../../js/xml.js';
import '../../js/xml-protocol.js';
import '../../js/adapter.js';
import '../../js/transport.js';
import '../../js/conveyor.js';
import '../../js/mock-server.js';
import '../../js/mock-hub.js';
import '../../js/api.js';
import '../../js/home.js';
import '../../js/store.js';
import '../../js/camera.js';
